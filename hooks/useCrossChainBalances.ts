import { useQuery } from '@tanstack/react-query';
import type { SupportedChain } from '@/lib/circle/gateway';

export type ChainBalanceChain = SupportedChain | 'solana';

export interface ChainBalance {
  chain: ChainBalanceChain;
  balance: string;
  hasBalance: boolean;
}

interface UseCrossChainBalancesParams {
  evmAddress: string | undefined;
  solanaAddress?: string | undefined;
}

export function useCrossChainBalances(
  evmAddressOrParams: string | UseCrossChainBalancesParams | undefined,
  solanaAddress?: string,
) {
  // Support both legacy string call signature and new object signature
  const evmAddress =
    typeof evmAddressOrParams === 'string'
      ? evmAddressOrParams
      : evmAddressOrParams?.evmAddress;
  const solAddr =
    typeof evmAddressOrParams === 'string'
      ? solanaAddress
      : evmAddressOrParams?.solanaAddress;

  return useQuery<ChainBalance[]>({
    queryKey: ['cross-chain-balances', evmAddress, solAddr],
    queryFn: async () => {
      if (!evmAddress) return [];

      const params = new URLSearchParams({ address: evmAddress });
      if (solAddr) params.set('solanaAddress', solAddr);

      const res = await fetch(`/api/balances/cross-chain?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch cross-chain balances');

      return res.json() as Promise<ChainBalance[]>;
    },
    enabled: !!evmAddress,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}
