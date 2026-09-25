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

import {
  provisionStellarWallet,
  ensureStellarUsdcReceivable,
  hasServerSigner,
} from '@/lib/stellar/privy-wallet';
import { readUserAddresses, writeUserAddresses } from '@/lib/supabase/user-records';
import { getVerifiedIdentity } from '@/lib/auth/session';
import { redactEmail } from '@/lib/log';
import { NextResponse } from 'next/server';

/**
 * Wallets that are fully set up — signer granted, account activated, USDC trustline in
 * place — and when that was last confirmed.
 *
 * Provisioning is called on nearly every Stellar-touching page load, and a settled
 * wallet's answer does not change. Without this, each call spends a Privy round-trip
 * plus a Horizon lookup to re-learn what it already knew. Per-instance and in-memory by
 * design: losing it on a cold start just means one full re-check.
 */
const settledWallets = new Map<string, number>();
const SETTLED_TTL_MS = 15 * 60 * 1000;

function isSettled(address: string): boolean {
  const until = settledWallets.get(address);
  if (!until) return false;
  if (Date.now() > until) {
    settledWallets.delete(address);
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  try {
    const { privyUserId: claimedPrivyUserId } = await req.json();

    // ── Identity from the session, never the body ───────────────────────────
    //
    // This route provisions a wallet and records it against an account. It used to take both
    // the email and the Privy user id as arguments and trust them, which meant anyone could
    // point it at somebody else's account — and the Privy id decides which TEE wallet the
    // server derives, so the body chose both the victim and the key.
    //
    // Both now come from the verified token. `claimedPrivyUserId` is read only to be checked
    // against it, so a mismatched call is refused rather than silently acting on whichever
    // one happened to be used further down.
    const identity = await getVerifiedIdentity();
    if (!identity) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    }

    const { email, privyUserId } = identity;

    if (claimedPrivyUserId && claimedPrivyUserId !== privyUserId) {
      console.error('[Stellar/Provision] body privyUserId does not match the session — refusing.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    console.log(`[Stellar/Provision] Provisioning/checking for: ${redactEmail(email)}`);

    let trustlineError: string | null = null;

    // 1. Check if user already has Stellar wallet in database
    const dbAddresses = await readUserAddresses(email);
    let walletId = dbAddresses?.stellar_wallet_id;
    let address = dbAddresses?.stellar_address;
    let trustlineReady = false;

    if (walletId && address) {
      // Fast path: nothing about a finished wallet changes, so don't re-derive it.
      if (dbAddresses?.stellar_signer_granted && isSettled(address)) {
        return NextResponse.json({
          success: true,
          walletId,
          address,
          trustlineReady: true,
          signerGranted: true,
        });
      }
      console.log(`[Stellar/Provision] Found existing Stellar wallet in DB: ${address}`);
    } else {
      // 2. Provision new Stellar wallet via Privy TEE
      console.log(`[Stellar/Provision] No Stellar wallet in DB. Provisioning via Privy TEE...`);
      const wallet = await provisionStellarWallet(privyUserId);
      walletId = wallet.walletId;
      address = wallet.address;
      trustlineReady = wallet.trustlineReady;
    }

    // 3. Is the server actually allowed to sign for this wallet?
    //
    // This must be read from Privy, never assumed. It was previously hardcoded to
    // true on wallet creation, which made every downstream flow believe Stellar was
    // ready while `rawSign` was in fact 401-ing — leaving accounts with no USDC
    // trustline and CCTP bridges to Stellar burned but unclaimable.
    // The grant is one-way in practice, so a recorded `true` is trustworthy; only pay
    // for the Privy lookup while we're still waiting for the client to grant it.
    const signerGranted =
      dbAddresses?.stellar_signer_granted || (await hasServerSigner(walletId));

    if (
      !dbAddresses?.stellar_wallet_id ||
      dbAddresses.stellar_signer_granted !== signerGranted
    ) {
      await writeUserAddresses(email, {
        stellarAddress: address,
        stellarWalletId: walletId,
        stellarSignerGranted: signerGranted,
      });
    }

    // 4. Finish setup — only possible once the server can sign.
    if (!trustlineReady && signerGranted) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[Stellar/Provision] Trustline check/add attempt ${attempt} for: ${address}`);
        const result = await ensureStellarUsdcReceivable(walletId, address);
        if (result.ready) {
          trustlineReady = true;
          trustlineError = null;
          break;
        }
        trustlineError = result.detail;
        console.error(`[Stellar/Provision] Attempt ${attempt} failed (${result.reason}):`, result.detail);
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (trustlineReady) settledWallets.set(address, Date.now() + SETTLED_TTL_MS);
    } else if (trustlineReady) {
      settledWallets.set(address, Date.now() + SETTLED_TTL_MS);
    } else if (!signerGranted) {
      console.warn(
        `[Stellar/Provision] Server signer not granted for ${address} — the client must call addSigners() before Stellar can be used.`,
      );
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
