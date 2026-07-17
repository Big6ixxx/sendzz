/**
 * Centralized chain metadata + block-explorer URLs.
 *
 * Consolidates the per-chain explorer maps previously duplicated across
 * `components/deposit-withdraw/deposit-shared.tsx`, `lib/receipt/exportPdf.ts`, and
 * `lib/circle/gateway.ts`. Isomorphic (no client-only deps) so it can be used from server
 * actions and client components alike.
 */

import type { PublicFeedRow } from '@/types/public';

export interface ChainMeta {
  /** Human-readable name, e.g. "Base". */
  name: string;
  /** Brand color (hex) for chips/badges. */
  color: string;
  /** Build a block-explorer URL for a given tx hash. */
  explorerTx: (hash: string) => string;
}

export const CHAIN_META: Record<string, ChainMeta> = {
  base: {
    name: 'Base',
    color: '#0052FF',
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
  },
  arbitrum: {
    name: 'Arbitrum',
    color: '#28A0F0',
    explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
  },
  ethereum: {
    name: 'Ethereum',
    color: '#627EEA',
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
  },
  optimism: {
    name: 'Optimism',
    color: '#FF0420',
    explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
  },
  polygon: {
    name: 'Polygon',
    color: '#8247E5',
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
  },
  avalanche: {
    name: 'Avalanche',
    color: '#E84142',
    explorerTx: (h) => `https://snowtrace.io/tx/${h}`,
  },
  solana: {
    name: 'Solana',
    color: '#9945FF',
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
  },
  stellar: {
    name: 'Stellar',
    color: '#08B5E5',
    explorerTx: (h) => `https://stellar.expert/explorer/public/tx/${h}`,
  },
};

/** Ordered list of chains for filter dropdowns. */
export const SUPPORTED_CHAINS = Object.keys(CHAIN_META);

/** Fallback chain when a row has no recorded chain (legacy transfers settled on Base). */
const DEFAULT_CHAIN = 'base';

export function chainMeta(chain: string | null | undefined): ChainMeta {
  const key = (chain || DEFAULT_CHAIN).toLowerCase();
  return CHAIN_META[key] ?? CHAIN_META[DEFAULT_CHAIN];
}

export function chainName(chain: string | null | undefined): string {
  if (!chain) return CHAIN_META[DEFAULT_CHAIN].name;
  return CHAIN_META[chain.toLowerCase()]?.name ?? chain;
}

/**
 * Explorer URL for a feed row's PRIMARY hash.
 * For bridges the burn hash lives on the source chain; everything else settles on its
 * source chain (default Base).
 */
export function explorerUrlFor(row: PublicFeedRow): string | null {
  if (!row.tx_hash) return null;
  return chainMeta(row.source_chain).explorerTx(row.tx_hash);
}

/**
 * Explorer URL for a bridge row's SECONDARY (mint) hash, which lands on the destination
 * chain (falls back to Base).
 */
export function secondaryExplorerUrlFor(row: PublicFeedRow): string | null {
  if (!row.secondary_tx_hash) return null;
  return chainMeta(row.dest_chain).explorerTx(row.secondary_tx_hash);
}

/** Human-readable route label, e.g. "USDC → NGN" or "BASE → POLYGON". */
export function routeLabel(row: PublicFeedRow): string {
  switch (row.tx_type) {
    case 'bridge':
      return `${chainName(row.source_chain).toUpperCase()} → ${chainName(row.dest_chain).toUpperCase()}`;
    case 'deposit':
      return `${row.fiat_currency ? row.fiat_currency.toUpperCase() : 'Fiat'} → USDC`;
    case 'withdrawal':
      return `USDC → ${row.fiat_currency ? row.fiat_currency.toUpperCase() : 'Fiat'}`;
    default:
      return 'USDC Transfer';
  }
}
