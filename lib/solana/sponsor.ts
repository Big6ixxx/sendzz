/**
 * The shared body of the two Solana fee-payer sponsor routes.
 *
 * /api/solana/sponsor (USDC payments) and /api/bridge/solana-sponsor (CCTP burns) differ only in
 * which transactions they accept — see lib/solana/sponsor-policy. Everything else is identical,
 * and keeping it in one place means a fix to one cannot miss the other.
 */
import 'server-only';

import { NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { PublicKey, type Transaction } from '@solana/web3.js';
import { privySolanaWallets, type SessionUser } from '@/lib/auth/session';
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from '@/lib/security/rate-limit';
import {
  BURN_EVENT_RENT_PAYER_INDEX,
  checkSponsoredBurn,
  checkSponsoredTransfer,
  decodeLegacyTransaction,
  type PolicyResult,
} from './sponsor-policy';
import { TOKEN_MESSENGER_MINTER_V2 } from '@/lib/circle/solana-gateway';
import { getFeeTreasury } from '@/lib/fees/platform-fees';

/** FEE_TREASURY_SOLANA as a key, or null when unset or malformed. */
function solanaFeeTreasury(): PublicKey | null {
  const address = getFeeTreasury('solana');
  if (!address) return null;
  try {
    return new PublicKey(address);
  } catch {
    console.error('[solana-sponsor] FEE_TREASURY_SOLANA is not a valid Solana address.');
    return null;
  }
}

export type SponsorKind = 'transfer' | 'burn';

const POLICIES: Record<
  SponsorKind,
  (
    tx: Transaction,
    p: { feePayer: PublicKey; owner: PublicKey; feeTreasury?: PublicKey | null },
  ) => PolicyResult
> = {
  transfer: checkSponsoredTransfer,
  burn: checkSponsoredBurn,
};

/**
 * Handle a sponsor request from an already-authenticated caller.
 *
 * Authentication stays in each route file, where the route-gate test can see it; this takes the
 * caller it produced.
 */
export async function handleSponsorRequest(
  req: Request,
  kind: SponsorKind,
  caller: SessionUser,
): Promise<Response> {
  const tag = kind === 'burn' ? '[solana-sponsor]' : '[solana/sponsor]';
  try {
    // Keyed on the account, not the IP — an account is the thing that costs an attacker
    // something to replace.
    {
      const limit = await checkRateLimit(RATE_LIMITS.sponsor, caller.userId ?? caller.privyUserId);
      if (!limit.allowed) return rateLimitResponse(limit);
    }

    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    const feePayerWalletId = process.env.CIRCLE_SOLANA_FEEPAYER_WALLET_ID;
    const feePayerAddress = process.env.CIRCLE_SOLANA_FEEPAYER_ADDRESS;
    if (!apiKey || !entitySecret || !feePayerWalletId || !feePayerAddress) {
      console.error(`${tag} Circle fee-payer environment is incomplete.`);
      return NextResponse.json(
        { error: 'Gas sponsorship is temporarily unavailable. Please try again shortly.' },
        { status: 500 },
      );
    }

    const { transaction } = (await req.json().catch(() => ({}))) as { transaction?: unknown };
    if (!transaction || typeof transaction !== 'string') {
      return NextResponse.json({ error: 'transaction (base64 string) is required' }, { status: 400 });
    }

    const tx = decodeLegacyTransaction(transaction);
    if (!tx) {
      return NextResponse.json({ error: 'Unsupported transaction format' }, { status: 400 });
    }

    // Whose USDC this moves is decided by Privy, not by the transaction: the authority in it must
    // be one of the embedded wallets Privy holds for this caller.
    let wallets: string[];
    try {
      wallets = await privySolanaWallets(caller.privyUserId);
    } catch (err) {
      console.error(`${tag} Could not resolve the caller's Solana wallet:`, (err as Error).message);
      return NextResponse.json(
        { error: 'Gas sponsorship is temporarily unavailable. Please try again shortly.' },
        { status: 503 },
      );
    }

    const feePayer = new PublicKey(feePayerAddress);
    // Where a bridge's platform fee may go — the only token transfer a burn may carry.
    const feeTreasury = solanaFeeTreasury();
    let verdict: PolicyResult = { ok: false, reason: 'no Solana wallet on this account' };
    for (const wallet of wallets) {
      verdict = POLICIES[kind](tx, { feePayer, owner: new PublicKey(wallet), feeTreasury });
      if (verdict.ok) break;
    }
    if (!verdict.ok) {
      console.warn(
        `${tag} REFUSED to sponsor for ${caller.userId ?? caller.privyUserId}: ${verdict.reason}`,
      );
      return NextResponse.json(
        { error: 'This transaction cannot be sponsored.', code: 'sponsor_refused' },
        { status: 403 },
      );
    }

    // Only now, with the transaction approved as sent, do we put ourselves into it.
    tx.feePayer = feePayer;
    if (kind === 'burn') {
      const burn = tx.instructions.find((ix) => ix.programId.equals(TOKEN_MESSENGER_MINTER_V2))!;
      burn.keys[BURN_EVENT_RENT_PAYER_INDEX].pubkey = feePayer;
    }

    const circleClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
    const response = await circleClient.signTransaction({
      walletId: feePayerWalletId,
      rawTransaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
    });

    const sponsoredTransaction = response.data?.signedTransaction;
    if (!sponsoredTransaction) {
      console.error(`${tag} No signedTransaction returned from Circle DCW:`, response);
      return NextResponse.json({ error: 'Circle did not return a sponsored transaction' }, { status: 502 });
    }

    return NextResponse.json({ sponsoredTransaction });
  } catch (err) {
    console.error(`${tag} Unexpected error:`, err);
    return NextResponse.json(
      { error: 'Gas sponsorship failed. Please try again shortly.' },
      { status: 500 },
    );
  }
}
