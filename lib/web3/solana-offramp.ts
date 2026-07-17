'use client';

/**
 * Solana off-ramp settlement.
 *
 * When a withdrawal settles on Solana, the payout USDC is sent to the provider's Solana
 * deposit address and (optionally) the platform fee to a treasury address — in ONE sponsored
 * SPL transaction (gas paid by the Circle DCW fee-payer, same as the Solana bridge path).
 *
 * Assumptions (verify with a small live test before relying on them):
 *   • `payoutAddress` / `feeAddress` are OWNER pubkeys; the USDC token account is the ATA
 *     derived from them (standard convention for custodial deposit addresses).
 *   • Those destination ATAs already exist (Bitnob-hosted addresses are active), so we don't
 *     create them — a plain SPL transfer to a missing ATA would fail.
 */
import { Buffer } from 'buffer';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferInstruction } from '@solana/spl-token';
import { SOLANA_USDC_MINT } from '@/lib/circle/solana-gateway';

/** USDC has 6 decimals — convert a decimal string to base units. */
function toSubunits(amount: string): bigint {
  const [whole, frac = ''] = amount.split('.');
  return BigInt((whole || '0') + (frac + '000000').slice(0, 6));
}

function usdcAta(owner: string): PublicKey {
  // allowOwnerOffCurve=true so custodial/PDA-style deposit addresses resolve too.
  return getAssociatedTokenAddressSync(SOLANA_USDC_MINT, new PublicKey(owner), true);
}

export async function settleSolanaOffRamp(params: {
  connection: Connection;
  /** User's Solana wallet (source USDC authority + signer). */
  walletAddress: string;
  /** Provider's Solana deposit address (payout destination). */
  payoutAddress: string;
  payoutAmount: string;
  /** Treasury address for the platform fee (omit for no fee). */
  feeAddress?: string;
  feeAmount?: string;
  /** Signs the sponsored tx with the Privy Solana wallet and broadcasts; returns the signature. */
  signAndBroadcast: (tx: Transaction) => Promise<string>;
  onStatus?: (status: string) => void;
}): Promise<string> {
  const {
    connection,
    walletAddress,
    payoutAddress,
    payoutAmount,
    feeAddress,
    feeAmount,
    signAndBroadcast,
    onStatus,
  } = params;

  const owner = new PublicKey(walletAddress);
  const sourceAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, owner);

  const tx = new Transaction();
  tx.add(
    createTransferInstruction(sourceAta, usdcAta(payoutAddress), owner, toSubunits(payoutAmount)),
  );
  if (feeAddress && feeAmount && parseFloat(feeAmount) > 0) {
    tx.add(
      createTransferInstruction(sourceAta, usdcAta(feeAddress), owner, toSubunits(feeAmount)),
    );
  }

  // Placeholder fee-payer; the sponsor swaps in the Circle DCW address and signs for gas.
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  onStatus?.('Sponsoring transaction…');
  const res = await fetch('/api/solana/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Gas sponsor error: ${err.error ?? res.statusText}`);
  }
  const { sponsoredTransaction } = (await res.json()) as { sponsoredTransaction: string };
  const sponsoredTx = Transaction.from(Buffer.from(sponsoredTransaction, 'base64'));

  onStatus?.('Confirming on Solana…');
  return signAndBroadcast(sponsoredTx);
}
