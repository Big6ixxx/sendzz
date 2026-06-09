import { Database, Json } from '@/types/database';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRole);

// We must use the Edge Runtime or Node runtime.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers.entries());

    const webhookSecret = process.env.PAYCREST_API_SECRET;

    if (!webhookSecret) {
      console.error('[Paycrest Webhook] Missing PAYCREST_API_SECRET');
      return new Response('Webhook secret not configured', { status: 500 });
    }

    const signature = headers['x-paycrest-signature'] || headers['X-Paycrest-Signature'];
    if (!signature) {
      console.error('[Paycrest Webhook] Missing x-paycrest-signature header');
      return new Response('Missing signature header', { status: 400 });
    }

    const cleanSignature = String(signature).trim().toLowerCase();
    const computedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    if (cleanSignature.length !== computedSignature.length) {
      console.error('[Paycrest Webhook] Signature length mismatch');
      return new Response('Invalid signature', { status: 400 });
    }

    const isSignatureValid = crypto.timingSafeEqual(
      Buffer.from(cleanSignature, 'hex'),
      Buffer.from(computedSignature, 'hex')
    );

    if (!isSignatureValid) {
      console.error('[Paycrest Webhook] Signature mismatch');
      return new Response('Invalid signature', { status: 400 });
    }

    interface PaycrestEvent {
      id?: string;
      eventId?: string;
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
      console.error('[Paycrest Webhook] Invalid JSON payload:', err);
      return new Response('Invalid JSON payload', { status: 400 });
    }

    // The event payload structure usually has eventId, type, and data.
    // E.g. eventType = "order.status.updated", data = { id: "order_id", status: "settled" }
    const eventType = event.type || event.eventType;
    const orderData = event.data;

    if (!orderData || !orderData.id) {
      return new Response('Invalid event data', { status: 400 });
    }

    const orderId = orderData.id;
    const status = orderData.status;

    console.log(
      `[Paycrest Webhook] Received ${eventType} for order ${orderId} with status ${status}`,
    );

    // Track the webhook event in the database to prevent replay attacks and for audit
    const { error: insertError } = await supabaseAdmin
      .from('webhook_events')
      .insert({
        provider: 'paycrest',
        event_id: event.id || event.eventId || `${orderId}-${status}`,
        event_type: eventType,
        payload_json: event as Json,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        console.log(`[Paycrest Webhook] Event already processed`);
        return new Response('Already processed', { status: 200 });
      }
      console.error(
        '[Paycrest Webhook] Failed to log webhook event:',
        insertError,
      );
    }

    const direction = orderData.direction || 'offramp';

    if (direction === 'onramp') {
      // Process DEPOSIT
      if (status && ['settled', 'completed', 'validated', 'deposited'].includes(status)) {
        const { error } = await supabaseAdmin
          .from('deposits')
          .update({
            status: 'confirmed',
            tx_hash: orderData.txHash || orderData.settlementTxHash || orderData.transactionHash || null,
          })
          .eq('paycrest_tx_id', orderId);
        
        if (error) {
          console.error(`[Paycrest Webhook] Failed to confirm deposit ${orderId}:`, error);
          return new Response('Internal error', { status: 500 });
        }
        console.log(`[Paycrest Webhook] Successfully confirmed deposit ${orderId}`);
      } else if (status && ['failed', 'refunded', 'expired', 'refunding'].includes(status)) {
        const { error } = await supabaseAdmin
          .from('deposits')
          .update({ status: 'failed' })
          .eq('paycrest_tx_id', orderId);

        if (error) {
          console.error(`[Paycrest Webhook] Failed to fail deposit ${orderId}:`, error);
          return new Response('Internal error', { status: 500 });
        }
        console.log(`[Paycrest Webhook] Successfully marked deposit ${orderId} as failed`);
      }
    } else {
      // Process WITHDRAWAL (offramp)
      if (status && ['settled', 'completed', 'validated', 'deposited'].includes(status)) {
        const { error } = await supabaseAdmin.rpc('finalize_withdrawal_success', {
          p_paycrest_order_id: orderId,
        });
        if (error) {
          console.error(
            `[Paycrest Webhook] Failed to finalize success for withdrawal ${orderId}:`,
            error,
          );
          return new Response('Internal error', { status: 500 });
        }
        console.log(
          `[Paycrest Webhook] Successfully finalized withdrawal ${orderId}`,
        );
      } else if (status && ['failed', 'refunded', 'expired', 'refunding'].includes(status)) {
        const { error } = await supabaseAdmin.rpc('finalize_withdrawal_failed', {
          p_paycrest_order_id: orderId,
          p_reason:
            orderData.failureReason ||
            orderData.reason ||
            'Webhook reported failure status',
        });
        if (error) {
          console.error(
            `[Paycrest Webhook] Failed to finalize failure for withdrawal ${orderId}:`,
            error,
          );
          return new Response('Internal error', { status: 500 });
        }
        console.log(
          `[Paycrest Webhook] Successfully marked failed withdrawal ${orderId}`,
        );
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[Paycrest Webhook] Unhandled error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
