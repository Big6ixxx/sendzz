/**
 * Paycrest Webhook Handler
 *
 * POST /api/webhooks/paycrest
 * Handles incoming webhooks from Paycrest for order status updates.
 */

import { processPaycrestWebhook } from '@/server/services';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();

    // Get signature from header
    const signature = request.headers.get('X-Paycrest-Signature') || '';

    if (!signature) {
      console.warn('[Webhook] Missing signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    // Process the webhook
    const result = await processPaycrestWebhook(rawBody, signature);

    if (!result.success) {
      console.error('[Webhook] Processing failed:', result.message);
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    // Return 200 to acknowledge receipt
    // (even for already-processed events to prevent retries)
    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error('[Webhook] Unexpected error:', error);
    // Return 500 so Paycrest will retry
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// Disable body parsing (we need raw body for signature verification)
export const config = {
  api: {
    bodyParser: false,
  },
};
