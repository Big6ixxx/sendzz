/**
 * POST /api/stellar/trustline
 *
 * Ensures the USDC trustline is set on a Stellar wallet.
 * Called automatically during provisioning. This endpoint exists as a
 * manual retry for the case where the account wasn't activated yet during
 * initial provision (needed XLM first).
 *
 * Body: { walletId, address }
 */

import { ensureTrustline } from '@/lib/stellar/privy-wallet';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { walletId, address } = await req.json();

    if (!walletId || !address) {
      return NextResponse.json(
        { error: 'walletId and address are required' },
        { status: 400 },
      );
    }

    console.log(`[Stellar/Trustline] Ensuring trustline for ${address.slice(0, 6)}...`);

    const ready = await ensureTrustline(walletId, address);

    if (!ready) {
      return NextResponse.json(
        {
          success: false,
          trustlineReady: false,
          message:
            'Account is not yet activated on Stellar. Send at least 1 XLM to activate it, then try again.',
        },
        { status: 202 }, // 202 Accepted — not an error, just not ready yet
      );
    }

    return NextResponse.json({ success: true, trustlineReady: true });
  } catch (error) {
    console.error('[Stellar/Trustline] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to add trustline' },
      { status: 500 },
    );
  }
}
