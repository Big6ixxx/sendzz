import { createPublicClient, http, type Chain, type PublicClient, type Transport } from 'viem';
import { mainnet, arbitrum, avalanche, base, optimism, polygon } from 'viem/chains';
import { type SupportedChain } from '../circle/gateway';

// Mapping of SupportedChain to Viem Chain objects
export const VIEM_CHAINS: Record<SupportedChain, Chain> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  avalanche: avalanche,
  optimism: optimism,
  polygon: polygon,
  base: base,
};

// Public clients — used server-side only (balance scanning API route)
// Typed as a loose map since each chain produces a slightly different PublicClient generic
export const MULTICHAIN_CLIENTS: Record<SupportedChain, PublicClient<Transport, Chain>> = {
  ethereum: createPublicClient({ chain: mainnet, transport: http() }) as PublicClient<Transport, Chain>,
  arbitrum: createPublicClient({ chain: arbitrum, transport: http() }) as PublicClient<Transport, Chain>,
  avalanche: createPublicClient({ chain: avalanche, transport: http() }) as PublicClient<Transport, Chain>,
  optimism: createPublicClient({ chain: optimism, transport: http() }) as PublicClient<Transport, Chain>,
  polygon: createPublicClient({ chain: polygon, transport: http() }) as PublicClient<Transport, Chain>,
  base: createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_RPC_URL) }) as PublicClient<Transport, Chain>,
};
