import { Database, Json } from '@/types/database';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRole);

export const runtime = 'nodejs';
// Allow room for the finalize retry loop (deposit confirmation can take a moment).
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Finalize the payout once its deposit confirms. Bitnob keeps the payout in
 * `pending_address_deposit` until the on-chain USDC deposit CONFIRMS, and only emits
 * `deposit.success` (detection) — there is no confirmed event. `finalize` 400s with
 * "cannot transition ... to pending" until confirmation lands, so we retry with backoff
 * until it succeeds (or a non-transient error / the quote window closes).
 *
 * NOTE: this runs within one serverless invocation. For reliability across restarts,
 * back it with a cron that re-drives un-finalized Bitnob payouts (Phase 2).
 */
async function finalizeWithRetry(quoteId: string, tag: string): Promise<boolean> {
  const { getBitnobClient } = await import('@/lib/bitnob/client');
  const client = getBitnobClient();
  for (let attempt = 1; attempt <= 14; attempt++) {
    try {
      await client.finalizePayout(quoteId);
      console.log(`[Bitnob Webhook] [${tag}] finalized ${quoteId} on attempt ${attempt}`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/pending_address_deposit|cannot transition/i.test(msg)) {
        console.log(`[Bitnob Webhook] [${tag}] ${quoteId}: deposit not confirmed yet (attempt ${attempt})`);
        await sleep(20000);
        continue;
      }
      console.error(`[Bitnob Webhook] [${tag}] finalize ${quoteId} aborted:`, msg);
      return false;
    }
  }
  console.warn(`[Bitnob Webhook] [${tag}] finalize ${quoteId} gave up after retries`);
  return false;
}

/**
 * Bitnob webhook. Verifies the HMAC-SHA512 signature, then drives the payout:
 *   deposit.success   → deposit detected → retry finalize until it confirms
 *   payout.processing  → settlement started (intermediate, no action)
 *   payout.completed   → fiat delivered → finalize_withdrawal_success
 *   payout.failed/…    → finalize_withdrawal_failed (refund)
 */
// Some providers send a GET/HEAD verification ping when you register the URL.
export async function GET() {
  console.log('[Bitnob Webhook] GET verification ping');
  return new Response('OK', { status: 200 });
}

export async function POST(req: Request) {
  const requestStart = Date.now();
  const requestId = crypto.randomBytes(4).toString('hex');

  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers.entries());

    if (!payload) {
      console.warn(`[Bitnob Webhook] [${requestId}] empty body`);
      return new Response('Empty body', { status: 400 });
    }

    // ─── Parse first (the signature is computed over JSON.stringify(body)) ────
    interface BitnobEvent {
      id?: string;
      event?: string;
      type?: string;
      data?: {
        id?: string;
        reference?: string;
        transaction_id?: string;
        state?: string;
        status?: string;
        type?: string;
        txHash?: string;
        hash?: string;
        [key: string]: Json | undefined;
      };
      [key: string]: Json | undefined;
    }

    let event: BitnobEvent;
    try {
      event = JSON.parse(payload) as BitnobEvent;
    } catch {
      return new Response('Invalid JSON payload', { status: 400 });
    }

    // ─── Signature verification ───────────────────────────────────────────────
    // Bitnob signs HMAC-SHA512( webhookSecret, JSON.stringify(body) ) as hex, sent in
    // the x-bitnob-signature header (note: SHA-512, and over the re-stringified body).
    const webhookSecret = process.env.BITNOB_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error(`[Bitnob Webhook] [${requestId}] BITNOB_WEBHOOK_SECRET not set`);
      return new Response('Webhook secret not configured', { status: 500 });
    }

    const signature = headers['x-bitnob-signature'];
    if (!signature) {
      console.error(`[Bitnob Webhook] [${requestId}] Missing x-bitnob-signature header`);
      return new Response('Missing signature header', { status: 400 });
    }

    const receivedSig = String(signature).trim().toLowerCase();
    const computed = crypto
      .createHmac('sha512', String(webhookSecret).trim())
      .update(JSON.stringify(event))
      .digest('hex')
      .toLowerCase();

    const sigOk =
      receivedSig.length === computed.length &&
      (() => {
        try {
          return crypto.timingSafeEqual(
            Buffer.from(computed, 'utf8'),
            Buffer.from(receivedSig, 'utf8'),
          );
        } catch {
          return false;
        }
      })();

    if (!sigOk) {
      console.error(`[Bitnob Webhook] [${requestId}] Signature mismatch`);
      return new Response('Invalid signature', { status: 400 });
    }

    const eventType = event.event || event.type || 'unknown';
    const data = event.data;
    // The id we stored is the quote_id/reference we generated (offramp_*/onramp*).
    const orderId = data?.reference || data?.id || data?.transaction_id;
    const rawState = (data?.state || data?.status || '').toString().toUpperCase();

    if (!orderId) {
      console.error(`[Bitnob Webhook] [${requestId}] Missing order id — event=${eventType}`);
      return new Response('Invalid event data', { status: 400 });
    }

    // Map Bitnob transaction state + event name → success / failure.
    const isSuccess =
      ['SETTLED', 'COMPLETED', 'SUCCESS'].includes(rawState) ||
      /success|settled|complete/i.test(eventType);
    const isFailure =
      ['FAILED', 'REVERSED', 'EXPIRED'].includes(rawState) ||
      /fail|revers|expire/i.test(eventType);
    const isReversal = rawState === 'REVERSED' || /revers|refund/i.test(eventType);

    console.log(
      `[Bitnob Webhook] [${requestId}] ${eventType} | order=${orderId} | state=${rawState}`,
    );

    // ─── Replay guard ──────────────────────────────────────────────────────────
    const eventLogId = event.id || `${orderId}-${rawState}`;
    const { error: insertError } = await supabaseAdmin
      .from('webhook_events')
      .insert({
        provider: 'bitnob',
        event_id: eventLogId,
        event_type: eventType,
        payload_json: event as Json,
      })
      .select('id')
      .single();

    if (insertError?.code === '23505') {
      return new Response('Already processed', { status: 200 });
    }

    const markProcessed = () =>
      supabaseAdmin
        .from('webhook_events')
        .update({ processed: true })
        .eq('provider', 'bitnob')
        .eq('event_id', eventLogId);

    // ─── USDC deposit detected → retry finalize until it confirms ─────────────
    // `deposit.success` is detection; the payout stays `pending_address_deposit` until the
    // deposit CONFIRMS (no confirmed event), so finalize is retried in the background.
    // Matched to the withdrawal by the payout-bound deposit address, falling back to the
    // quote_id/reference carried on the deposit event.
    if (/deposit/i.test(eventType) && isSuccess) {
      const depositAddress = (data?.address as string | undefined) ?? undefined;
      let quoteId = (data?.quote_id as string | undefined) ?? undefined;

      if (!quoteId && depositAddress) {
        const { data: w } = await supabaseAdmin
          .from('withdrawals')
          .select('id, provider_metadata')
          .eq('provider', 'bitnob')
          .eq('provider_metadata->>deposit_address', depositAddress)
          .maybeSingle();
        quoteId = (w?.provider_metadata as { quote_id?: string } | null)?.quote_id;
      }

      console.log(
        `[Bitnob Webhook] [${requestId}] deposit detected at ${depositAddress} (${data?.amount} ${data?.currency}) — quote=${quoteId ?? 'unknown'}`,
      );
      if (quoteId) {
        void finalizeWithRetry(quoteId, requestId);
      } else {
        console.warn(
          `[Bitnob Webhook] [${requestId}] no bitnob withdrawal matched for deposit ${depositAddress}`,
        );
      }
      await markProcessed();
      return new Response('OK', { status: 200 });
    }

    if (!isSuccess && !isFailure) {
      console.log(`[Bitnob Webhook] [${requestId}] Intermediate state — no action`);
      return new Response('OK', { status: 200 });
    }

    // ─── Terminal status for a fiat deposit (on-ramp) or a payout (off-ramp) ───
    const { data: dep } = await supabaseAdmin
      .from('deposits')
      .select('id')
      .eq('provider', 'bitnob')
      .eq('provider_order_id', orderId)
      .maybeSingle();

    // A payout terminal event may carry our order reference OR the quote_id — try both,
    // all against provider-agnostic columns.
    let wd = (
      await supabaseAdmin
        .from('withdrawals')
        .select('id, provider_order_id')
        .eq('provider', 'bitnob')
        .eq('provider_order_id', orderId)
        .maybeSingle()
    ).data;
    if (!wd) {
      wd = (
        await supabaseAdmin
          .from('withdrawals')
          .select('id, provider_order_id')
          .eq('provider', 'bitnob')
          .eq('provider_metadata->>quote_id', orderId)
          .maybeSingle()
      ).data;
    }

    let handled = false;

    if (dep) {
      // Fiat deposit (on-ramp)
      const txHash = (data?.txHash || data?.hash || null) as string | null;
      const status = isSuccess ? 'confirmed' : isReversal ? 'reversed' : 'failed';
      const { error } = await supabaseAdmin
        .from('deposits')
        .update({ status, ...(txHash ? { tx_hash: txHash } : {}) })
        .eq('provider_order_id', orderId);
      if (error) {
        console.error(`[Bitnob Webhook] [${requestId}] deposit update failed:`, error.message);
        return new Response('Internal error', { status: 500 });
      }
      handled = true;
    } else if (wd?.provider_order_id) {
      // Payout (off-ramp) — the finalize RPCs match provider_order_id (or legacy id).
      const rpcOrderId = wd.provider_order_id;
      if (isSuccess) {
        const { error } = await supabaseAdmin.rpc('finalize_withdrawal_success', {
          p_paycrest_order_id: rpcOrderId,
        });
        if (error) {
          console.error(`[Bitnob Webhook] [${requestId}] finalize success failed:`, error.message);
          return new Response('Internal error', { status: 500 });
        }
      } else {
        const { error } = await supabaseAdmin.rpc('finalize_withdrawal_failed', {
          p_paycrest_order_id: rpcOrderId,
          p_reason: `Bitnob webhook state=${rawState || eventType}`,
        });
        if (error) {
          console.error(`[Bitnob Webhook] [${requestId}] finalize failed failed:`, error.message);
          return new Response('Internal error', { status: 500 });
        }
        if (isReversal) {
          await supabaseAdmin
            .from('withdrawals')
            .update({ status: 'reversed' })
            .eq('provider_order_id', rpcOrderId);
        }
      }
      handled = true;
    } else {
      console.warn(`[Bitnob Webhook] [${requestId}] No matching bitnob order for ${orderId}`);
    }

    if (handled) {
      await supabaseAdmin
        .from('webhook_events')
        .update({ processed: true })
        .eq('provider', 'bitnob')
        .eq('event_id', eventLogId);
    }

    console.log(`[Bitnob Webhook] [${requestId}] Done in ${Date.now() - requestStart}ms`);
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error(`[Bitnob Webhook] [${requestId}] Unhandled error:`, err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
