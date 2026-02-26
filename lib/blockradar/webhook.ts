/**
 * BlockRadar Webhook Handler
 *
 * Handles webhook events from BlockRadar for deposits and withdrawals.
 */

import crypto from 'crypto';
import type { WebhookEventType, WebhookPayload } from './types';

/**
 * Verify the webhook signature from BlockRadar.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
}

/**
 * Parse and validate a BlockRadar webhook payload.
 */
export function parseWebhookPayload(body: string): WebhookPayload | null {
  try {
    const payload = JSON.parse(body) as WebhookPayload;

    // Validate required fields
    if (!payload.event || !payload.data) {
      console.error('[BlockRadar Webhook] Invalid payload structure');
      return null;
    }

    return payload;
  } catch (error) {
    console.error('[BlockRadar Webhook] Failed to parse payload:', error);
    return null;
  }
}

/**
 * Check if this is a deposit event.
 */
export function isDepositEvent(event: WebhookEventType): boolean {
  return event === 'deposit.success' || event === 'deposit.pending';
}

/**
 * Check if this is a withdrawal event.
 */
export function isWithdrawalEvent(event: WebhookEventType): boolean {
  return event === 'withdrawal.success' || event === 'withdrawal.failed';
}

/**
 * Check if this is a sweep event.
 */
export function isSweepEvent(event: WebhookEventType): boolean {
  return event === 'sweep.success' || event === 'sweep.failed';
}

/**
 * Extract user ID from webhook metadata if present.
 */
export function extractUserIdFromMetadata(
  metadata?: Record<string, unknown>,
): string | null {
  if (!metadata) return null;
  return (metadata.user_id as string) || null;
}
