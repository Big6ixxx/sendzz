/**
 * BlockRadar Webhook API Route
 *
 * POST /api/webhooks/blockradar
 * Handles deposit and withdrawal events from BlockRadar.
 */

import {
  extractUserIdFromMetadata,
  isDepositEvent,
  isWithdrawalEvent,
  parseWebhookPayload,
  verifyWebhookSignature,
} from '@/lib/blockradar/webhook';
import { creditBalance } from '@/server/repositories/balanceRepository';
import { createDeposit } from '@/server/repositories/depositRepository';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-blockradar-signature') || '';

    // Verify signature
    const secret = process.env.BLOCKRADAR_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[BlockRadar Webhook] Missing webhook secret');
      return NextResponse.json(
        { error: 'Webhook not configured' },
        { status: 500 },
      );
    }

    if (!verifyWebhookSignature(body, signature, secret)) {
      console.error('[BlockRadar Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse payload
    const payload = parseWebhookPayload(body);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    console.log(`[BlockRadar Webhook] Received event: ${payload.event}`);

    // Handle deposit events
    if (isDepositEvent(payload.event)) {
      const userId = extractUserIdFromMetadata(payload.data.metadata);
      if (!userId) {
        console.error('[BlockRadar Webhook] No user ID in deposit metadata');
        return NextResponse.json({ error: 'Missing user ID' }, { status: 400 });
      }

      if (payload.event === 'deposit.success') {
        const amount = parseFloat(payload.data.amount);

        // Create deposit record
        await createDeposit({
          userId,
          amount,
          status: 'confirmed',
          txHash: payload.data.hash,
        });

        // Credit user balance
        await creditBalance(userId, amount);

        console.log(
          `[BlockRadar Webhook] Credited ${amount} USDC to user ${userId}`,
        );
      }
    }

    // Handle withdrawal events
    if (isWithdrawalEvent(payload.event)) {
      // Withdrawals are processed through Paycrest webhook
      // BlockRadar webhook confirms the on-chain transfer to Paycrest
      console.log(
        `[BlockRadar Webhook] Withdrawal ${payload.event}: ${payload.data.id}`,
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[BlockRadar Webhook] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
