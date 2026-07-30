/**
 * Centralized chain metadata + block-explorer URLs.
 *
 * Display metadata (name, brand colour) for the explore feed. Explorer URLs come from
 * `lib/explorers.ts` — this file previously carried its own copy of that map, one of five
 * that had to be kept in step by hand. Isomorphic (no client-only deps) so it can be used
 * from server actions and client components alike.
 */

import type { PublicFeedRow } from '@/types/public';
import { explorerTxUrl } from '@/lib/explorers';

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
    explorerTx: (h) => explorerTxUrl('base', h) ?? '',
  },
  arbitrum: {
    name: 'Arbitrum',
    color: '#28A0F0',
    explorerTx: (h) => explorerTxUrl('arbitrum', h) ?? '',
  },
  ethereum: {
    name: 'Ethereum',
    color: '#627EEA',
    explorerTx: (h) => explorerTxUrl('ethereum', h) ?? '',
  },
  optimism: {
    name: 'Optimism',
    color: '#FF0420',
    explorerTx: (h) => explorerTxUrl('optimism', h) ?? '',
  },
  polygon: {
    name: 'Polygon',
    color: '#8247E5',
    explorerTx: (h) => explorerTxUrl('polygon', h) ?? '',
  },
  avalanche: {
    name: 'Avalanche',
    color: '#E84142',
    explorerTx: (h) => explorerTxUrl('avalanche', h) ?? '',
  },
  solana: {
    name: 'Solana',
    color: '#9945FF',
    explorerTx: (h) => explorerTxUrl('solana', h) ?? '',
  },
  stellar: {
    name: 'Stellar',
    color: '#08B5E5',
    explorerTx: (h) => explorerTxUrl('stellar', h) ?? '',
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

const isPlaceholder = (h: string | null | undefined) =>
  !h || h.trim() === '' || h.toLowerCase() === 'n/a' || h === '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Explorer URL for a feed row's PRIMARY hash.
 * For bridges the burn hash lives on the source chain; everything else settles on its
 * source chain (default Base).
 */
export function explorerUrlFor(row: PublicFeedRow): string | null {
  if (!row.tx_hash || isPlaceholder(row.tx_hash)) return null;
  return chainMeta(row.source_chain).explorerTx(row.tx_hash);
}

/**
 * Explorer URL for a bridge row's SECONDARY (mint) hash, which lands on the destination
 * chain (falls back to Base).
 */
export function secondaryExplorerUrlFor(row: PublicFeedRow): string | null {
  if (!row.secondary_tx_hash || isPlaceholder(row.secondary_tx_hash)) return null;
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
