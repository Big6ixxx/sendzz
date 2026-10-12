/**
 * POST /api/stellar/provision
 *
 * Reports — and, when asked, sets up — the caller's Stellar wallet. IDEMPOTENT.
 *
 * Stellar is opt-in. Creating the wallet costs nothing, but activating it does: the sponsor
 * pays the account reserve and the USDC trustline for every account, so it is never done
 * automatically. Without `activate`, this only reports:
 *
 *   - no wallet yet          → { provisioned: false }; nothing is created
 *   - a wallet already exists → its address and whether it can receive USDC (a Horizon read)
 *
 * `activate: true` — sent when the user explicitly asks for Stellar (the "Activate" button on
 * the receive screen, or claiming a Stellar transfer) — does the work:
 *   1. Create the wallet in Privy TEE if there is none
 *   2. Once the server can sign, activate the account and add the USDC trustline
 *      (fee-bumped by the sponsor — the user pays nothing)
 *
 * Body: { privyUserId?: string, activate?: boolean }
 */

import {
  provisionStellarWallet,
  ensureStellarUsdcReceivable,
  hasServerSigner,
  checkTrustlineStatus,
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
    const { privyUserId: claimedPrivyUserId, activate } = await req.json();
    const shouldActivate = activate === true;

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
          provisioned: true,
          walletId,
          address,
          trustlineReady: true,
          signerGranted: true,
        });
      }
    } else if (!shouldActivate) {
      // Not asked for, so nothing is created.
      return NextResponse.json({ success: true, provisioned: false });
    } else {
      // 2. Provision new Stellar wallet via Privy TEE
      console.log(`[Stellar/Provision] Creating a Stellar wallet for ${redactEmail(email)} (requested)`);
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

    // 4. Finish setup — only possible once the server can sign, and only when asked: this is
    //    the step that spends the sponsor's XLM. Unasked, just read where the account stands.
    if (!trustlineReady && !shouldActivate) {
      trustlineReady = (await checkTrustlineStatus(address)) === 'ready';
      if (trustlineReady && signerGranted) settledWallets.set(address, Date.now() + SETTLED_TTL_MS);
    } else if (!trustlineReady && signerGranted) {
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
    } else if (!signerGranted && shouldActivate) {
      console.warn(
        `[Stellar/Provision] Server signer not granted for ${address} — the client must call addSigners() before Stellar can be used.`,
      );
    }

    return NextResponse.json({
      success: true,
      provisioned: true,
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
