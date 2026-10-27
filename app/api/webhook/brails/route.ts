import { verifyBrailsSignature } from '@/lib/brails/client';
import { onBrailsDeposit, onBrailsPayout, type BrailsEventData } from '@/lib/ramp/brails-payout';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import type { Json } from '@/types/database';

/**
 * POST /api/webhook/brails
 *
 * Brails' events for withdrawals it pays out:
 *   collection.deposit.success — the user's USDC reached their Brails address → start the payout
 *   payout.transfer.success    — the beneficiary was paid → withdrawal completed
 *   payout.transfer.failed     — the payout failed → withdrawal failed, amount owed back
 *
 * Signed with HMAC-SHA512 (`x-brails-signature`). A valid signature is the first gate; the
 * handlers then re-read the transaction from Brails before acting on it.
 *
 * Responds 500 only when a retry could help (Brails retries a non-200 three times); anything
 * permanent is answered 200 so it is not redelivered for nothing.
 *
 * Redeliveries are safe without a replay table: starting and settling a payout are each claimed
 * with a conditional update on the withdrawal (lib/ramp/brails-payout.ts), so only one delivery
 * acts. Events are logged to `webhook_events` for the admin log only — a redelivery (same event
 * id) is still handled, and a failed log write never holds up a payout.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get('x-brails-signature');

  let event: { event?: string; data?: BrailsEventData & { action?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const type = event.event ?? 'unknown';
  const data = event.data ?? {};

  if (!verifyBrailsSignature(raw, signature)) {
    console.warn(`[Brails Webhook] Rejected ${type} (${data.id ?? '-'}): ${signature ? 'invalid' : 'missing'} signature`);
    // The unverified body is not stored — only what identifies the attempt.
    await logEvent(`rejected-${Date.now()}`, `signature_rejected:${type}`, {
      reason: signature ? 'invalid signature' : 'missing signature',
      event: type,
      id: data.id ?? null,
    });
    return new Response('Invalid signature', { status: 401 });
  }
  console.log(`[Brails Webhook] ${type} ${data.id ?? '-'} status=${data.status ?? '-'} action=${data.action ?? '-'}`);
  const eventId = `${type}:${data.id ?? Date.now()}`;
  await logEvent(eventId, type, event as Json);

  try {
    let outcome: Awaited<ReturnType<typeof onBrailsDeposit>> | null = null;
    // Case-insensitive: webhooks send `deposit_usd`, the transactions API `DEPOSIT_USD`.
    if (type === 'collection.deposit.success' && data.action?.toLowerCase() === 'deposit_usd') {
      // A stablecoin deposit (credited to our USD wallet). Fiat collections share the event
      // name with a `deposit_<currency>` action and are not ours to handle here.
      outcome = await onBrailsDeposit(data);
    } else if (type === 'payout.transfer.success') {
      outcome = await onBrailsPayout(data, true);
    } else if (type === 'payout.transfer.failed') {
      outcome = await onBrailsPayout(data, false);
    }

    if (!outcome) return new Response('Ignored', { status: 200 });
    console.log(`[Brails Webhook] ${type} ${data.id ?? '-'}: ${outcome.note}`);
    if (outcome.ok) await markProcessed(eventId);
    return new Response(outcome.ok || !outcome.retry ? 'OK' : 'Retry', {
      status: outcome.ok || !outcome.retry ? 200 : 500,
    });
  } catch (err) {
    console.error(`[Brails Webhook] ${type} ${data.id ?? '-'} failed:`, err);
    return new Response('Internal error', { status: 500 });
  }
}

/** Best effort: the admin log must never be why a payout is held up. */
async function logEvent(eventId: string, eventType: string, payload: Json) {
  try {
    const { error } = await supabaseAdmin
      .from('webhook_events')
      .insert({ provider: 'brails', event_id: eventId, event_type: eventType, payload_json: payload, processed: false });
    // 23505: a redelivery, already logged.
    if (error && error.code !== '23505') console.warn(`[Brails Webhook] could not log ${eventId}: ${error.message}`);
  } catch (err) {
    console.warn(`[Brails Webhook] could not log ${eventId}:`, err);
  }
}

async function markProcessed(eventId: string) {
  try {
    await supabaseAdmin
      .from('webhook_events')
      .update({ processed: true })
      .eq('provider', 'brails')
      .eq('event_id', eventId);
  } catch {
    /* log only */
  }
}
