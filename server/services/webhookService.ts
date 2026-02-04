/**
 * Webhook Service
 *
 * Business logic for processing Paycrest webhooks.
 */

import {
    mapEventToWithdrawalStatus,
    parseWebhookPayload,
    verifyWebhookSignature,
} from '@/lib/paycrest';
import {
    AUDIT_ACTIONS,
    createAuditLog,
    findWithdrawalByPaycrestOrderId,
    isEventProcessed,
    markEventProcessed,
    storeWebhookEvent,
} from '@/server/repositories';
import type { Json, WebhookPayload } from '@/types';
import { completeWithdrawal, failWithdrawal } from './withdrawalService';

export interface ProcessWebhookResult {
  success: boolean;
  message: string;
  alreadyProcessed?: boolean;
}

/**
 * Process a Paycrest webhook event
 */
export async function processPaycrestWebhook(
  rawBody: string,
  signature: string,
): Promise<ProcessWebhookResult> {
  // Verify signature
  const secret = process.env.PAYCREST_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[WebhookService] PAYCREST_WEBHOOK_SECRET not set');
    return { success: false, message: 'Webhook secret not configured' };
  }

  const isValid = verifyWebhookSignature(rawBody, signature, secret);
  if (!isValid) {
    console.error('[WebhookService] Invalid webhook signature');
    return { success: false, message: 'Invalid signature' };
  }

  // Parse payload
  let payload: WebhookPayload;
  try {
    payload = parseWebhookPayload(rawBody);
  } catch {
    return { success: false, message: 'Invalid payload' };
  }

  const { eventId, eventType, data } = payload;

  // Check idempotency
  const alreadyProcessed = await isEventProcessed('paycrest', eventId);
  if (alreadyProcessed) {
    return {
      success: true,
      message: 'Already processed',
      alreadyProcessed: true,
    };
  }

  // Store the event
  await storeWebhookEvent('paycrest', eventId, payload as unknown as Json);

  // Log webhook receipt
  await createAuditLog({
    action: AUDIT_ACTIONS.WEBHOOK_RECEIVED,
    metadata: {
      provider: 'paycrest',
      eventId,
      eventType,
      orderId: data.id,
    },
  });

  // Find related withdrawal
  const withdrawal = await findWithdrawalByPaycrestOrderId(data.id);
  if (!withdrawal) {
    console.warn(`[WebhookService] No withdrawal found for order ${data.id}`);
    await markEventProcessed('paycrest', eventId);
    return { success: true, message: 'No matching withdrawal' };
  }

  // Map event to status and handle accordingly
  const mappedStatus = mapEventToWithdrawalStatus(eventType);

  switch (mappedStatus) {
    case 'completed':
      await completeWithdrawal(withdrawal.id, data.fiatAmount);
      break;
    case 'failed':
      await failWithdrawal(withdrawal.id, 'Payout failed');
      break;
    case 'reversed':
      await failWithdrawal(withdrawal.id, 'Payout reversed/refunded');
      break;
    case 'processing':
      // Already in processing state, no action needed
      break;
  }

  // Mark event as processed
  await markEventProcessed('paycrest', eventId);

  // Log completion
  await createAuditLog({
    userId: withdrawal.user_id,
    action: AUDIT_ACTIONS.WEBHOOK_PROCESSED,
    metadata: {
      provider: 'paycrest',
      eventId,
      eventType,
      withdrawalId: withdrawal.id,
      newStatus: mappedStatus,
    },
  });

  return { success: true, message: `Processed ${eventType}` };
}
