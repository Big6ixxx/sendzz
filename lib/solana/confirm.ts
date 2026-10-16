/**
 * Broadcasting and confirming a transaction the user's Privy Solana wallet has signed.
 *
 * Confirmation has to be judged against the blockhash the transaction was BUILT with. The call
 * sites used to fetch a fresh blockhash after broadcasting and confirm against that: its
 * lastValidBlockHeight is later than the transaction's, so a transaction that had already
 * expired was waited on for up to another minute, and the expiry error — the one signal that it
 * is safe to retry — arrived late or not at all.
 */

import { Buffer } from 'buffer';
import { Transaction, type Connection } from '@solana/web3.js';

/** A transaction's lifetime: the blockhash it was built with and the last block it can land in. */
export interface BlockhashLifetime {
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * The lifetime to confirm `signed` against.
 *
 * The blockhash is read from the signed bytes, so it is the one the wallet actually signed.
 * `lastValidBlockHeight` is not serialized, so it comes from whoever fetched the blockhash.
 */
export function lifetimeOf(signed: Uint8Array, lastValidBlockHeight: number): BlockhashLifetime {
  const blockhash = Transaction.from(Buffer.from(signed)).recentBlockhash;
  if (!blockhash) throw new Error('Signed Solana transaction has no recent blockhash');
  return { blockhash, lastValidBlockHeight };
}

/**
 * Carry the lifetime of `from` onto `to` — used after the sponsor round trip, which rebuilds the
 * transaction from bytes and so drops `lastValidBlockHeight`.
 */
export function keepLifetime(to: Transaction, from: { lastValidBlockHeight?: number }): Transaction {
  if (from.lastValidBlockHeight !== undefined) to.lastValidBlockHeight = from.lastValidBlockHeight;
  return to;
}

/** Broadcast a signed transaction and wait for it, against its own blockhash. */
export async function sendAndConfirmSigned(
  connection: Connection,
  signed: Uint8Array,
  lastValidBlockHeight: number | undefined,
): Promise<string> {
  // Without a recorded height, fall back to the current one — later than the real one, so it
  // waits too long rather than declaring a live transaction dead.
  const height =
    lastValidBlockHeight ?? (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
  const lifetime = lifetimeOf(signed, height);
  const signature = await connection.sendRawTransaction(signed, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  const result = await connection.confirmTransaction({ signature, ...lifetime }, 'confirmed');
  if (result.value.err) {
    throw new Error(`Solana transaction failed: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}
