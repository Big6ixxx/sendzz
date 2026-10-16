/**
 * Mainnet or testnet, decided once.
 *
 * `NEXT_PUBLIC_SIMULATION_MODE="true"` puts the whole app on testnets. Before this file the
 * flag was read in a handful of places with two different readings (`=== 'true'` in the CCTP
 * code, `=== 'false'` in the chain config), while chains, USDC addresses, CCTP contracts, Iris,
 * bundler slugs, Alchemy, Solana and Stellar were all hardcoded to mainnet — so a staging
 * deploy with testnet keys built mainnet transactions.
 *
 * Every network-dependent constant now comes from one of the two tables below. Adding a value
 * means adding it to BOTH; `NetworkConfig` makes the compiler insist, and network.test.ts
 * checks every `SupportedChain` has an entry at runtime.
 *
 * Deliberately free of runtime imports (the `SupportedChain` import is type-only), so anything
 * — explorers, email templates, the Stellar config — can depend on it without pulling in viem
 * or an SDK. The viem chain objects live in lib/web3/multichain.ts for that reason.
 */
import type { SupportedChain } from '@/lib/circle/gateway';

/** True only for the exact string "true". Unset or anything else is mainnet. */
export const IS_TESTNET = process.env.NEXT_PUBLIC_SIMULATION_MODE === 'true';

export interface NetworkConfig {
  /** EVM chain ids. Must agree with the viem chain objects in lib/web3/multichain. */
  chainIds: Record<SupportedChain, number>;
  /** Native USDC per chain — always the 6-decimal ERC-20 interface. */
  usdc: Record<SupportedChain, string>;
  /** CCTP V2 TokenMessengerV2 — one CREATE2 address across every EVM chain. */
  tokenMessengerV2: `0x${string}`;
  /** CCTP V2 MessageTransmitterV2 — one CREATE2 address across every EVM chain. */
  messageTransmitterV2: `0x${string}`;
  /** Circle Iris (attestation) API, including the `/v2` prefix. */
  irisApiBase: string;
  /** Path segment Circle's modular bundler expects after CIRCLE_SEND_URL. */
  bundlerSlug: Record<SupportedChain, string>;
  /** `<subdomain>.g.alchemy.com`. */
  alchemySubdomain: Record<SupportedChain, string>;
  /**
   * Keyless public endpoints, in preference order. Arc is absent on purpose: its endpoints are
   * taken from the chain definition in lib/web3/rpc so the two cannot disagree.
   */
  publicRpcs: Record<Exclude<SupportedChain, 'arc'>, string[]>;
  /** Transaction-explorer base URL, without a trailing slash. */
  explorerTx: Record<SupportedChain | 'solana' | 'stellar', string>;
  /** Appended after the hash — Solscan needs `?cluster=devnet` to look off mainnet. */
  explorerTxSuffix: Partial<Record<SupportedChain | 'solana' | 'stellar', string>>;
  solana: {
    /** Key under Privy's `solana.rpcs`. */
    privyCluster: 'solana:mainnet' | 'solana:devnet';
    /** What Circle's signing API calls this cluster. */
    circleBlockchain: 'SOL' | 'SOL-DEVNET';
    publicRpc: string;
    usdcMint: string;
  };
  /** Defaults only — every one of these is still overridable by its NEXT_PUBLIC_STELLAR_* var. */
  stellar: {
    networkPassphrase: string;
    horizonUrl: string;
    rpcUrl: string;
    /** Circle's classic USDC issuer. */
    usdcIssuer: string;
    /** Soroban SAC for that USDC. */
    usdcContract: string;
    /** Circle's CctpForwarder — `mint_and_forward` lives here. */
    cctpForwarder: string;
  };
}

export const MAINNET: NetworkConfig = {
  chainIds: {
    ethereum: 1,
    avalanche: 43114,
    optimism: 10,
    arbitrum: 42161,
    base: 8453,
    polygon: 137,
    arc: 5042,
  },
  usdc: {
    ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    // A precompile rather than a deployed contract, but it exposes the standard ERC-20 interface
    // at 6 decimals like every other entry here. Arc's 18-decimal gas unit is a separate thing —
    // see the note on `arc` in lib/web3/multichain.ts.
    arc: '0x3600000000000000000000000000000000000000',
  },
  tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
  irisApiBase: 'https://iris-api.circle.com/v2',
  bundlerSlug: {
    ethereum: 'ethereum',
    avalanche: 'avalanche',
    optimism: 'optimism',
    arbitrum: 'arbitrum',
    base: 'base',
    polygon: 'polygon',
    arc: 'arc',
  },
  alchemySubdomain: {
    ethereum: 'eth-mainnet',
    arbitrum: 'arb-mainnet',
    avalanche: 'avax-mainnet',
    optimism: 'opt-mainnet',
    polygon: 'polygon-mainnet',
    base: 'base-mainnet',
    arc: 'arc-mainnet',
  },
  publicRpcs: {
    ethereum: ['https://ethereum-rpc.publicnode.com'],
    arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
    avalanche: [
      'https://avalanche-c-chain-rpc.publicnode.com',
      'https://api.avax.network/ext/bc/C/rpc',
    ],
    optimism: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
    polygon: ['https://polygon-bor-rpc.publicnode.com'],
    base: ['https://mainnet.base.org', 'https://base.llamarpc.com', 'https://base-rpc.publicnode.com', 'https://1rpc.io/base'],
  },
  explorerTx: {
    ethereum: 'https://etherscan.io/tx',
    avalanche: 'https://snowtrace.io/tx',
    optimism: 'https://optimistic.etherscan.io/tx',
    arbitrum: 'https://arbiscan.io/tx',
    base: 'https://basescan.org/tx',
    polygon: 'https://polygonscan.com/tx',
    arc: 'https://explorer.arc.io/tx',
    solana: 'https://solscan.io/tx',
    stellar: 'https://stellar.expert/explorer/public/tx',
  },
  explorerTxSuffix: {},
  solana: {
    privyCluster: 'solana:mainnet',
    circleBlockchain: 'SOL',
    publicRpc: 'https://api.mainnet-beta.solana.com',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  stellar: {
    // = Networks.PUBLIC, spelled out so this file needs no Stellar SDK.
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    rpcUrl: 'https://soroban-rpc.mainnet.stellar.gateway.fm',
    usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    usdcContract: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    cctpForwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
  },
};

export const TESTNET: NetworkConfig = {
  chainIds: {
    ethereum: 11155111, // Sepolia
    avalanche: 43113, // Fuji
    optimism: 11155420, // OP Sepolia
    arbitrum: 421614, // Arbitrum Sepolia
    base: 84532, // Base Sepolia
    polygon: 80002, // Amoy
    arc: 5042002, // Arc Testnet
  },
  usdc: {
    ethereum: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    avalanche: '0x5425890298aed601595a70AB815c96711a31Bc65',
    optimism: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    arbitrum: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    base: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    polygon: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    arc: '0x3600000000000000000000000000000000000000',
  },
  tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  messageTransmitterV2: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  irisApiBase: 'https://iris-api-sandbox.circle.com/v2',
  bundlerSlug: {
    // Circle's bundler does not serve L1 (see BRIDGE_DISABLED_CHAINS); kept for completeness.
    ethereum: 'sepolia',
    avalanche: 'avalancheFuji',
    optimism: 'optimismSepolia',
    arbitrum: 'arbitrumSepolia',
    base: 'baseSepolia',
    polygon: 'polygonAmoy',
    arc: 'arcTestnet',
  },
  alchemySubdomain: {
    ethereum: 'eth-sepolia',
    arbitrum: 'arb-sepolia',
    avalanche: 'avax-fuji',
    optimism: 'opt-sepolia',
    polygon: 'polygon-amoy',
    base: 'base-sepolia',
    arc: 'arc-testnet',
  },
  publicRpcs: {
    ethereum: ['https://ethereum-sepolia-rpc.publicnode.com'],
    arbitrum: [
      'https://arbitrum-sepolia-rpc.publicnode.com',
      'https://sepolia-rollup.arbitrum.io/rpc',
    ],
    avalanche: [
      'https://avalanche-fuji-c-chain-rpc.publicnode.com',
      'https://api.avax-test.network/ext/bc/C/rpc',
    ],
    optimism: ['https://optimism-sepolia-rpc.publicnode.com', 'https://sepolia.optimism.io'],
    polygon: ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://rpc-amoy.polygon.technology'],
    base: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
  },
  explorerTx: {
    ethereum: 'https://sepolia.etherscan.io/tx',
    avalanche: 'https://testnet.snowtrace.io/tx',
    optimism: 'https://sepolia-optimism.etherscan.io/tx',
    arbitrum: 'https://sepolia.arbiscan.io/tx',
    base: 'https://sepolia.basescan.org/tx',
    polygon: 'https://amoy.polygonscan.com/tx',
    arc: 'https://explorer.testnet.arc.io/tx',
    solana: 'https://solscan.io/tx',
    stellar: 'https://stellar.expert/explorer/testnet/tx',
  },
  explorerTxSuffix: {
    solana: '?cluster=devnet',
  },
  solana: {
    privyCluster: 'solana:devnet',
    circleBlockchain: 'SOL-DEVNET',
    publicRpc: 'https://api.devnet.solana.com',
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  },
  stellar: {
    // = Networks.TESTNET. Stellar testnet resets roughly quarterly — re-check these after one.
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    usdcContract: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    cctpForwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
  },
};

/** The table the running app uses. */
export const NETWORK: NetworkConfig = IS_TESTNET ? TESTNET : MAINNET;

/**
 * Circle modular-bundler path segment for a chain. Unknown chains pass through unchanged,
 * which is exactly what every call site did before (`${CIRCLE_SEND_URL}/${chain}`).
 */
export function circleBundlerSlug(chain: string): string {
  return (NETWORK.bundlerSlug as Record<string, string>)[chain] ?? chain;
}
