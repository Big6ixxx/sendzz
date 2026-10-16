/**
 * The address lookup table a Solana CCTP claim is compiled against.
 *
 * Solana caps a transaction at 1232 bytes. A `receive_message` claim names 20 accounts, which is
 * 609 bytes of keys before any instruction data, and a mainnet attestation is 130 bytes — so the
 * claim came to 1264 bytes as a legacy transaction, or 1369 when it also opened the recipient's
 * token account. Both are over the limit and were refused before they were ever broadcast.
 *
 * A lookup table holds those accounts on chain, so a v0 transaction can name each one with a
 * one-byte index instead of a 32-byte key. The same claim then fits with room to spare.
 *
 * The table is pure compression: `compileToV0Message` only substitutes an address the
 * instructions already name, so an empty, stale or unreachable table costs bytes and never
 * correctness. That is why nothing here throws — a claim with no table is simply too large, and
 * the route says so in those words rather than failing as a mystery.
 *
 * Create one with `scripts/create-solana-lookup-table.ts`, which also prints the env var to set.
 */
import { AddressLookupTableAccount, Connection, PublicKey } from '@solana/web3.js';

/**
 * Set on the server only (no NEXT_PUBLIC prefix) — a claim is built and signed there. No
 * `server-only` guard, because this module holds no credentials and the setup script reads the
 * name from plain Node.
 */
export const LOOKUP_TABLE_ENV = 'SOLANA_CCTP_LOOKUP_TABLE';

/**
 * How long a fetched table is reused.
 *
 * Its contents only change when we extend it, which is a deliberate one-off, so this is about
 * not re-reading the same account on every claim rather than about staleness.
 */
const CACHE_MS = 10 * 60 * 1000;

let cached: { table: AddressLookupTableAccount; at: number } | null = null;

/**
 * The configured lookup table, or an empty list when there is none to use.
 *
 * Returns a list because that is what `compileToV0Message` takes, and because a second table
 * would slot in here without touching the builder.
 */
export async function claimLookupTables(
  connection: Connection,
): Promise<AddressLookupTableAccount[]> {
  const configured = process.env[LOOKUP_TABLE_ENV];
  if (!configured) {
    console.error(
      `[solana] ${LOOKUP_TABLE_ENV} is not set. A Solana claim does not fit in a transaction ` +
        'without it — see scripts/create-solana-lookup-table.ts.',
    );
    return [];
  }

  if (cached && Date.now() - cached.at < CACHE_MS) return [cached.table];

  let key: PublicKey;
  try {
    key = new PublicKey(configured);
  } catch {
    console.error(`[solana] ${LOOKUP_TABLE_ENV} is not a valid Solana address: ${configured}`);
    return [];
  }

  try {
    const { value } = await connection.getAddressLookupTable(key);
    if (!value) {
      console.error(`[solana] ${LOOKUP_TABLE_ENV} (${configured}) does not exist on this cluster.`);
      return [];
    }
    // A serving table is better than a fresh read: keep the old one on a transient failure below.
    cached = { table: value, at: Date.now() };
    return [value];
  } catch (err) {
    console.error('[solana] Could not read the claim lookup table:', (err as Error).message);
    return cached ? [cached.table] : [];
  }
}

/** Solana's hard cap on a serialized transaction. */
export const MAX_TRANSACTION_BYTES = 1232;
