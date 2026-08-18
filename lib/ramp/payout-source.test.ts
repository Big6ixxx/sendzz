import { afterEach, describe, expect, it } from 'vitest';
import { payoutSource } from './providers/bitnob';

/**
 * Which pot a Bitnob payout is funded from. This is not a preference — picking `onchain` on a
 * chain whose deposit address is shared produces a payout that can never settle, because Bitnob
 * cannot attribute the arriving deposit to it. That combination stranded a real withdrawal.
 */
const ORIGINAL = process.env.BITNOB_PAYOUT_SOURCE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BITNOB_PAYOUT_SOURCE;
  else process.env.BITNOB_PAYOUT_SOURCE = ORIGINAL;
});

describe('payoutSource', () => {
  it('funds per-payout-address chains from the user deposit, so float never caps a withdrawal', () => {
    delete process.env.BITNOB_PAYOUT_SOURCE;
    for (const chain of ['base', 'polygon', 'ethereum', 'arbitrum', 'optimism']) {
      expect(payoutSource(chain)).toBe('onchain');
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

  it('still honours a global revert to float funding', () => {
    process.env.BITNOB_PAYOUT_SOURCE = 'offchain';
    expect(payoutSource('base')).toBe('offchain');
  });
});
