/**
 * Gas pricing for sponsored user operations.
 *
 * These exist because of a failure with no error message. A userOperation priced below
 * the destination chain's own mempool floor is accepted by the bundler, never mined, and
 * never reported — so a Polygon bridge burned the USDC and then sat forever while every
 * other chain worked. The per-chain floor that prevents it was written but only applied
 * on the fallback path, which never runs when the bundler answers (it almost always
 * does). Nothing about that is visible to the type checker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BundlerClient } from 'viem/account-abstraction';
import type { PublicClient } from 'viem';

vi.mock('@circle-fin/modular-wallets-core', () => ({
  modularWalletActions: () => ({}),
}));

const GWEI = 1_000_000_000n;

/** A bundler that quotes `high`, the way Circle's does. */
function quotingBundler(highPriorityGwei: number, highMaxGwei: number) {
  const gasPrice = {
    high: {
      maxPriorityFeePerGas: (BigInt(highPriorityGwei) * GWEI).toString(),
      maxFeePerGas: (BigInt(highMaxGwei) * GWEI).toString(),
    },
  };
  const client = {
    extend: () => ({ getUserOperationGasPrice: async () => gasPrice }),
  };
  return client as unknown as BundlerClient;
}

/** A bundler that refuses to quote, forcing the padded-estimate fallback. */
function silentBundler() {
  const client = {
    extend: () => ({
      getUserOperationGasPrice: async () => {
        throw new Error('unsupported method');
      },
    }),
  };
  return client as unknown as BundlerClient;
}

const publicClient = {
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2n * GWEI, maxPriorityFeePerGas: GWEI }),
  getBlock: async () => ({ baseFeePerGas: GWEI }),
} as unknown as PublicClient;

let sponsoredUserOpFees: typeof import('./bridge-actions')['sponsoredUserOpFees'];
let IS_TESTNET: boolean;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  ({ sponsoredUserOpFees } = await import('./bridge-actions'));
  ({ IS_TESTNET } = await import('./network'));
});

/**
 * Bor rejects anything under `txpool.pricelimit` — 25 gwei on Amoy, 30 on PoS mainnet —
 * and drops it silently rather than erroring. Whatever floor this build uses has to clear
 * the higher of the two, since one constant serves both.
 */
const BOR_PRICE_LIMIT = 30n * GWEI;

describe('sponsoredUserOpFees', () => {
  it('raises a bundler quote that sits under Polygon’s mempool floor', async () => {
    // Circle quoting 2 gwei is a perfectly sane bundler answer, and it is also below
    // what Bor will admit. The floor has to win.
    const fees = await sponsoredUserOpFees(quotingBundler(2, 4), publicClient, 'polygon');

    expect(fees.maxPriorityFeePerGas).toBeGreaterThanOrEqual(BOR_PRICE_LIMIT);
  });

  it('applies the floor on the fallback path too', async () => {
    const fees = await sponsoredUserOpFees(silentBundler(), publicClient, 'polygon');

    expect(fees.maxPriorityFeePerGas).toBeGreaterThanOrEqual(BOR_PRICE_LIMIT);
  });

  it('keeps a bundler quote that already clears the floor', async () => {
    // 400 gwei is above both floors, so it must survive untouched — the floor is a
    // minimum, not a target, and overriding a high quote downward would underprice.
    const fees = await sponsoredUserOpFees(quotingBundler(400, 500), publicClient, 'polygon');

    expect(fees.maxPriorityFeePerGas).toBe(400n * GWEI);
  });

  it('never returns a ceiling below the priority fee it must cover', async () => {
    // maxFeePerGas < maxPriorityFeePerGas is malformed, not merely underpriced. Raising
    // priority to a chain floor is exactly the operation that can produce it.
    for (const chain of ['polygon', 'avalanche', 'base', 'arc']) {
      const fees = await sponsoredUserOpFees(quotingBundler(1, 1), publicClient, chain);
      expect(fees.maxFeePerGas, chain).toBeGreaterThanOrEqual(fees.maxPriorityFeePerGas);
    }
  });

  it('does not inflate fees on chains that have no special floor', async () => {
    // Arc and Base take the bundler at its word; only chains with a known mempool floor
    // get overridden, so this stays a targeted fix rather than a blanket fee increase.
    const fees = await sponsoredUserOpFees(quotingBundler(3, 6), publicClient, 'base');

    expect(fees.maxPriorityFeePerGas).toBe(3n * GWEI);
  });

  it('prices Avalanche above the bundler floor its public node under-reports', async () => {
    const fees = await sponsoredUserOpFees(quotingBundler(1, 2), publicClient, 'avalanche');

    expect(fees.maxPriorityFeePerGas).toBeGreaterThanOrEqual(3n * GWEI);
  });

  it('uses a Polygon floor matched to the active network family', async () => {
    const fees = await sponsoredUserOpFees(quotingBundler(1, 2), publicClient, 'polygon');

    // Amoy needs ~25 gwei; PoS mainnet's bundler quotes ~156. Paying the mainnet number
    // on a testnet only drains the paymaster, so the two are deliberately different.
    if (IS_TESTNET) {
      expect(fees.maxPriorityFeePerGas).toBeLessThan(100n * GWEI);
    } else {
      expect(fees.maxPriorityFeePerGas).toBeGreaterThan(100n * GWEI);
    }
  });
});
