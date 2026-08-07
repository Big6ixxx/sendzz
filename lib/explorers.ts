/**
 * Block-explorer links, in one place.
 *
 * Transaction hashes surface in the UI, in receipts and in emails; each of those was
 * building its own chain→explorer map, so a chain added in one place quietly produced
 * dead links in another. Emails especially can't fall back to "click through in the
 * app" — the link is the only way out.
 */

import { IS_TESTNET } from '@/lib/web3/network';

/**
 * Transaction-explorer base URL per chain — the single source for the whole app.
 *
 * Depends only on `network`, which is itself a leaf module reading one env var, so any
 * module (client, server action, email template, PDF receipt) can still import this
 * without pulling in chain config or React.
 *
 * The testnet set matters as much as the mainnet one: a Base Sepolia hash linked to
 * basescan.org is a dead link, and a dead link in a receipt email has no fallback.
 */
const MAINNET_TX_BASE: Record<string, string> = {
  ethereum: 'https://etherscan.io/tx',
  avalanche: 'https://snowtrace.io/tx',
  optimism: 'https://optimistic.etherscan.io/tx',
  arbitrum: 'https://arbiscan.io/tx',
  base: 'https://basescan.org/tx',
  polygon: 'https://polygonscan.com/tx',
  solana: 'https://solscan.io/tx',
  stellar: 'https://stellar.expert/explorer/public/tx',
  // Arc has no mainnet yet; kept so a stored Arc hash still renders a link.
  arc: 'https://testnet.arcscan.app/tx',
};

const TESTNET_TX_BASE: Record<string, string> = {
  ethereum: 'https://sepolia.etherscan.io/tx',
  avalanche: 'https://testnet.snowtrace.io/tx',
  optimism: 'https://sepolia-optimism.etherscan.io/tx',
  arbitrum: 'https://sepolia.arbiscan.io/tx',
  base: 'https://sepolia.basescan.org/tx',
  polygon: 'https://amoy.polygonscan.com/tx',
  solana: 'https://solscan.io/tx',
  stellar: 'https://stellar.expert/explorer/testnet/tx',
  arc: 'https://testnet.arcscan.app/tx',
};

export const EXPLORER_TX_BASE: Record<string, string> = IS_TESTNET
  ? TESTNET_TX_BASE
  : MAINNET_TX_BASE;

/**
 * Explorers that select the network with a query string rather than a hostname, so the
 * suffix has to land after the hash rather than before it.
 */
const EXPLORER_TX_SUFFIX: Record<string, string> = IS_TESTNET
  ? { solana: '?cluster=devnet' }
  : {};

/**
 * The chain the app settles on by default.
 *
 * Some records predate multi-chain support and don't persist a chain — those are Base.
 * Use this explicitly rather than hardcoding a Base explorer URL, so the assumption is
 * visible and there's one place to change it.
 *
 * On testnet this is Arc: USDC is the native gas token there and finality is sub-second,
 * which makes it the chain worth demonstrating settlement on. Arc has no mainnet, so a
 * mainnet build settles on Base exactly as production does today.
 */
export const HOME_CHAIN = IS_TESTNET ? 'arc' : 'base';

/**
 * Display label for the settlement chain, for user-facing copy ("Now live on …").
 * Kept next to HOME_CHAIN so the marketing text can never claim a different network
 * than the one the app actually settles on.
 */
export const HOME_CHAIN_LABEL = IS_TESTNET ? 'Arc Testnet' : 'Base Mainnet';

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
    clean === 'confirmed_on_chain' ||
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
  const base = EXPLORER_TX_BASE[key];
  return base ? `${base}/${hash}${EXPLORER_TX_SUFFIX[key] ?? ''}` : null;
}

/** `0x1234…abcd` — enough to recognise a hash without wrapping a table cell. */
export function shortenHash(hash: string, lead = 6, tail = 4): string {
  const clean = hash.trim();
  if (clean.length <= lead + tail + 1) return clean;
  return `${clean.slice(0, lead)}…${clean.slice(-tail)}`;
}
