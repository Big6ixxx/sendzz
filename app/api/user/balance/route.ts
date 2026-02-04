/**
 * Get User Balance API Route
 *
 * GET /api/user/balance
 * Returns the authenticated user's balance.
 */

import { createClient } from '@/lib/supabase/server';
import { getBalance } from '@/server/repositories';
import { NextResponse } from 'next/server';

export async function GET() {
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

    const balance = await getBalance(user.id);

    if (!balance) {
      return NextResponse.json({
        success: true,
        balance: {
          available: 0,
          locked: 0,
          total: 0,
          asset: 'USDC',
        },
      });
    }

    return NextResponse.json({
      success: true,
      balance: {
        available: balance.available,
        locked: balance.locked,
        total: balance.total,
        asset: 'USDC',
      },
    });
  } catch (error) {
    console.error('[API] user/balance error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
