import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import {
  EVM_USDC_CHAINS,
  CCTP_DOMAINS,
  USDC_ADDRESSES,
  CHAIN_IDS,
  CHAIN_NAMES,
  isEvmUsdcChain,
  SOURCE_CHAINS,
} from '@/lib/circle/gateway';
import { VIEM_CHAINS } from '@/lib/web3/multichain';
import { ALCHEMY_SUBDOMAIN, rpcUrls } from '@/lib/web3/rpc';
import { EXPLORER_TX_BASE, explorerTxUrl } from '@/lib/explorers';
import { EVM_CHAINS, RAMP_NETWORKS } from '@/lib/web3/routing';
// Imported statically, not with `await import()` inside each test. Loading this module pulls in
// viem, the Solana kit and the Stellar SDK, which took ~3.9s — charged against the first test's
// 5s budget, so the whole file passed or failed on how warm the module cache happened to be.
// At the top it is collection cost, which is measured separately and shared by every case.
import { claimBridgeOnDestination } from './bridge-claim';

/**
 * Every EVM chain must be registered everywhere, not just in the maps the compiler checks.
 *
 * Arc shipped with `tsc` fully green and still could not be claimed to: `bridge-claim.ts` held
 * a hardcoded array of chain names, so the burn succeeded and the mint was refused by our own
 * code. A `Record<SupportedChain, …>` fails the build when a chain is missing; a
 * `string[]` sitting next to it does not. These tests cover the gap.
 */
describe('chain registration is complete', () => {
  it.each(EVM_USDC_CHAINS)('%s has every piece of chain metadata', (chain) => {
    expect(USDC_ADDRESSES[chain], 'USDC address').toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(CHAIN_IDS[chain], 'chain id').toBeGreaterThan(0);
    expect(CHAIN_NAMES[chain], 'display name').toBeTruthy();
    expect(CCTP_DOMAINS[chain], 'CCTP domain').toBeTypeOf('number');
    expect(VIEM_CHAINS[chain], 'viem chain').toBeTruthy();
    expect(VIEM_CHAINS[chain].id, 'viem id matches CHAIN_IDS').toBe(CHAIN_IDS[chain]);
    expect(ALCHEMY_SUBDOMAIN[chain], 'alchemy subdomain').toBeTruthy();
    expect(EXPLORER_TX_BASE[chain], 'explorer base').toMatch(/^https:\/\//);
    expect(rpcUrls(chain).length, 'at least one RPC endpoint').toBeGreaterThan(0);
  });

  it.each(EVM_USDC_CHAINS)('%s can be claimed to', async (chain) => {
    // Exercises the real router in bridge-claim.ts, not just the predicate it happens to use —
    // the bug was a hardcoded list INSIDE that module, which a test of `isEvmUsdcChain` alone
    // would have passed straight through.
    //
    // With no wallet supplied, a routed chain fails at the wallet check and an unrouted one
    // fails with "not supported". Only the second means the chain is unreachable.
    const err = await claimBridgeOnDestination({
      destChain: chain,
      messageBytes: '0xdead',
      attestation: `0x${'ab'.repeat(40)}`,
      embeddedWallet: null,
    }).catch((e: Error) => e);

    expect(err, `${chain} should have thrown`).toBeInstanceOf(Error);
    expect((err as Error).message, `${chain} is not routed for claiming`).not.toMatch(
      /is not supported/i,
    );
  });

  it('still refuses a chain it genuinely cannot claim to', async () => {
    // Negative control: proves the assertion above can actually fail.
    const err = await claimBridgeOnDestination({
      destChain: 'notachain',
      messageBytes: '0xdead',
      attestation: '0xabcd',
      embeddedWallet: null,
    }).catch((e: Error) => e);

    expect((err as Error).message).toMatch(/is not supported/i);
  });

  it('matches chain names case-insensitively', () => {
    // dest_chain comes out of the database and has not always been stored lowercase.
    for (const chain of EVM_USDC_CHAINS) {
      expect(isEvmUsdcChain(chain.toUpperCase()), chain).toBe(true);
    }
  });

  it('offers every chain to the wallet rather than a hand-written list', async () => {
    // Privy refuses `wallet_switchEthereumChain` for any chain absent from `supportedChains`
    // — "Unsupported chainId 5042" — which broke claiming on Arc even after the claim router
    // accepted it. Asserting the ids are present would be circular (the array is built from
    // VIEM_CHAINS), so this asserts the thing that actually matters: that the provider derives
    // the list instead of keeping its own copy to drift.
    const src = await readFile(
      new URL('../../components/providers.tsx', import.meta.url),
      'utf8',
    );
    const supported = src.match(/supportedChains:\s*(.+)/)?.[1] ?? '';
    expect(supported, 'supportedChains must derive from VIEM_CHAINS').toContain('VIEM_CHAINS');
  });

  it('gives every chain a distinct CCTP domain', () => {
    const domains = Object.values(CCTP_DOMAINS);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('gives every chain a distinct chain id', () => {
    const ids = EVM_USDC_CHAINS.map((c) => CHAIN_IDS[c]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a working explorer link for every chain', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    for (const chain of EVM_USDC_CHAINS) {
      expect(explorerTxUrl(chain, hash), chain).toContain(hash);
    }
  });

  it('never offers a chain to spend from that it cannot scan', () => {
    // A chain we route spends through but never read balances on is a one-way door.
    for (const chain of EVM_CHAINS) {
      expect(EVM_USDC_CHAINS, `${chain} must be scannable`).toContain(chain);
    }
  });

  it('only settles fiat on chains it can also spend from', () => {
    for (const chain of RAMP_NETWORKS) {
      expect(EVM_CHAINS, `${chain} must be transactable`).toContain(chain);
    }
  });
});

describe('Arc', () => {
  // Arc's settlement rule, asserted rather than left to a comment: funds on Arc are bridged to
  // Base for a payout. Putting Arc in RAMP_NETWORKS would silently settle payouts on Arc.
  it('is a spendable source but never a fiat settlement chain', () => {
    expect(EVM_CHAINS).toContain('arc');
    expect(SOURCE_CHAINS).toContain('arc');
    expect(RAMP_NETWORKS).not.toContain('arc');
  });

  it('uses the 6-decimal USDC precompile, not the 18-decimal gas unit', () => {
    expect(USDC_ADDRESSES.arc).toBe('0x3600000000000000000000000000000000000000');
    // The 18 on VIEM_CHAINS.arc.nativeCurrency describes gas; it must never be read as the
    // token's precision.
    expect(VIEM_CHAINS.arc.nativeCurrency.decimals).toBe(18);
    expect(CHAIN_IDS.arc).toBe(5042);
    expect(CCTP_DOMAINS.arc).toBe(26);
  });
});
