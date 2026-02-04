/**
 * Send USDC API Route
 *
 * POST /api/transfer/send
 * Send USDC to an email address.
 */

import { checkRateLimit, TRANSFER_RATE_LIMIT } from '@/lib/security';
import { createClient } from '@/lib/supabase/server';
import { sendTransfer } from '@/server/services';
import { sendTransferSchema } from '@/validators';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const rateLimitResult = checkRateLimit(
      `transfer:${user.id}`,
      TRANSFER_RATE_LIMIT,
    );
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(rateLimitResult.retryAfterMs / 1000),
        },
        { status: 429 },
      );
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = sendTransferSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { recipientEmail, amount, note } = parsed.data;

    // Prevent sending to self
    if (recipientEmail.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json(
        { error: 'Cannot send to yourself' },
        { status: 400 },
      );
    }

    // Execute transfer
    const result = await sendTransfer({
      senderId: user.id,
      senderEmail: user.email!,
      recipientEmail,
      amount: parseFloat(amount),
      note,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      transferId: result.transferId,
      claimRequired: result.claimRequired,
      message: result.claimRequired
        ? 'Transfer pending. Recipient will receive a claim email.'
        : 'Transfer completed successfully.',
    });
  } catch (error) {
    console.error('[API] transfer/send error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
