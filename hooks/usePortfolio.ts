import { useQuery } from '@tanstack/react-query';
import type { ChainBalance } from '@/hooks/useCrossChainBalances';

export interface Portfolio {
  /** Sum of USDC across every chain, formatted to 2dp. */
  total: string;
  /** Per-chain balances, funded chains first, each sorted by descending balance. */
  byChain: ChainBalance[];
  /** Number of chains the user currently holds a non-zero balance on. */
  fundedChainCount: number;
}

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
) {
  return useQuery<Portfolio>({
    queryKey: ['portfolio', evmAddress, solanaAddress, stellarAddress],
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

      return {
        total: total.toFixed(2),
        byChain,
        fundedChainCount: balances.filter((b) => b.hasBalance).length,
      };
    },
    enabled: !!evmAddress,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}
