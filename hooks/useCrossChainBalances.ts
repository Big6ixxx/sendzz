import { useQuery } from '@tanstack/react-query';
import type { SupportedChain } from '@/lib/circle/gateway';

export type ChainBalanceChain = SupportedChain | 'solana' | 'stellar';

export interface ChainBalance {
  chain: ChainBalanceChain;
  balance: string;
  hasBalance: boolean;
}

interface UseCrossChainBalancesParams {
  evmAddress: string | undefined;
  solanaAddress?: string | undefined;
  stellarAddress?: string | undefined;
}

export function useCrossChainBalances(
  evmAddressOrParams: string | UseCrossChainBalancesParams | undefined,
  solanaAddress?: string,
  stellarAddress?: string,
) {
  const evmAddress =
    typeof evmAddressOrParams === 'string'
      ? evmAddressOrParams
      : evmAddressOrParams?.evmAddress;
  const solAddr =
    typeof evmAddressOrParams === 'string'
      ? solanaAddress
      : evmAddressOrParams?.solanaAddress;
  const stellarAddr =
    typeof evmAddressOrParams === 'string'
      ? stellarAddress
      : evmAddressOrParams?.stellarAddress;

  return useQuery<ChainBalance[]>({
    queryKey: ['cross-chain-balances', evmAddress, solAddr, stellarAddr],
    queryFn: async () => {
      if (!evmAddress) return [];

      const params = new URLSearchParams({ address: evmAddress });
      if (solAddr) params.set('solanaAddress', solAddr);
      if (stellarAddr) params.set('stellarAddress', stellarAddr);

      const res = await fetch(`/api/balances/cross-chain?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch cross-chain balances');

      return res.json() as Promise<ChainBalance[]>;
    },
    enabled: !!evmAddress,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}
