import { defineChain, type Chain } from 'viem';
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
import { type SupportedChain } from '../circle/gateway';
import { IS_TESTNET } from '../network';

/**
 * Arc — Circle's L1, live on mainnet since 16 Sep 2026.
 *
 * Defined here rather than imported: viem ships `arc` from 2.56.x onwards and we are on
 * 2.47.x. This definition is copied verbatim from upstream, so the day viem is bumped this
 * block can be deleted and replaced with an import — the values will already agree.
 *
 * The 18 in `nativeCurrency` describes GAS, not the token. Arc's gas happens to be USDC, and
 * gas is counted in wei at 18 decimals on every EVM chain, so viem labels it that way. The
 * USDC anyone actually holds is the ERC-20 precompile in `USDC_ADDRESSES`, which reports 6
 * decimals — that is the one every balance and transfer here goes through. Gas is sponsored by
 * Circle Gas Station, so this 18 never reaches an amount a user sees. Do not "correct" it.
 */
export const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.mainnet.arc.io',
        'https://rpc.blockdaemon.mainnet.arc.io',
        'https://rpc.drpc.mainnet.arc.io',
        'https://rpc.quicknode.mainnet.arc.io',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.arc.io',
      apiUrl: 'https://explorer.arc.io/api/v2',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 0,
    },
  },
});

/**
 * Arc Testnet. viem 2.47 ships an `arcTestnet`, but on the older `arc.network` domains; Circle
 * now publishes `arc.io` ones, so this lists those first and keeps the old ones as fallbacks
 * (both answered chain id 5042002 when written).
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.io', 'https://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.testnet.arc.io',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 0,
    },
  },
  testnet: true,
});

export const MAINNET_VIEM_CHAINS: Record<SupportedChain, Chain> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  avalanche: avalanche,
  optimism: optimism,
  polygon: polygon,
  base: base,
  arc: arc,
};

export const TESTNET_VIEM_CHAINS: Record<SupportedChain, Chain> = {
  ethereum: sepolia,
  arbitrum: arbitrumSepolia,
  avalanche: avalancheFuji,
  optimism: optimismSepolia,
  polygon: polygonAmoy,
  base: baseSepolia,
  arc: arcTestnet,
};

// Mapping of SupportedChain to Viem Chain objects, for whichever network lib/network selects.
export const VIEM_CHAINS: Record<SupportedChain, Chain> = IS_TESTNET
  ? TESTNET_VIEM_CHAINS
  : MAINNET_VIEM_CHAINS;
