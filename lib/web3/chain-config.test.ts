/**
 * Chain configuration consistency.
 *
 * Every failure this suite guards against actually happened on the Arc branch: a USDC
 * address with no contract behind it, a CCTP domain that Circle rejects, a bundler slug
 * that pointed a testnet user operation at a mainnet endpoint, and a chain that appeared
 * in one list but was missing from another. None of them are type errors — the records
 * are total, so the compiler was satisfied while every transaction reverted.
 *
 * These assertions are all offline; the live counterparts (does this address have code?
 * does Iris accept this domain?) are documented in the branch notes.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CCTP_DOMAINS,
  CHAIN_IDS,
  CHAIN_NAMES,
  USDC_ADDRESSES,
  SOURCE_CHAINS,
  TOKEN_MESSENGER_V2,
  MESSAGE_TRANSMITTER_V2,
  type SupportedChain,
} from '../circle/gateway';
import { EVM_CHAINS } from './routing';
import { VIEM_CHAINS } from './multichain';
import { PUBLIC_RPCS } from './rpc';
import { getCircleChainSlug, isCircleSupported } from './circle-networks';
import { EXPLORER_TX_BASE, HOME_CHAIN, explorerTxUrl } from '../explorers';
import { IS_TESTNET, IS_ARC_ENABLED } from './network';
import { arcTestnet } from './arc-chain';

/** Chains the app will actually touch at runtime, in the current network family. */
const ACTIVE_CHAINS: SupportedChain[] = Array.from(
  new Set<SupportedChain>([...EVM_CHAINS, ...SOURCE_CHAINS]),
);

describe('active chain wiring', () => {
  it.each(ACTIVE_CHAINS)('%s has every piece of config it needs', (chain) => {
    expect(USDC_ADDRESSES[chain], 'USDC address').toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(CHAIN_IDS[chain], 'chain id').toBeGreaterThan(0);
    expect(CHAIN_NAMES[chain], 'display name').toBeTruthy();
    expect(CCTP_DOMAINS[chain], 'CCTP domain').toBeTypeOf('number');
    expect(VIEM_CHAINS[chain], 'viem chain').toBeTruthy();
    expect(PUBLIC_RPCS[chain]?.length, 'public RPC').toBeGreaterThan(0);
    expect(EXPLORER_TX_BASE[chain], 'explorer').toMatch(/^https:\/\//);
  });

  it('agrees with viem about every chain id', () => {
    for (const chain of ACTIVE_CHAINS) {
      expect(VIEM_CHAINS[chain].id, `${chain} chain id`).toBe(CHAIN_IDS[chain]);
    }
  });

  it('can reach Circle bundler for every chain it routes payments over', () => {
    for (const chain of EVM_CHAINS) {
      expect(isCircleSupported(chain), `${chain} Circle support`).toBe(true);
      expect(getCircleChainSlug(chain)).toBeTruthy();
    }
  });

  it('settles on a chain it actually supports', () => {
    expect(ACTIVE_CHAINS).toContain(HOME_CHAIN as SupportedChain);
  });
});

describe('network family coherence', () => {
  it('uses the CCTP contract set matching the network family', () => {
    // Mainnet and testnet are different CREATE2 deployments. Crossing them targets an
    // address with no code, which is how every testnet bridge came to revert.
    const expectedMessenger = IS_TESTNET
      ? '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
      : '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
    const expectedTransmitter = IS_TESTNET
      ? '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
      : '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

    expect(TOKEN_MESSENGER_V2).toBe(expectedMessenger);
    expect(MESSAGE_TRANSMITTER_V2).toBe(expectedTransmitter);
  });

  it('never mixes mainnet and testnet chain ids', () => {
    const MAINNET_IDS = new Set([1, 10, 137, 8453, 42161, 43114]);
    for (const chain of ACTIVE_CHAINS) {
      const isMainnetId = MAINNET_IDS.has(CHAIN_IDS[chain]);
      expect(isMainnetId, `${chain} is on the wrong network family`).toBe(!IS_TESTNET);
    }
  });

  it('bundler slugs match the network family', () => {
    // `base` is Base mainnet; Base Sepolia is `baseSepolia`. Getting this wrong signs a
    // user operation against a chain the account is not on.
    expect(getCircleChainSlug('base')).toBe(IS_TESTNET ? 'baseSepolia' : 'base');
  });
});

describe('Circle credentials', () => {
  it('rejects a LIVE key on testnet and a TEST key on mainnet', async () => {
    for (const [key, mode] of [
      ['LIVE_CLIENT_KEY:abc', 'true'],
      ['TEST_CLIENT_KEY:abc', 'false'],
    ] as const) {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CIRCLE_CLIENT_KEY', key);
      vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', mode);
      const { assertCircleKeyMatchesNetwork } = await import('./circle-networks');
      expect(() => assertCircleKeyMatchesNetwork(), `${key} on ${mode}`).toThrow(
        /Circle rejects this pairing/,
      );
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('accepts a matching pair and ignores an unrecognised key format', async () => {
    for (const [key, mode] of [
      ['TEST_CLIENT_KEY:abc', 'true'],
      ['LIVE_CLIENT_KEY:abc', 'false'],
      ['something-else', 'true'],
      ['', 'true'],
    ] as const) {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CIRCLE_CLIENT_KEY', key);
      vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', mode);
      const { assertCircleKeyMatchesNetwork } = await import('./circle-networks');
      expect(() => assertCircleKeyMatchesNetwork(), `${key} on ${mode}`).not.toThrow();
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe('Arc', () => {
  it('is exposed only where it exists', () => {
    // Arc is testnet-only; a mainnet build must not offer it anywhere.
    expect(EVM_CHAINS.includes('arc')).toBe(IS_ARC_ENABLED);
    expect(SOURCE_CHAINS.includes('arc')).toBe(IS_ARC_ENABLED);
    expect(IS_ARC_ENABLED).toBe(IS_TESTNET);
  });

  it('uses the ERC-20 system contract, not the native interface', () => {
    // Arc's USDC is the native gas token *and* an ERC-20 at this fixed system address.
    // App logic must use the ERC-20: it reports 6 decimals, while the native balance
    // reports 18 for the very same funds.
    expect(USDC_ADDRESSES.arc).toBe('0x3600000000000000000000000000000000000000');
    expect(arcTestnet.nativeCurrency.decimals).toBe(18);
  });

  it('uses CCTP domain 26', () => {
    // Verified on-chain: MessageTransmitterV2.localDomain() returns 0x1a on Arc, and
    // Iris rejects domain 20 outright as an invalid domain id.
    expect(CCTP_DOMAINS.arc).toBe(26);
  });

  it('has chain id 5042002 and links to ArcScan', () => {
    expect(arcTestnet.id).toBe(5042002);
    expect(explorerTxUrl('arc', `0x${'ab'.repeat(32)}`)).toContain('testnet.arcscan.app');
  });
});
