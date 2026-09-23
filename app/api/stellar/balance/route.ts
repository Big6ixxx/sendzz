/**
 * GET /api/stellar/balance?address=G...
 *
 * Returns USDC and XLM balances for a Stellar address.
 * Cached for 10 seconds to avoid hammering Horizon.
 */

import { getStellarUsdcBalance, getStellarXlmBalance } from '@/lib/stellar/transactions';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';

export async function GET(req: NextRequest) {

    // Signed-in callers only.
    //
    // Public chain data, but our RPC quota. A session ends the anonymous case; rate limiting is
    // what would bound the rest.
    try {
      await requireUser();
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  const address = req.nextUrl.searchParams.get('address');

  if (!address || !address.startsWith('G')) {
    return NextResponse.json(
      { error: 'Valid Stellar address required (starts with G)' },
      { status: 400 },
    );
  }

  try {
    const [usdc, xlm] = await Promise.all([
      getStellarUsdcBalance(address),
      getStellarXlmBalance(address),
    ]);

    return NextResponse.json(
      { usdc, xlm },
      {
        headers: {
          // Cache balance for 10s on the client, allow stale for 20s
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20',
        },
      },
    );
  } catch {
    // Return zeros on timeout rather than hanging the UI
    return NextResponse.json({ usdc: '0', xlm: '0' });
  }
}
