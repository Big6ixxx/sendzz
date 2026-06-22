import { Database, Json } from '@/types/database';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRole);

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const requestStart = Date.now();
  const requestId = crypto.randomBytes(4).toString('hex');

  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers.entries());

    if (!payload) {
      console.error(`[Paycrest Webhook] [${requestId}] Empty request body`);
      return new Response('Empty body', { status: 400 });
    }

    // ─── Secret check ─────────────────────────────────────────────────────────
    const webhookSecret = process.env.PAYCREST_API_SECRET;
    if (!webhookSecret) {
      console.error(`[Paycrest Webhook] [${requestId}] PAYCREST_API_SECRET is not set`);
      return new Response('Webhook secret not configured', { status: 500 });
    }

    // ─── Signature verification ───────────────────────────────────────────────
    const signature = headers['x-paycrest-signature'] || headers['X-Paycrest-Signature'];
    if (!signature) {
      console.error(`[Paycrest Webhook] [${requestId}] Missing x-paycrest-signature header`);
      return new Response('Missing signature header', { status: 400 });
    }

    const receivedSig = String(signature).trim().toLowerCase();
    const key = String(webhookSecret).replace(/['"]/g, '').trim();

    // Paycrest quirk: signs with json.Marshal (no trailing newline) but sends
    // body with json.Encoder.Encode (adds \n). Try both.
    const payloadBuf = Buffer.from(payload, 'utf8');
    const strippedBuf = (
      payloadBuf.length >= 2 &&
      payloadBuf[payloadBuf.length - 2] === 0x0d &&
      payloadBuf[payloadBuf.length - 1] === 0x0a
    )
      ? payloadBuf.subarray(0, payloadBuf.length - 2)
      : (payloadBuf.length >= 1 && payloadBuf[payloadBuf.length - 1] === 0x0a)
        ? payloadBuf.subarray(0, payloadBuf.length - 1)
        : payloadBuf;

    function hmacHex(buf: Buffer): string {
      return crypto.createHmac('sha256', key).update(buf).digest('hex').toLowerCase();
    }

    function sigMatch(buf: Buffer): boolean {
      const computed = hmacHex(buf);
      if (receivedSig.length !== computed.length) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(receivedSig, 'utf8'));
      } catch { return false; }
    }

    if (!sigMatch(payloadBuf) && !sigMatch(strippedBuf)) {
      console.error(`[Paycrest Webhook] [${requestId}] Signature mismatch — wrong secret or tampered payload`);
      return new Response('Invalid signature', { status: 400 });
    }

    // ─── Parse JSON ───────────────────────────────────────────────────────────
    interface PaycrestEvent {
      id?: string;
      eventId?: string;
      event?: string;
      type?: string;
      eventType?: string;
      data?: {
        id?: string;
        status?: string;
        failureReason?: string;
        reason?: string;
        direction?: string;
        txHash?: string;
        settlementTxHash?: string;
        transactionHash?: string;
        [key: string]: Json | undefined;
      };
      [key: string]: Json | undefined;
    }

    let event: PaycrestEvent;
    try {
      event = JSON.parse(payload) as PaycrestEvent;
    } catch (err) {
      console.error(`[Paycrest Webhook] [${requestId}] Failed to parse JSON payload:`, err);
      return new Response('Invalid JSON payload', { status: 400 });
    }

    // ─── Extract event metadata ───────────────────────────────────────────────
    const eventType = event.event || event.type || event.eventType || 'unknown';
    const orderData = event.data;

    if (!orderData || !orderData.id) {
      console.error(`[Paycrest Webhook] [${requestId}] Missing order data — eventType=${eventType}`);
      return new Response('Invalid event data', { status: 400 });
    }

    const orderId = orderData.id;
    const status = orderData.status;
    const direction = orderData.direction || 'offramp';

    console.log(`[Paycrest Webhook] [${requestId}] ${eventType} | order=${orderId} | status=${status} | direction=${direction}`);

    // ─── Log to webhook_events (replay-attack guard) ──────────────────────────
    const eventLogId = event.id || event.eventId || `${orderId}-${status}`;
    const { error: insertError } = await supabaseAdmin
      .from('webhook_events')
      .insert({
        provider: 'paycrest',
        event_id: eventLogId,
        event_type: eventType,
        payload_json: event as Json,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        console.warn(`[Paycrest Webhook] [${requestId}] Duplicate event ignored — event_id=${eventLogId}`);
        return new Response('Already processed', { status: 200 });
      }
      // Non-fatal — keep processing so Paycrest gets a 200 and stops retrying
      console.error(`[Paycrest Webhook] [${requestId}] Failed to log to webhook_events (non-fatal):`, insertError.message);
    }

    // ─── Process event ────────────────────────────────────────────────────────
    let handled = false; // tracks whether this event triggered a real DB action

    if (direction === 'onramp') {
      // DEPOSIT
      if (status && ['settled', 'completed', 'validated', 'deposited'].includes(status)) {
        const txHash = orderData.txHash || orderData.settlementTxHash || orderData.transactionHash || null;
        const { error } = await supabaseAdmin
          .from('deposits')
          .update({ status: 'confirmed', tx_hash: txHash })
          .eq('paycrest_tx_id', orderId);

        if (error) {
          console.error(`[Paycrest Webhook] [${requestId}] Failed to confirm deposit ${orderId}:`, error.message);
          return new Response('Internal error', { status: 500 });
        }
        console.log(`[Paycrest Webhook] [${requestId}] Deposit ${orderId} confirmed`);
        handled = true;

      } else if (status && ['failed', 'refunded', 'expired', 'refunding'].includes(status)) {
        const reason = orderData.failureReason || orderData.reason || 'unknown';
        const finalStatus = ['refunded', 'refunding'].includes(status) ? 'reversed' : 'failed';
        const { error } = await supabaseAdmin
          .from('deposits')
          .update({ status: finalStatus })
          .eq('paycrest_tx_id', orderId);

        if (error) {
          console.error(`[Paycrest Webhook] [${requestId}] Failed to update deposit ${orderId} status:`, error.message);
          return new Response('Internal error', { status: 500 });
        }
        console.warn(`[Paycrest Webhook] [${requestId}] Deposit ${orderId} status updated to ${finalStatus} — reason=${reason}`);
        handled = true;

      } else {
        console.log(`[Paycrest Webhook] [${requestId}] Deposit ${orderId} intermediate status=${status} — no action`);
      }

    } else {
      // WITHDRAWAL
      if (status && ['settled', 'completed', 'validated', 'deposited'].includes(status)) {
        const { error } = await supabaseAdmin.rpc('finalize_withdrawal_success', {
          p_paycrest_order_id: orderId,
        });

        if (error) {
          console.error(`[Paycrest Webhook] [${requestId}] finalize_withdrawal_success failed for ${orderId}:`, error.message);
          return new Response('Internal error', { status: 500 });
        }
        console.log(`[Paycrest Webhook] [${requestId}] Withdrawal ${orderId} finalized`);
        handled = true;

      } else if (status && ['failed', 'refunded', 'expired', 'refunding'].includes(status)) {
        const reason = orderData.failureReason || orderData.reason || 'Webhook reported failure status';
        const { error } = await supabaseAdmin.rpc('finalize_withdrawal_failed', {
          p_paycrest_order_id: orderId,
          p_reason: reason,
        });

        if (error) {
          console.error(`[Paycrest Webhook] [${requestId}] finalize_withdrawal_failed failed for ${orderId}:`, error.message);
          return new Response('Internal error', { status: 500 });
        }

        const finalStatus = ['refunded', 'refunding'].includes(status) ? 'reversed' : 'failed';
        if (finalStatus === 'reversed') {
          const { error: updateErr } = await supabaseAdmin
            .from('withdrawals')
            .update({ status: 'reversed' })
            .eq('paycrest_order_id', orderId);
          if (updateErr) {
            console.error(`[Paycrest Webhook] [${requestId}] Failed to set withdrawal status to reversed:`, updateErr.message);
          }
        }
        console.warn(`[Paycrest Webhook] [${requestId}] Withdrawal ${orderId} finalized as ${finalStatus} — reason=${reason}`);
        handled = true;

      } else {
        console.log(`[Paycrest Webhook] [${requestId}] Withdrawal ${orderId} intermediate status=${status} — no action`);
      }
    }

    // Mark as processed in webhook_events so the admin dashboard shows the correct status
    if (handled) {
      await supabaseAdmin
        .from('webhook_events')
        .update({ processed: true })
        .eq('provider', 'paycrest')
        .eq('event_id', eventLogId);
    }

    console.log(`[Paycrest Webhook] [${requestId}] Done in ${Date.now() - requestStart}ms`);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error(`[Paycrest Webhook] [${requestId}] Unhandled error after ${Date.now() - requestStart}ms:`, err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
