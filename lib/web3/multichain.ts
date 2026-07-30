import { type Chain } from 'viem';
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
