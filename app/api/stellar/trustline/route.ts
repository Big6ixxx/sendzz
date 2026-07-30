/**
 * POST /api/stellar/trustline
 *
 * Makes a Stellar wallet able to receive USDC — activates the account if it isn't
 * on-chain yet, tops up the trustline reserve, and adds the USDC trustline.
 *
 * Called during provisioning, and as a pre-flight before any bridge whose
 * destination is Stellar (a missing trustline makes the CCTP claim revert *after*
 * the source-chain burn has already happened).
 *
 * Body: { walletId, address }
 */

import { ensureStellarUsdcReceivable } from '@/lib/stellar/privy-wallet';
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

    const result = await ensureStellarUsdcReceivable(walletId, address);

    if (!result.ready) {
      // Raw detail stays in the server logs — the client only gets a safe message.
      console.error(`[Stellar/Trustline] Not ready (${result.reason}):`, result.detail);
      return NextResponse.json(
        {
          success: false,
          trustlineReady: false,
          code: result.reason,
          message:
            "We couldn't finish setting up your Stellar account to receive USDC. Please try again in a moment.",
        },
        { status: 202 }, // 202 Accepted — not an error, just not ready yet
      );
    }

    return NextResponse.json({ success: true, trustlineReady: true });
  } catch (error) {
    console.error('[Stellar/Trustline] Error:', error);
    return NextResponse.json(
      { error: 'Could not set up your Stellar account right now. Please try again.' },
      { status: 500 },
    );
  }
}
