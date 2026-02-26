import { getBushaClient } from '@/lib/busha';
import type { BushaWebhookPayload } from '@/lib/busha/types';
import { completeDeposit, failDeposit } from '@/server/services/depositService';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('X-Busha-Signature') || '';

    if (!signature) {
      console.warn('[BushaWebhook] Missing signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const busha = getBushaClient();
    if (!busha.validateWebhookSignature(rawBody, signature)) {
      console.warn('[BushaWebhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as BushaWebhookPayload;
    console.log('[BushaWebhook] Received event:', payload.event);

    const reference = payload.data.metadata?.reference;
    if (!reference) {
      console.warn('[BushaWebhook] Missing reference in metadata');
      return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
    }

    if (payload.event === 'charge:confirmed') {
      const success = await completeDeposit(
        reference,
        payload.data.pricing.local.amount,
      );
      if (success) {
        console.log('[BushaWebhook] Deposit completed:', reference);
      } else {
        console.error('[BushaWebhook] Failed to complete deposit:', reference);
      }
    } else if (payload.event === 'charge:failed') {
      await failDeposit(reference, 'Payment failed via Busha');
      console.log('[BushaWebhook] Deposit failed:', reference);
    }

    return NextResponse.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('[BushaWebhook] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
