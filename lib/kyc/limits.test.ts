import { describe, expect, it } from 'vitest';
import {
  KYC_LIMITS,
  UNVERIFIED_WITHDRAWAL_ALLOWANCE,
  exceedsUnverifiedAllowance,
  getBindingPeriod,
  remainingUnverifiedAllowance,
} from './limits';

/**
 * The promise is a one-off allowance: 100 USDC of withdrawals, spent however the user likes,
 * and then identity verification. These pin the shapes that are easy to get wrong — the
 * boundary, the many-small-withdrawals case, and the fact that it never replenishes.
 */
describe('exceedsUnverifiedAllowance', () => {
  it('allows a single withdrawal of exactly the allowance', () => {
    expect(exceedsUnverifiedAllowance(0, 100)).toBe(false);
  });

  it('refuses a first withdrawal larger than the allowance', () => {
    expect(exceedsUnverifiedAllowance(0, 100.01)).toBe(true);
    expect(exceedsUnverifiedAllowance(0, 400)).toBe(true);
  });

  it('lets five withdrawals of 20 through, and stops the sixth', () => {
    // The case the user described: 20 x 5 must work, and must land exactly on the allowance.
    let used = 0;
    for (let i = 0; i < 5; i++) {
      expect(exceedsUnverifiedAllowance(used, 20), `withdrawal ${i + 1}`).toBe(false);
      used += 20;
    }
    expect(used).toBe(UNVERIFIED_WITHDRAWAL_ALLOWANCE);
    expect(exceedsUnverifiedAllowance(used, 0.01)).toBe(true);
  });

  it('refuses the withdrawal that would overshoot, not the one that fits', () => {
    // 90 spent: 10 is still fine, 20 is not. The test is on the total, never the amount alone.
    expect(exceedsUnverifiedAllowance(90, 10)).toBe(false);
    expect(exceedsUnverifiedAllowance(90, 20)).toBe(true);
  });

  it('stays spent — there is no window that gives it back', () => {
    expect(exceedsUnverifiedAllowance(100, 1)).toBe(true);
  });
});

describe('remainingUnverifiedAllowance', () => {
  it('reports what is left', () => {
    expect(remainingUnverifiedAllowance(0)).toBe(100);
    expect(remainingUnverifiedAllowance(65)).toBe(35);
    expect(remainingUnverifiedAllowance(100)).toBe(0);
  });

  it('never reports a negative allowance', () => {
    // A user can end up past the cap — two withdrawals settling at once, or the figure being
    // lowered later. "You have -20 left" is not something to put in front of them.
    expect(remainingUnverifiedAllowance(120)).toBe(0);
  });
});

describe('rolling windows', () => {
  it('no longer bind an unverified user', () => {
    // The allowance is the only rule for them now. A window that still had a number would be a
    // second, contradictory limit nobody could reach anyway.
    expect(
      getBindingPeriod(50_000, { daily: 0, weekly: 0, monthly: 0 }, KYC_LIMITS.UNVERIFIED),
    ).toBeNull();
  });

  it('still never bind a verified user', () => {
    expect(
      getBindingPeriod(1_000_000, { daily: 0, weekly: 0, monthly: 0 }, KYC_LIMITS.VERIFIED),
    ).toBeNull();
  });
});
