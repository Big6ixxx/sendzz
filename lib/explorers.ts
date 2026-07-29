/**
 * Block-explorer links, in one place.
 *
 * Transaction hashes surface in the UI, in receipts and in emails; each of those was
 * building its own chain→explorer map, so a chain added in one place quietly produced
 * dead links in another. Emails especially can't fall back to "click through in the
 * app" — the link is the only way out.
 */

import { CHAIN_EXPLORERS } from '@/lib/circle/gateway';

const NON_EVM_EXPLORERS: Record<string, string> = {
  solana: 'https://solscan.io/tx',
  stellar: 'https://stellar.expert/explorer/public/tx',
};

/** Recorded when a transfer landed but its real hash couldn't be recovered. */
export const PLACEHOLDER_TX_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Hashes we record when a transfer landed but its real hash couldn't be recovered. */
export function isPlaceholderHash(hash: string | null | undefined): boolean {
  if (!hash) return true;
  const clean = hash.trim().toLowerCase();
  return (
    clean === '' ||
    clean === 'n/a' ||
    clean === PLACEHOLDER_TX_HASH
  );
}

/**
 * Explorer URL for a transaction, or null when it can't be linked — an unknown chain,
 * or a placeholder standing in for a hash we never resolved.
 */
export function explorerTxUrl(
  chain: string | null | undefined,
  hash: string | null | undefined,
): string | null {
  if (!chain || isPlaceholderHash(hash)) return null;

  const key = chain.toLowerCase();
  const base =
    NON_EVM_EXPLORERS[key] ??
    (CHAIN_EXPLORERS as Record<string, string>)[key] ??
    null;

  return base ? `${base}/${hash}` : null;
}

/** `0x1234…abcd` — enough to recognise a hash without wrapping a table cell. */
export function shortenHash(hash: string, lead = 6, tail = 4): string {
  const clean = hash.trim();
  if (clean.length <= lead + tail + 1) return clean;
  return `${clean.slice(0, lead)}…${clean.slice(-tail)}`;
}
