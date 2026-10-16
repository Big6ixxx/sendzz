import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupportedChain } from '@/lib/circle/gateway';
import { MAINNET, TESTNET, type NetworkConfig } from '@/lib/network';
import { MAINNET_VIEM_CHAINS, TESTNET_VIEM_CHAINS } from '@/lib/web3/multichain';

/**
 * Every SupportedChain, spelled out. The `satisfies` makes the compiler reject this file the day
 * a chain is added to `SupportedChain` without being added here, so the runtime checks below can
 * never silently skip it.
 */
const ALL_CHAINS = Object.keys({
  ethereum: true,
  avalanche: true,
  optimism: true,
  arbitrum: true,
  base: true,
  polygon: true,
  arc: true,
} satisfies Record<SupportedChain, true>) as SupportedChain[];

const TABLES: [string, NetworkConfig, typeof MAINNET_VIEM_CHAINS][] = [
  ['mainnet', MAINNET, MAINNET_VIEM_CHAINS],
  ['testnet', TESTNET, TESTNET_VIEM_CHAINS],
];

describe.each(TABLES)('%s table', (_name, net, viemChains) => {
  it.each(ALL_CHAINS)('has every per-chain value for %s', (chain) => {
    expect(net.chainIds[chain], 'chain id').toBeGreaterThan(0);
    expect(net.usdc[chain], 'USDC').toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(net.bundlerSlug[chain], 'bundler slug').toMatch(/^[a-zA-Z]+$/);
    expect(net.alchemySubdomain[chain], 'alchemy subdomain').toMatch(/^[a-z]+-[a-z]+$/);
    expect(net.explorerTx[chain], 'explorer').toMatch(/^https:\/\/[^ ]+\/tx$/);
    if (chain !== 'arc') {
      expect(net.publicRpcs[chain].length, 'public RPCs').toBeGreaterThan(0);
    }
    expect(viemChains[chain], 'viem chain').toBeTruthy();
    expect(viemChains[chain].id, 'viem id agrees with chainIds').toBe(net.chainIds[chain]);
    expect(viemChains[chain].rpcUrls.default.http.length, 'viem RPCs').toBeGreaterThan(0);
  });

  it('has no entries beyond SupportedChain', () => {
    for (const map of [net.chainIds, net.usdc, net.bundlerSlug, net.alchemySubdomain, viemChains]) {
      expect(Object.keys(map).sort()).toEqual([...ALL_CHAINS].sort());
    }
  });

  it('gives every chain a distinct id', () => {
    const ids = ALL_CHAINS.map((c) => net.chainIds[c]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has CCTP, Iris, Solana and Stellar values', () => {
    expect(net.tokenMessengerV2).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(net.messageTransmitterV2).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(net.irisApiBase).toMatch(/^https:\/\/iris-api(-sandbox)?\.circle\.com\/v2$/);
    expect(net.explorerTx.solana).toMatch(/^https:\/\//);
    expect(net.explorerTx.stellar).toMatch(/^https:\/\//);
    expect(net.solana.usdcMint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(net.stellar.usdcIssuer).toMatch(/^G[A-Z2-7]{55}$/);
    expect(net.stellar.usdcContract).toMatch(/^C[A-Z2-7]{55}$/);
    expect(net.stellar.cctpForwarder).toMatch(/^C[A-Z2-7]{55}$/);
  });
});

describe('mainnet and testnet never overlap', () => {
  it('shares no chain id between the two tables', () => {
    const mainnetIds = new Set(Object.values(MAINNET.chainIds));
    for (const id of Object.values(TESTNET.chainIds)) expect(mainnetIds.has(id), String(id)).toBe(false);
  });

  it('uses Circle testnet CCTP contracts, not the mainnet ones', () => {
    expect(TESTNET.tokenMessengerV2).toBe('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA');
    expect(TESTNET.messageTransmitterV2).toBe('0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275');
    expect(TESTNET.irisApiBase).toBe('https://iris-api-sandbox.circle.com/v2');
  });
});

describe('mainnet keeps its pre-existing values', () => {
  // These were hardcoded at their call sites before lib/network existed. Mainnet must not move.
  it('matches the old constants', () => {
    expect(MAINNET.tokenMessengerV2).toBe('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d');
    expect(MAINNET.messageTransmitterV2).toBe('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64');
    expect(MAINNET.irisApiBase).toBe('https://iris-api.circle.com/v2');
    expect(MAINNET.usdc.base).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(MAINNET.solana.usdcMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(MAINNET.solana.privyCluster).toBe('solana:mainnet');
    expect(MAINNET.stellar.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
    expect(MAINNET.explorerTxSuffix).toEqual({});
    for (const chain of ALL_CHAINS) expect(MAINNET.bundlerSlug[chain]).toBe(chain);
  });
});

describe('NEXT_PUBLIC_SIMULATION_MODE', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(value: string | undefined) {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', value as string);
    return import('@/lib/network');
  }

  it('is testnet only for the exact string "true"', async () => {
    expect((await load('true')).IS_TESTNET).toBe(true);
    expect((await load('false')).IS_TESTNET).toBe(false);
    expect((await load(undefined)).IS_TESTNET).toBe(false);
    expect((await load('TRUE')).IS_TESTNET).toBe(false);
  });

  it('selects the matching table and bundler slugs', async () => {
    const testnet = await load('true');
    expect(testnet.NETWORK).toBe(testnet.TESTNET);
    expect(testnet.circleBundlerSlug('base')).toBe('baseSepolia');
    expect(testnet.circleBundlerSlug('arc')).toBe('arcTestnet');
    expect(testnet.circleBundlerSlug('unknown')).toBe('unknown');

    const mainnet = await load('false');
    expect(mainnet.NETWORK).toBe(mainnet.MAINNET);
    expect(mainnet.circleBundlerSlug('base')).toBe('base');
  });

  it('points explorer links at devnet/testnet', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', 'true');
    const { explorerTxUrl } = await import('@/lib/explorers');
    expect(explorerTxUrl('solana', 'abc')).toBe('https://solscan.io/tx/abc?cluster=devnet');
    expect(explorerTxUrl('base', '0x1')).toBe('https://sepolia.basescan.org/tx/0x1');
  });
});
