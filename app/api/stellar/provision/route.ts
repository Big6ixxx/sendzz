/**
 * POST /api/stellar/provision
 *
 * Provisions a Stellar wallet for a user via Privy TEE.
 * IDEMPOTENT — safe to call on every login and page reload.
 *
 * What happens automatically:
 *   1. Create (or retrieve existing) Stellar wallet in Privy TEE
 *   2. If the account has XLM on-chain → add USDC trustline immediately
 *      (fee-bumped by sponsor — user pays nothing)
 *   3. If account not yet activated → trustline deferred, trustlineReady=false
 *
 * Body: { privyUserId: string }
 */

import { provisionStellarWallet, ensureTrustline } from '@/lib/stellar/privy-wallet';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { privyUserId } = await req.json();

    if (!privyUserId || typeof privyUserId !== 'string') {
      return NextResponse.json(
        { error: 'privyUserId is required' },
        { status: 400 },
      );
    }

    console.log(`[Stellar/Provision] Provisioning for: ${privyUserId.slice(0, 20)}...`);

    let trustlineError: string | null = null;

    // provisionStellarWallet calls ensureTrustline internally but swallows errors.
    // We replicate ensureTrustline here after getting the wallet so we can
    // surface the exact failure reason to the client for debugging.
    const wallet = await provisionStellarWallet(privyUserId);

    // If trustline is still not ready, try once more and capture the real error
    if (!wallet.trustlineReady) {
      try {
        const ready = await ensureTrustline(wallet.walletId, wallet.address);
        if (ready) {
          wallet.trustlineReady = true;
        }
      } catch (err) {
        trustlineError = (err as Error).message;
        console.error('[Stellar/Provision] Trustline error detail:', trustlineError);
      }
    }

    return NextResponse.json({
      success: true,
      walletId: wallet.walletId,
      address: wallet.address,
      trustlineReady: wallet.trustlineReady,
      // Include error detail in dev so we can see exactly what failed
      trustlineError: process.env.NODE_ENV !== 'production' ? trustlineError : undefined,
    });
  } catch (error) {
    console.error('[Stellar/Provision] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to provision Stellar wallet' },
      { status: 500 },
    );
  }
}
