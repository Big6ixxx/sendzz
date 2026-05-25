import { useQuery } from '@tanstack/react-query';
import type { SupportedChain } from '@/lib/circle/gateway';

export interface ChainBalance {
  chain: SupportedChain;
  balance: string;
  hasBalance: boolean;
}

export function useCrossChainBalances(address: string | undefined) {
  return useQuery<ChainBalance[]>({
    queryKey: ['cross-chain-balances', address],
    queryFn: async () => {
      if (!address) return [];

      const res = await fetch(`/api/balances/cross-chain?address=${address}`);
      if (!res.ok) throw new Error('Failed to fetch cross-chain balances');

      return res.json() as Promise<ChainBalance[]>;
    },
    enabled: !!address,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}
