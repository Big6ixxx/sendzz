'use client';

/**
 * Solana off-ramp settlement.
 *
 * When a withdrawal settles on Solana, the payout USDC is sent to the provider's Solana deposit
 * address and (optionally) the platform fee to a treasury address — in ONE sponsored transaction,
 * built and sent exactly like a direct send (lib/solana/usdc-transfer, lib/solana/sponsor).
 *
 *   • `payoutAddress` / `feeAddress` are OWNER addresses; the USDC account is the ATA derived from
 *     them, off-curve owners allowed (custodial deposit addresses can be PDAs).
 *   • Bitnob hands out a fresh address per payout, which has no USDC account yet. Each is opened
 *     with CreateIdempotent in the same transaction, rent paid by our fee payer under the per-user
 *     quota — without it the transfer fails and the payout never starts.
 *   • The server attaches the signature to the withdrawal the moment it broadcasts, before it
 *     confirms, so a tab closed mid-settlement cannot strand the payout (the Stellar route does
 *     the same with `withdrawalOrderId`).
 */
import type { Connection } from '@solana/web3.js';
import { buildSolanaUsdcTransferTx } from '@/lib/solana/usdc-transfer';
import { sendSponsoredSolanaTx, type SolanaSign } from './solana-sponsored-send';

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
  /** The withdrawal this settles; the server records the signature against it on broadcast. */
  withdrawalOrderId?: string;
  /** Signs with the Privy Solana wallet; returns the signed bytes. */
  sign: SolanaSign;
  onStatus?: (status: string) => void;
}): Promise<string> {
  const tx = await buildSolanaUsdcTransferTx({
    connection: params.connection,
    senderAddress: params.walletAddress,
    recipientAddress: params.payoutAddress,
    amount: params.payoutAmount,
    platformFee:
      params.feeAddress && params.feeAmount && parseFloat(params.feeAmount) > 0
        ? { usdc: params.feeAmount, treasury: params.feeAddress }
        : undefined,
  });

  // A send still confirming is returned like a confirmed one: its hash is already on the
  // withdrawal, and the payout is released only once the provider sees the deposit land.
  const { txHash } = await sendSponsoredSolanaTx({
    tx,
    sign: params.sign,
    withdrawalOrderId: params.withdrawalOrderId,
    onStatus: params.onStatus,
  });
  return txHash;
}
