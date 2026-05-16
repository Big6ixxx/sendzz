import { useQuery } from '@tanstack/react-query';
import { SOURCE_CHAINS, type SupportedChain } from '@/lib/circle/gateway';
import { getCrossChainUSDCBalance } from '@/lib/web3/multichain';

export interface ChainBalance {
  chain: SupportedChain;
  balance: string;
  hasBalance: boolean;
}

export function useCrossChainBalances(address: string | undefined) {
  return useQuery({
    queryKey: ['cross-chain-balances', address],
    queryFn: async () => {
      if (!address) return [];

      const balancePromises = SOURCE_CHAINS.map(async (chain) => {
        const balance = await getCrossChainUSDCBalance(chain, address);
        return {
          chain,
          balance,
          hasBalance: parseFloat(balance) > 0,
        };
      });

      const results = await Promise.all(balancePromises);
      return results.filter((r) => r.hasBalance);
    },
    enabled: !!address,
    refetchInterval: 30000, // Refresh every 30s
    staleTime: 15000,
  });
}
