import { afterEach, describe, expect, it } from 'vitest';
import { payoutSource } from './providers/bitnob';

/**
 * Which pot a Bitnob payout is funded from. This is not a preference — picking `onchain` on a
 * chain whose deposit address is shared produces a payout that can never settle, because Bitnob
 * cannot attribute the arriving deposit to it. That combination stranded a real withdrawal.
 *
 * Note this flag no longer decides whether our float caps a withdrawal. `initialize` now waits
 * for the deposit on every chain, which is what actually removes the float from the path.
 */
const ORIGINAL = process.env.BITNOB_PAYOUT_SOURCE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BITNOB_PAYOUT_SOURCE;
  else process.env.BITNOB_PAYOUT_SOURCE = ORIGINAL;
});

describe('payoutSource', () => {
  it('puts every chain on the funding model it is actually running', () => {
    // While initialize is deferred, the deposit credits our pooled balance and the payout
    // debits it. That is offchain, whatever the env var says, and claiming otherwise asks
    // Bitnob to fund from a payout address that did not exist when the money was sent.
    delete process.env.BITNOB_PAYOUT_SOURCE;
    for (const chain of ['base', 'polygon', 'ethereum', 'arbitrum', 'optimism', 'stellar']) {
      expect(payoutSource(chain), chain).toBe('offchain');
    }
  });

  it('never puts Stellar on-chain — its shared address cannot attribute a deposit', () => {
    delete process.env.BITNOB_PAYOUT_SOURCE;
    expect(payoutSource('stellar')).toBe('offchain');
  });

  it('holds Stellar off-chain even when the env explicitly asks for onchain', () => {
    process.env.BITNOB_PAYOUT_SOURCE = 'onchain';
    expect(payoutSource('stellar')).toBe('offchain');
  });

  it('ignores an onchain override on EVM too, while initialize is deferred', () => {
    // The env var is the revert lever for the funding model. It cannot select a model that
    // contradicts when we attach the beneficiary.
    process.env.BITNOB_PAYOUT_SOURCE = 'onchain';
    expect(payoutSource('base')).toBe('offchain');
  });

  it('still honours a global revert to float funding', () => {
    process.env.BITNOB_PAYOUT_SOURCE = 'offchain';
    expect(payoutSource('base')).toBe('offchain');
  });
});
