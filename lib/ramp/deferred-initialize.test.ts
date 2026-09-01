import { describe, expect, it } from 'vitest';
import { defersInitialize, payoutSource } from './providers/bitnob';

/**
 * When the beneficiary gets attached, which is what decides whether our float caps a withdrawal.
 *
 * Bitnob validates a payout against our USDC account at `initialize`. Attaching a beneficiary
 * before the user's deposit has landed therefore measures every withdrawal against whatever we
 * happen to be holding. A 67.41 payout on Base was refused against a 63.86 balance, and the same
 * user then pushed the same total through as 34.82 + 32.59 — which only works if a shared pot is
 * being checked, not the user's own deposit.
 */
describe('defersInitialize', () => {
  it('waits for the deposit on every chain, not just shared-address ones', () => {
    // The regression this guards: reverting to `hasSharedDepositAddress` would silently put
    // Base, Polygon and Arbitrum back behind our float.
    expect(defersInitialize()).toBe(true);
  });
});

describe('payoutSource alongside it', () => {
  it('still refuses to put Stellar on-chain, which is a separate rule', () => {
    // Deferring is about WHEN. This is about WHICH POT, and a shared address cannot attribute
    // a deposit to a payout at all — so Stellar must stay offchain regardless.
    expect(payoutSource('stellar')).toBe('offchain');
  });
});
