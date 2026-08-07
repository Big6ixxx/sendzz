import { type Chain } from 'viem';
import {
  mainnet,
  arbitrum,
  avalanche,
  base,
  optimism,
  polygon,
  sepolia,
  arbitrumSepolia,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
} from 'viem/chains';
import { arcTestnet } from './arc-chain';
import { IS_TESTNET } from './network';
import { type SupportedChain } from '../circle/gateway';

// Mapping of SupportedChain to Viem Chain objects (Mainnet vs Testnet)
export const VIEM_CHAINS: Record<SupportedChain, Chain> = IS_TESTNET
  ? {
      ethereum: sepolia,
      arbitrum: arbitrumSepolia,
      avalanche: avalancheFuji,
      optimism: optimismSepolia,
      polygon: polygonAmoy,
      base: baseSepolia,
      arc: arcTestnet,
    }
  : {
      ethereum: mainnet,
      arbitrum: arbitrum,
      avalanche: avalanche,
      optimism: optimism,
      polygon: polygon,
      base: base,
      arc: arcTestnet,
    };
