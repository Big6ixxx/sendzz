/**
 * Initiate Withdrawal API Route
 *
 * POST /api/withdraw/initiate
 * Start a withdrawal process - locks funds and sends verification OTP.
 */

import { checkRateLimit, WITHDRAWAL_RATE_LIMIT } from '@/lib/security';
import { createClient } from '@/lib/supabase/server';
import { initiateWithdrawal } from '@/server/services';
import { initiateWithdrawalSchema } from '@/validators';
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
      `withdrawal:${user.id}`,
      WITHDRAWAL_RATE_LIMIT,
    );
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Too many withdrawal attempts. Please try again later.',
          retryAfter: Math.ceil(rateLimitResult.retryAfterMs / 1000),
        },
        { status: 429 },
      );
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = initiateWithdrawalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { amount, currency, institutionCode, accountNumber, accountName } =
      parsed.data;

    // Execute withdrawal initiation
    const result = await initiateWithdrawal({
      userId: user.id,
      userEmail: user.email!,
      amountUsdc: parseFloat(amount),
      fiatCurrency: currency,
      institutionCode,
      accountNumber,
      accountName,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      withdrawalId: result.withdrawalId,
      message:
        'Verification code sent to your email. Please verify to complete withdrawal.',
    });
  } catch (error) {
    console.error('[API] withdraw/initiate error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
