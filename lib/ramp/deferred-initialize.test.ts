import { describe, expect, it } from 'vitest';
import { defersInitialize, payoutSource } from './providers/bitnob';

/**
 * When the beneficiary is attached, and which pot funds the payout.
 *
 * Bitnob's flow is quote → initialize → pay: `initialize` returns a payment address bound to
 * that payout, and the user funds it. Doing it in that order means a bad beneficiary is refused
 * BEFORE the user signs, which costs nothing. Deferring inverts it, so the same refusal lands
 * after their USDC has gone and owes a refund.
 *
 * Both of these were briefly changed together to work around a 422 INSUFFICIENT_FUNDS. The 422
 * was `source: "offchain"` asking Bitnob to fund from our balance — verified live: a 250 USDC
 * payout against a 67.79 float returns 422 on `offchain` and 200 with a payment address on
 * `onchain`. Thirteen days of the correct order produced 1 stranded withdrawal; two days of
 * the inverted one produced 9, worth 221 USDC.
 */
describe('defersInitialize', () => {
  it('waits only on Stellar, whose shared address cannot bind a deposit to a payout', () => {
    expect(defersInitialize('stellar')).toBe(true);
  });

  it('does NOT wait on per-payout-address chains', () => {
    // The regression this guards: making every chain defer moves each failure from before the
    // signature to after the deposit, turning a free error into a refund.
    for (const chain of ['base', 'polygon', 'arbitrum', 'optimism', 'avalanche']) {
      expect(defersInitialize(chain), chain).toBe(false);
    }
  });
});

describe('payoutSource', () => {
  it('funds per-payout-address chains from the user deposit, not our float', () => {
    delete process.env.BITNOB_PAYOUT_SOURCE;
    for (const chain of ['base', 'polygon', 'arbitrum', 'optimism']) {
      expect(payoutSource(chain), chain).toBe('onchain');
    }
  });

  it('holds Stellar off-chain — a shared address cannot fund a payout directly', () => {
    delete process.env.BITNOB_PAYOUT_SOURCE;
    expect(payoutSource('stellar')).toBe('offchain');
  });

  it('still honours a deliberate global revert to float funding', () => {
    process.env.BITNOB_PAYOUT_SOURCE = 'offchain';
    expect(payoutSource('base')).toBe('offchain');
    delete process.env.BITNOB_PAYOUT_SOURCE;
  });
});
