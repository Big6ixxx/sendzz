import { createPublicClient, http } from 'viem';
import { mainnet, arbitrum, avalanche, base } from 'viem/chains';
import { type SupportedChain } from '../circle/gateway';

// Mapping of SupportedChain to Viem Chain objects
export const VIEM_CHAINS: Record<SupportedChain, any> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  avalanche: avalanche,
  optimism: optimism,
  polygon: polygon,
  base: base,
};

// Public clients — used server-side only (balance scanning API route)
export const MULTICHAIN_CLIENTS: Record<SupportedChain, any> = {
  ethereum: createPublicClient({ chain: mainnet, transport: http() }),
  arbitrum: createPublicClient({ chain: arbitrum, transport: http() }),
  avalanche: createPublicClient({ chain: avalanche, transport: http() }),
  base: createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_RPC_URL) }),
};
