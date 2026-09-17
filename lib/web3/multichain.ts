import { defineChain, type Chain } from 'viem';
import { mainnet, arbitrum, avalanche, base, optimism, polygon } from 'viem/chains';
import { type SupportedChain } from '../circle/gateway';

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

// Mapping of SupportedChain to Viem Chain objects
export const VIEM_CHAINS: Record<SupportedChain, Chain> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  avalanche: avalanche,
  optimism: optimism,
  polygon: polygon,
  base: base,
  arc: arc,
};
