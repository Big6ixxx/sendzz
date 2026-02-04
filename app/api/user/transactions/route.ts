/**
 * Get User Transactions API Route
 *
 * GET /api/user/transactions
 * Returns the authenticated user's transaction history.
 */

import { createClient } from '@/lib/supabase/server';
import {
    getAllUserTransfers,
    getWithdrawalsByUser,
} from '@/server/repositories';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
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

    // Get query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    // Fetch transfers and withdrawals
    const [transfers, withdrawals] = await Promise.all([
      getAllUserTransfers(user.id, limit),
      getWithdrawalsByUser(user.id, limit),
    ]);

    // Transform and combine
    const transactions = [
      ...transfers.map((t) => ({
        id: t.id,
        type: t.sender_id === user.id ? 'sent' : 'received',
        amount: t.amount,
        asset: t.asset,
        status: t.status,
        counterparty: t.sender_id === user.id ? t.recipient_email : 'Sender',
        note: t.note,
        createdAt: t.created_at,
      })),
      ...withdrawals.map((w) => ({
        id: w.id,
        type: 'withdrawal',
        amount: w.amount_usdc,
        asset: 'USDC',
        fiatCurrency: w.fiat_currency,
        status: w.status,
        counterparty: `Bank ${w.bank_account_masked}`,
        createdAt: w.created_at,
      })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({
      success: true,
      transactions: transactions.slice(0, limit),
    });
  } catch (error) {
    console.error('[API] user/transactions error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
