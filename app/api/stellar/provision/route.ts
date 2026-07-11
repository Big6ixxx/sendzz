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
import { getUserAddresses, registerStellarAddress } from '@/lib/supabase/users';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { privyUserId, email } = await req.json();

    if (!privyUserId || typeof privyUserId !== 'string') {
      return NextResponse.json(
        { error: 'privyUserId is required' },
        { status: 400 },
      );
    }

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'email is required' },
        { status: 400 },
      );
    }

    console.log(`[Stellar/Provision] Provisioning/checking for: ${email}`);

    let trustlineError: string | null = null;

    // 1. Check if user already has Stellar wallet in database
    const dbAddresses = await getUserAddresses(email, privyUserId);
    let walletId = dbAddresses?.stellar_wallet_id;
    let address = dbAddresses?.stellar_address;
    let signerGranted = dbAddresses?.stellar_signer_granted || false;
    let trustlineReady = false;

    if (walletId && address) {
      console.log(`[Stellar/Provision] Found existing Stellar wallet in DB: ${address}`);
    } else {
      // 2. Provision new Stellar wallet via Privy TEE
      console.log(`[Stellar/Provision] No Stellar wallet in DB. Provisioning via Privy TEE...`);
      const wallet = await provisionStellarWallet(privyUserId);
      walletId = wallet.walletId;
      address = wallet.address;
      trustlineReady = wallet.trustlineReady;
      signerGranted = true; // Auto-grant signers on new wallet setup flow
      
      // Save it in DB
      await registerStellarAddress(email, address, walletId, signerGranted, privyUserId);
    }

    // 3. Retry mechanism (up to 3 attempts with 2-second delay)
    if (!trustlineReady) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[Stellar/Provision] Trustline check/add attempt ${attempt} for: ${address}`);
          const ready = await ensureTrustline(walletId, address);
          if (ready) {
            trustlineReady = true;
            trustlineError = null;
            break;
          }
        } catch (err) {
          trustlineError = (err as Error).message;
          console.error(`[Stellar/Provision] Attempt ${attempt} failed:`, trustlineError);
        }
        if (!trustlineReady && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    return NextResponse.json({
      success: true,
      walletId,
      address,
      trustlineReady,
      signerGranted,
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
