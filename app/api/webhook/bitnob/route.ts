import { Database, Json } from '@/types/database';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { verifyBitnobSignature } from '@/lib/bitnob/webhook-signature';
import { triggerWithdrawalNotifications } from '@/lib/supabase/transactions';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRole);

export const runtime = 'nodejs';
// Allow room for the finalize retry loop (deposit confirmation can take a moment).
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Finalize the payout once its deposit has SETTLED.
 *
 * `deposit.success` means detected, not received — Bitnob emits no confirmed event, and will
 * accept `finalize` on detection alone. So we confirm settlement ourselves before releasing
 * the payout, and retry with backoff while it is still pending.
 *
 * NOTE: this runs within one serverless invocation. The reconcile cron re-drives anything
 * left un-finalized.
 */
async function finalizeWithRetry(
  quoteId: string,
  tag: string,
  deposit: { address?: string; txHash?: string; amountUsdc?: number },
): Promise<boolean> {
  const { getBitnobClient } = await import('@/lib/bitnob/client');
  const client = getBitnobClient();

  // Nothing to verify against — refuse rather than guess, and let the cron re-drive.
  if (!deposit.address && !deposit.txHash) {
    console.error(
      `[Bitnob Webhook] [${tag}] REFUSING to finalize ${quoteId} — no deposit address or tx hash to verify against`,
    );
    return false;
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    // Prefer the hash Bitnob reported for THIS deposit. It is unique per deposit on every
    // chain, where the address is shared on Stellar — matching on that let one payout settle
    // against a different user's deposit of the same size.
    const settled = await client
      .findSettledDeposit({
        address: deposit.address,
        txHash: deposit.txHash,
        minAmountUsdc: deposit.amountUsdc,
      })
      .catch(() => null);

    if (!settled) {
      console.log(`[Bitnob Webhook] [${tag}] ${quoteId}: deposit detected but not settled (attempt ${attempt}/5)`);
      await sleep(5000);
      continue;
    }

    try {
      await client.finalizePayout(quoteId);
      console.log(
        `[Bitnob Webhook] [${tag}] finalized ${quoteId} against settled deposit ${settled.reference} (${settled.amountUsdc} USDC)`,
      );
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/pending_address_deposit|cannot transition/i.test(msg)) {
        console.log(`[Bitnob Webhook] [${tag}] ${quoteId}: awaiting settlement readiness (attempt ${attempt}/5)`);
        await sleep(5000);
        continue;
      }
      console.error(`[Bitnob Webhook] [${tag}] finalize ${quoteId} aborted:`, msg);
      return false;
    }
  }
  console.warn(`[Bitnob Webhook] [${tag}] finalize ${quoteId} gave up after retries — NOT finalized`);
  return false;
}

/**
 * The fiat actually settled, per the terminal payout event — the last word on what the
 * beneficiary received.
 *
 * The row already holds the amount Bitnob QUOTED (recorded at order creation from the quote the
 * user reviewed), which is normally exactly this. This closes the remaining gap: if Bitnob ever
 * settles at something other than it quoted, the receipt follows the money rather than the
 * promise.
 *
 * Read defensively across the keys Bitnob has used for a destination amount. A bare `amount` is
 * only trusted when the event names the same currency as the row — on a payout event it is
 * otherwise just as likely to be the USDC leg, and writing that into `fiat_amount` would turn a
 * 58,000 NGN receipt into a 42 NGN one.
 */
function settledFiatAmount(
  data: Record<string, unknown> | undefined,
  rowCurrency: string | null,
): number | null {
  if (!data) return null;

  const candidates: unknown[] = [
    data.settlement_amount,
    data.amount_to_receive,
    data.receive_amount,
    data.destination_amount,
    data.to_amount,
  ];
  const eventCurrency = typeof data.currency === "string" ? data.currency : null;
  if (rowCurrency && eventCurrency?.toUpperCase() === rowCurrency.toUpperCase()) {
    candidates.push(data.amount);
  }

  for (const c of candidates) {
    if (c == null || c === "") continue;
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Bitnob webhook. Verifies the HMAC-SHA512 signature, then drives the payout:
 *   deposit.success   → deposit detected → deferred payouts initialize + finalize here
 *                      (the beneficiary is sealed until the money lands); others finalize
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
    // HMAC-SHA512 over the RAW body, in x-bitnob-signature. See lib/bitnob/webhook-signature
    // for why the raw bytes matter: hashing a re-serialised parse silently rejected every
    // event carrying a numeric amount — which is all of the deposit events — and that is what
    // left Kenyan payouts stuck until their quote expired.
    const webhookSecret = process.env.BITNOB_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error(`[Bitnob Webhook] [${requestId}] BITNOB_WEBHOOK_SECRET not set`);
      return new Response('Webhook secret not configured', { status: 500 });
    }

    const signature = headers['x-bitnob-signature'];
    const eventType = event.event || event.type || 'unknown';

    // ─── Test Webhook Ping ──────────────────────────────────────────────────
    if (eventType === 'webhook.test' || eventType === 'ping' || eventType === 'test' || signature === 'test_signature') {
      console.log(`[Bitnob Webhook] [${requestId}] Test webhook ping received (${eventType})`);
      return new Response(JSON.stringify({ status: 'success', message: 'Webhook test received' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sigOk = verifyBitnobSignature({
      rawBody: payload,
      signature: String(signature),
      secret: webhookSecret,
    });

    if (!sigOk) {
      const rejectedEvent = event.event ?? event.type ?? 'unknown';
      console.error(
        `[Bitnob Webhook] [${requestId}] Signature mismatch — event=${rejectedEvent}`,
      );
      await supabaseAdmin
        .from('webhook_events')
        .insert({
          provider: 'bitnob',
          event_id: `rejected-${requestId}-${Date.now()}`,
          event_type: `signature_rejected:${rejectedEvent}`,
          payload_json: {
            reason: 'HMAC did not match the raw body or its compact re-serialisation',
            event: rejectedEvent,
            reference: event.data?.reference ?? event.data?.id ?? null,
          } as Json,
          processed: false,
        })
        .then(undefined, () => undefined);
      return new Response('Invalid signature', { status: 400 });
    }

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

    // ─── USDC deposit detected → finalize once it settles ─────────────────────
    if (/deposit/i.test(eventType) && isSuccess) {
      const eventAddress = (data?.address as string | undefined) ?? undefined;
      const eventQuoteId = (data?.quote_id as string | undefined) ?? undefined;
      // Bitnob's own hash for this deposit. Deposit events carry no quote_id, so on Stellar —
      // where every payout shares one static deposit address — this is the ONLY field that says
      // which withdrawal the money belongs to.
      const eventHash = data?.hash ?? data?.txHash ?? undefined;

      // Resolve our record from most precise identifier to least. The address used to be
      // matched with `.maybeSingle()`, which ERRORS when more than one row matches — so on
      // Stellar, where 12 withdrawals share one address, it returned nothing and the payout was
      // never finalized. It sat in pending_address_deposit until its quote expired.
      const lookups: Array<[string, string]> = [];
      if (eventQuoteId) lookups.push(['provider_metadata->>quote_id', eventQuoteId]);
      if (eventHash) lookups.push(['tx_hash', eventHash]);
      if (eventAddress) lookups.push(['provider_metadata->>deposit_address', eventAddress]);

      type BitnobWithdrawalRow = {
        id: string;
        amount_usdc: number | null;
        provider_metadata: Json;
        // Present only while a deferred payout is still waiting for its deposit. Its presence
        // is what says "this quote has no beneficiary yet", i.e. finalize alone cannot work.
        pending_beneficiary: string | null;
        provider_order_id: string | null;
        fiat_currency: string;
        tx_hash: string | null;
      };
      let w: BitnobWithdrawalRow | null = null;
      for (const [column, value] of lookups) {
        // Newest first, capped at one row: a shared address narrows to the payout still waiting
        // on its deposit rather than blowing up the query.
        const { data: rows } = await supabaseAdmin
          .from('withdrawals')
          .select('id, amount_usdc, provider_metadata, pending_beneficiary, provider_order_id, fiat_currency, tx_hash')
          .eq('provider', 'bitnob')
          .eq('status', 'processing')
          .eq(column, value)
          .order('created_at', { ascending: false })
          .limit(1);
        if (rows && rows.length > 0) {
          w = rows[0] as BitnobWithdrawalRow;
          break;
        }
      }

      const meta = (w?.provider_metadata ?? null) as
        | { quote_id?: string; deposit_address?: string }
        | null;
      const quoteId = eventQuoteId ?? meta?.quote_id;
      const depositAddress = eventAddress ?? meta?.deposit_address;
      // Base amount — a lower bound, since the deposit also carries the corridor fee.
      const expectedUsdc = w?.amount_usdc != null ? Number(w.amount_usdc) : undefined;

      console.log(
        `[Bitnob Webhook] [${requestId}] deposit detected at ${depositAddress} (${data?.amount} ${data?.currency}) — quote=${quoteId ?? 'unknown'}`,
      );
      if (quoteId && w?.pending_beneficiary) {
        // ── Deferred payout: the beneficiary is still sealed, so NO payout exists yet ──
        //
        // Finalizing here does nothing — there is nothing to finalize. The beneficiary has to be
        // attached first, and this event is the earliest moment that is possible, because it is
        // the first proof the deposit arrived.
        //
        // That step used to run only in the user's browser, with a once-a-day cron as the sole
        // backstop. So a closed tab between "money sent" and "beneficiary attached" left the
        // deposit with no payout to belong to, and on Stellar — one static address, our
        // reference discarded — nothing on the provider's side could ever reattach it. The
        // withdrawal failed with the user's USDC already gone.
        //
        // Settlement is the server's job. The browser is now only an optimisation.
        const txHash = (eventHash as string | undefined) ?? w.tx_hash ?? undefined;
        if (!txHash) {
          console.error(
            `[Bitnob Webhook] [${requestId}] deferred payout ${quoteId} has no tx_hash to ` +
              `verify against — leaving it for the reconcile cron.`,
          );
        } else {
          const { openBeneficiary } = await import('@/lib/ramp/beneficiary-vault');
          const beneficiary = openBeneficiary(w.pending_beneficiary);
          if (!beneficiary) {
            console.error(
              `[Bitnob Webhook] [${requestId}] could not open the sealed beneficiary for ` +
                `${quoteId} — leaving it for the reconcile cron.`,
            );
          } else {
            const { completeDeferredPayout } = await import('@/lib/ramp/deferred-settle');
            const { getCorridorFee } = await import('@/lib/ramp/fees');
            const meta2 = (w.provider_metadata ?? null) as { network?: string } | null;
            const base = w.amount_usdc != null ? Number(w.amount_usdc) : 0;
            void completeDeferredPayout(
              {
                rowId: w.id,
                quoteId,
                orderId: w.provider_order_id ?? '',
                txHash,
                requiredUsdc: base + getCorridorFee('bitnob', w.fiat_currency),
                network: meta2?.network ?? 'stellar',
                fiatCurrency: w.fiat_currency,
                bank: beneficiary,
                currentTxHash: w.tx_hash,
                // The deposit is already confirmed enough for Bitnob to have emitted this event,
                // so it should be visible almost immediately. The cron covers the rest.
                maxAttempts: 5,
              },
              `[Bitnob Webhook] [${requestId}] deferred ${w.provider_order_id}:`,
            );
          }
        }
      } else if (quoteId) {
        void finalizeWithRetry(quoteId, requestId, {
          address: depositAddress,
          txHash: eventHash,
          amountUsdc: expectedUsdc,
        });
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
    const WITHDRAWAL_COLUMNS = 'id, provider_order_id, fiat_currency, fiat_amount, amount_usdc';
    let wd = (
      await supabaseAdmin
        .from('withdrawals')
        .select(WITHDRAWAL_COLUMNS)
        .eq('provider', 'bitnob')
        .eq('provider_order_id', orderId)
        .maybeSingle()
    ).data;
    if (!wd) {
      wd = (
        await supabaseAdmin
          .from('withdrawals')
          .select(WITHDRAWAL_COLUMNS)
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

      // Guard against duplicate webhook runs or race conditions with polling
      const { data: currentW } = await supabaseAdmin
        .from('withdrawals')
        .select('status')
        .eq('provider_order_id', rpcOrderId)
        .maybeSingle();

      if (currentW && currentW.status !== 'processing') {
        console.log(`[Bitnob Webhook] [${requestId}] Withdrawal ${rpcOrderId} already processed (status=${currentW.status})`);
        return new Response('Already processed', { status: 200 });
      }

      if (isSuccess) {
        // Follow the money: if the settled figure differs from the quoted one on record, the
        // receipt takes the settled figure. Written before the finalize RPC so a receipt is
        // never rendered from a superseded number.
        const settledFiat = settledFiatAmount(data, wd.fiat_currency);
        if (settledFiat != null && Math.abs(settledFiat - Number(wd.fiat_amount ?? 0)) > 0.01) {
          const usdc = Number(wd.amount_usdc);
          console.log(
            `[Bitnob Webhook] [${requestId}] ${rpcOrderId} settled at ${settledFiat} ` +
              `${wd.fiat_currency} (recorded ${wd.fiat_amount}) — updating the receipt.`,
          );
          const { error: reconcileError } = await supabaseAdmin
            .from('withdrawals')
            .update({
              fiat_amount: settledFiat,
              ...(Number.isFinite(usdc) && usdc > 0
                ? { exchange_rate: settledFiat / usdc }
                : {}),
            })
            .eq('id', wd.id);
          // A stale amount is worth a loud log, but not worth failing the payout's finalize.
          if (reconcileError) {
            console.error(
              `[Bitnob Webhook] [${requestId}] could not update fiat_amount for ${rpcOrderId}:`,
              reconcileError.message,
            );
          }
        }

        const { error } = await supabaseAdmin.rpc('finalize_withdrawal_success', {
          p_paycrest_order_id: rpcOrderId,
        });
        if (error) {
          console.error(`[Bitnob Webhook] [${requestId}] finalize success failed:`, error.message);
          return new Response('Internal error', { status: 500 });
        }
        await triggerWithdrawalNotifications(rpcOrderId, 'completed');
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
        } else {
          await triggerWithdrawalNotifications(rpcOrderId, 'failed');
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
