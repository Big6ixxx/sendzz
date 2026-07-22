/**
 * GET /api/stellar/balance?address=G...
 *
 * Returns USDC and XLM balances for a Stellar address.
 * Cached for 10 seconds to avoid hammering Horizon.
 */

import { getStellarUsdcBalance, getStellarXlmBalance } from '@/lib/stellar/transactions';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
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
