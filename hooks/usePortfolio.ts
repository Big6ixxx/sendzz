import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { readCache, writeCache } from '@/lib/client-cache';
import type { SupportedChain } from '@/lib/circle/gateway';

export type ChainBalanceChain = SupportedChain | 'solana' | 'stellar';

/** One chain's USDC holding, as /api/balances/cross-chain reports it. */
export interface ChainBalance {
  chain: ChainBalanceChain;
  balance: string;
  hasBalance: boolean;
}

export interface Portfolio {
  /** Sum of USDC across every chain, formatted to 2dp. */
  total: string;
  /** Per-chain balances, funded chains first, each sorted by descending balance. */
  byChain: ChainBalance[];
  /** Number of chains the user currently holds a non-zero balance on. */
  fundedChainCount: number;
}

/** How old a remembered balance may be and still be shown while the live one loads. */
const PORTFOLIO_SNAPSHOT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Unified, read-only view of a user's USDC across every supported chain.
 *
 * Scans the smart-account address on all EVM chains (incl. Base) + the Solana
 * wallet via the portfolio scope (`?all=1`) of the cross-chain balance route.
 * This is a DISPLAY aggregate only — spendable balance per flow is still
 * chain-specific until smart routing lands.
 */
export function usePortfolio(
  evmAddress: string | undefined,
  solanaAddress?: string,
  stellarAddress?: string,
  /**
   * Show the last balance this device saw for this user while the live one loads. Only for a
   * screen that displays it: the snapshot can be days old, so nothing that sends or withdraws
   * may opt in. The value is the signed-in user's id, which the snapshot is stored under.
   */
  rememberFor?: string,
) {
  const remembered = useMemo(
    () =>
      rememberFor && evmAddress
        ? readCache<Portfolio>(rememberFor, `portfolio:${evmAddress}`, PORTFOLIO_SNAPSHOT_MS)
        : undefined,
    [rememberFor, evmAddress],
  );

  const query = useQuery<Portfolio>({
    queryKey: ['portfolio', evmAddress, solanaAddress, stellarAddress],
    // A Solana or Stellar address arriving changes the key: keep the balance just loaded for the
    // same wallet meanwhile. Never one for another wallet address.
    placeholderData: rememberFor
      ? (previous, previousQuery) => (previousQuery?.queryKey[1] === evmAddress ? previous : undefined)
      : undefined,
    queryFn: async () => {
      const params = new URLSearchParams({ address: evmAddress!, all: '1' });
      if (solanaAddress) params.set('solanaAddress', solanaAddress);
      if (stellarAddress) params.set('stellarAddress', stellarAddress);

      const res = await fetch(`/api/balances/cross-chain?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch portfolio balances');

      const balances = (await res.json()) as ChainBalance[];

      const total = balances.reduce((sum, b) => sum + (parseFloat(b.balance) || 0), 0);
      const byChain = [...balances].sort(
        (a, b) => (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0),
      );

      const portfolio = {
        total: total.toFixed(2),
        byChain,
        fundedChainCount: balances.filter((b) => b.hasBalance).length,
      };
      if (rememberFor) writeCache(rememberFor, `portfolio:${evmAddress}`, portfolio);
      return portfolio;
    },
    enabled: !!evmAddress,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  // The stored balance fills in whenever this visit has none, including after a failed fetch.
  // (Placeholder data would be dropped on that failure, leaving a zero balance.)
  const isRemembered = query.data === undefined && remembered !== undefined;
  return {
    ...query,
    data: query.data ?? remembered,
    isLoading: query.isLoading && !isRemembered,
    /** The figure is the stored one from an earlier visit. Nothing may be spent against it. */
    isRemembered,
  };
}
