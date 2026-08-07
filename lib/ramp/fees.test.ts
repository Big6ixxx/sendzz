import { describe, expect, it } from 'vitest';
import {
  applyFee,
  baseFromTotal,
  feeFromBase,
  feeFromTotal,
  PLATFORM_FEE_PERCENT,
  PROVIDER_FEES,
  totalFromBase,
} from './fees';

/**
 * The fee percentage is a pricing decision that has to land identically on every path —
 * deposits, withdrawals, both providers, the UI and the money math. These tests pin the two
 * properties that keep that true, so a future rate change can't half-apply the way `1.003`
 * once did: the conversions are exact inverses, and nothing carries its own copy of the rate.
 */
describe('fee arithmetic', () => {
  const rates = [0, 0.3, 0.5, 1, 2.75];

  it('totalFromBase and baseFromTotal are inverses', () => {
    for (const percent of rates) {
      for (const amount of [1, 10, 99.99, 100, 12345.678]) {
        expect(baseFromTotal(totalFromBase(amount, percent), percent)).toBeCloseTo(amount, 9);
        expect(totalFromBase(baseFromTotal(amount, percent), percent)).toBeCloseTo(amount, 9);
      }
    }
  });

  it('adds the fee ON TOP of the base (what withdrawals quote on)', () => {
    // The user's input is the base; the wallet gives up base + fee.
    expect(totalFromBase(100, 0.5)).toBeCloseTo(100.5, 9);
    expect(feeFromBase(100, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('backs the fee OUT of a fixed spend (Max button, Paycrest on-ramp)', () => {
    // Given a 100 USDC balance, the largest base whose base + fee still fits inside it.
    const base = baseFromTotal(100, 0.5);
    expect(base).toBeCloseTo(99.502488, 6);
    expect(totalFromBase(base, 0.5)).toBeCloseTo(100, 9); // lands exactly on the balance
    expect(base + feeFromTotal(100, 0.5)).toBeCloseTo(100, 9);
  });

  it('is a no-op at 0%', () => {
    expect(totalFromBase(100, 0)).toBe(100);
    expect(baseFromTotal(100, 0)).toBe(100);
    expect(feeFromBase(100, 0)).toBe(0);
  });

  it('applyFee agrees with the standalone helpers', () => {
    for (const provider of ['paycrest', 'bitnob'] as const) {
      const { percent } = PROVIDER_FEES[provider];
      const { base, fee, total } = applyFee(250, provider);
      expect(base).toBe(250);
      expect(fee).toBeCloseTo(feeFromBase(250, percent), 9);
      expect(total).toBeCloseTo(totalFromBase(250, percent), 9);
    }
  });

  it('every provider derives its rate from the single platform constant', () => {
    // No env override is set in test, so each provider must fall back to the one constant.
    // If someone adds a provider with a hardcoded percentage, this fails.
    for (const cfg of Object.values(PROVIDER_FEES)) {
      expect(cfg.percent).toBe(PLATFORM_FEE_PERCENT);
    }
  });
});
