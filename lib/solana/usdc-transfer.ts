/**
 * The one shape of sponsored USDC payment on Solana: a direct send, or an off-ramp settlement.
 *
 *   [CreateIdempotent recipient ATA] TransferChecked → recipient
 *   [CreateIdempotent treasury ATA]  TransferChecked → treasury   (when there is a fee)
 *   [Memo]
 *
 * Built with the SENDER as fee payer and rent payer — the only key the client knows. The sender
 * holds no SOL, so /api/solana/sponsor swaps both for our fee payer before anyone signs (see
 * lib/solana/sponsor). CreateIdempotent costs nothing when the account already exists, so it is
 * always included: checking first would be a read that is stale by the time the send lands, and
 * a plain Create fails outright when someone else opened the account in between.
 */
import { Buffer } from 'buffer';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { MEMO_PROGRAM_ADDRESS } from '@solana-program/memo';
import { SOLANA_USDC_MINT } from '@/lib/circle/solana-gateway';

/** Memos are public and paid for; a sentence is plenty. */
export const MAX_MEMO_BYTES = 180;

/** USDC has 6 decimals — a decimal string to base units, without floating point. */
export function usdcToSubunits(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error(`Invalid USDC amount: ${amount}`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  return BigInt((whole || '0') + (frac + '000000').slice(0, 6));
}

/** Truncate to MAX_MEMO_BYTES of UTF-8 without splitting a character. */
export function clampMemo(memo: string): string {
  let out = memo.trim();
  while (Buffer.byteLength(out, 'utf8') > MAX_MEMO_BYTES) out = out.slice(0, -1);
  return out;
}

export function memoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM_ADDRESS),
    keys: [],
    data: Buffer.from(clampMemo(memo), 'utf8'),
  });
}

export async function buildSolanaUsdcTransferTx(params: {
  connection: Pick<Connection, 'getLatestBlockhash'>;
  senderAddress: string;
  recipientAddress: string;
  amount: string;
  /**
   * Platform fee, sent to the treasury in the SAME transaction as the transfer — so the two
   * confirm together, matching how the EVM rails batch the fee into one user operation.
   */
  platformFee?: { usdc: string; treasury: string };
  memo?: string;
}): Promise<Transaction> {
  const { connection, senderAddress, recipientAddress, amount, platformFee, memo } = params;
  const sender = new PublicKey(senderAddress);
  const senderAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, sender);

  const tx = new Transaction();

  const pay = (wallet: PublicKey, subunits: bigint) => {
    // Off-curve owners allowed: custodial deposit addresses and multisig vaults are PDAs.
    const ata = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, wallet, true);
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(sender, ata, wallet, SOLANA_USDC_MINT),
      createTransferCheckedInstruction(senderAta, SOLANA_USDC_MINT, ata, sender, subunits, 6),
    );
  };

  pay(new PublicKey(recipientAddress), usdcToSubunits(amount));
  if (platformFee) {
    const fee = usdcToSubunits(platformFee.usdc);
    if (fee > 0n) pay(new PublicKey(platformFee.treasury), fee);
  }
  if (memo && clampMemo(memo)) tx.add(memoInstruction(memo));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  // Placeholder: the sponsor replaces it with our fee payer.
  tx.feePayer = sender;

  return tx;
}
