/**
 * Verify Withdrawal API Route
 *
 * POST /api/withdraw/verify
 * Verify withdrawal OTP and execute Paycrest payout.
 */

import { checkRateLimit, OTP_VERIFY_RATE_LIMIT } from '@/lib/security';
import { createClient } from '@/lib/supabase/server';
import { verifyWithdrawal } from '@/server/services';
import { verifyWithdrawalSchema } from '@/validators';
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

    // Rate limiting for OTP verification
    const rateLimitResult = checkRateLimit(
      `otp-verify:${user.id}`,
      OTP_VERIFY_RATE_LIMIT,
    );
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Too many attempts. Please try again later.',
          retryAfter: Math.ceil(rateLimitResult.retryAfterMs / 1000),
        },
        { status: 429 },
      );
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = verifyWithdrawalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Also need the account details for Paycrest
    const { withdrawalId, code } = parsed.data;
    const { accountNumber, accountName } = body;

    if (!accountNumber) {
      return NextResponse.json(
        { error: 'Account number is required' },
        { status: 400 },
      );
    }

    // Execute verification
    const result = await verifyWithdrawal({
      withdrawalId,
      userId: user.id,
      userEmail: user.email!,
      otpCode: code,
      accountNumber,
      accountName,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message:
        'Withdrawal verified and processing. You will be notified when complete.',
    });
  } catch (error) {
    console.error('[API] withdraw/verify error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
