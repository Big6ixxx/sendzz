/**
 * Claim Transfer API Route
 *
 * POST /api/transfer/claim
 * Claim a pending transfer using the claim token.
 */

import { createClient } from '@/lib/supabase/server';
import { claimTransfer } from '@/server/services';
import { claimTransferSchema } from '@/validators';
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
      return NextResponse.json(
        { error: 'Unauthorized. Please login to claim your funds.' },
        { status: 401 },
      );
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = claimTransferSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid claim token' },
        { status: 400 },
      );
    }

    const { token } = parsed.data;

    // Execute claim
    const result = await claimTransfer({
      token,
      claimantId: user.id,
      claimantEmail: user.email!,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      amount: result.amount,
      message: `Successfully claimed ${result.amount} USDC!`,
    });
  } catch (error) {
    console.error('[API] transfer/claim error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
