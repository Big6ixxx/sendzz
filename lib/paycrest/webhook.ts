/**
 * Paycrest Webhook Utilities
 *
 * Functions for verifying and processing Paycrest webhooks.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { WebhookEventType, WebhookPayload } from './types';

/**
 * Verify Paycrest webhook signature
 *
 * @param payload - Raw request body as string
 * @param signature - Signature from X-Paycrest-Signature header
 * @param secret - Webhook secret from PAYCREST_WEBHOOK_SECRET
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }

  try {
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    // Use timing-safe comparison to prevent timing attacks
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Parse webhook payload
 */
export function parseWebhookPayload(body: string): WebhookPayload {
  try {
    return JSON.parse(body) as WebhookPayload;
  } catch {
    throw new Error('Invalid webhook payload');
  }
}

/**
 * Check if event type is a terminal status (no more updates expected)
 */
export function isTerminalStatus(eventType: WebhookEventType): boolean {
  return ['order.settled', 'order.failed', 'order.refunded'].includes(
    eventType,
  );
}

/**
 * Map webhook event type to internal withdrawal status
 */
export function mapEventToWithdrawalStatus(
  eventType: WebhookEventType,
): 'processing' | 'completed' | 'failed' | 'reversed' {
  switch (eventType) {
    case 'order.pending':
    case 'order.processing':
      return 'processing';
    case 'order.settled':
      return 'completed';
    case 'order.failed':
      return 'failed';
    case 'order.refunded':
      return 'reversed';
    default:
      return 'processing';
  }
}
