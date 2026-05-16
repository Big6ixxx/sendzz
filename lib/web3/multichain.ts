import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet, arbitrum, optimism, polygon, avalanche, base } from 'viem/chains';
import { USDC_ADDRESSES, type SupportedChain } from '../circle/gateway';

const IS_PROD = process.env.NEXT_PUBLIC_SIMULATION_MODE === 'false';

// Mapping of SupportedChain to Viem Chain objects
export const VIEM_CHAINS: Record<SupportedChain, any> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  optimism: optimism,
  polygon: polygon,
  avalanche: avalanche,
  base: base,
};

// Create public clients for each chain
// In a real app, we'd use dedicated RPC URLs from env
export const MULTICHAIN_CLIENTS: Record<SupportedChain, any> = {
  ethereum: createPublicClient({ chain: mainnet, transport: http() }),
  arbitrum: createPublicClient({ chain: arbitrum, transport: http() }),
  optimism: createPublicClient({ chain: optimism, transport: http() }),
  polygon: createPublicClient({ chain: polygon, transport: http() }),
  avalanche: createPublicClient({ chain: avalanche, transport: http() }),
  base: createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_RPC_URL) }),
};

/**
 * Fetches USDC balance for a specific chain
 */
export async function getCrossChainUSDCBalance(
  chain: SupportedChain,
  address: string
): Promise<string> {
  try {
    const client = MULTICHAIN_CLIENTS[chain];
    const usdcAddress = USDC_ADDRESSES[chain];
    
    if (!client || !usdcAddress) return '0';

    const balance = await client.readContract({
      address: usdcAddress as `0x${string}`,
      abi: [
        {
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        },
      ],
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });

    // USDC is 6 decimals on all CCTP chains
    return (Number(balance) / 1_000_000).toString();
  } catch (error) {
    console.error(`[Multichain] Error fetching USDC balance on ${chain}:`, error);
    return '0';
  }
}
