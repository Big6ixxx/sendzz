import { describe, expect, it } from 'vitest';
import {
  FIAT_ROUTING_PAD,
  maxBaseFromBalance,
  totalDeducted,
  totalFromBase,
} from './fees';

/**
 * "Withdraw everything" has to actually mean everything.
 *
 * A user tapped MAX, got through bank details and 2FA, and only then hit "Not enough balance
 * to complete this withdrawal" — on the confirm screen, after a quote had already been struck.
 * The max inverted the platform fee but not the corridor fee, so the figure it produced always
 * cost more than the balance it came from. The shortfall stayed invisible until the
 * pre-transfer check, the first place all three outflows are summed against the wallet.
 *
 * The invariant is simply: whatever MAX puts in the box must survive that check.
 */
const fits = (base: number, balance: number, percent: number, corridorFee: number) =>
  totalFromBase(base, percent) + corridorFee <= balance + 1e-9;

describe('maxBaseFromBalance', () => {
  it('produces a base whose full deduction fits the balance', () => {
    for (const percent of [0, 0.3, 0.5, 1.5]) {
      for (const corridorFee of [0, 0.21, 1.5]) {
        for (const balance of [10.952407, 100, 3.7, 5000.123456]) {
          const base = maxBaseFromBalance(balance, percent, corridorFee);
          expect(fits(base, balance, percent, corridorFee), `${balance}/${percent}/${corridorFee}`).toBe(true);
        }
      }
    }
  });

  it('leaves nothing behind — it spends the balance to the last cent', () => {
    const base = maxBaseFromBalance(100, 0.5, 0.21);
    expect(totalFromBase(base, 0.5) + 0.21).toBeCloseTo(100, 9);
  });

  it('accounts for the corridor fee, not just the platform fee', () => {
    // The actual regression: with a corridor fee set, ignoring it overstates the max.
    const withFee = maxBaseFromBalance(100, 0.5, 1.5);
    const ignoringIt = maxBaseFromBalance(100, 0.5, 0);
    expect(withFee).toBeLessThan(ignoringIt);
    expect(fits(ignoringIt, 100, 0.5, 1.5)).toBe(false);
  });

  it('survives rounding the displayed value DOWN to 2dp', () => {
    // The UI shows 2dp. Rounding half-up could push it back over; flooring cannot.
    const balance = 10.957;
    const floored = Math.floor(maxBaseFromBalance(balance, 0.5, 0) * 100) / 100;
    expect(fits(floored, balance, 0.5, 0)).toBe(true);
  });

  it('still fits once the fiat path pads the estimate', () => {
    // Fiat mode converts the typed target back to USDC and pads it before routing, so the fiat
    // max must leave that headroom — otherwise MAX in fiat is over by ~1% every time.
    const balance = 100;
    const base = maxBaseFromBalance(balance, 0.5, 0) / FIAT_ROUTING_PAD;
    expect(fits(base * FIAT_ROUTING_PAD, balance, 0.5, 0)).toBe(true);
  });

  it('returns 0 rather than a negative when the fee exceeds the balance', () => {
    expect(maxBaseFromBalance(0.1, 0.5, 1.5)).toBe(0);
    expect(maxBaseFromBalance(0, 0.5, 0)).toBe(0);
    expect(maxBaseFromBalance(-5, 0.5, 0)).toBe(0);
  });
});

/**
 * `totalDeducted` and `maxBaseFromBalance` are inverses. They were six inlined copies of one
 * expression across the hook and the form; if they ever disagree, the amount the UI shows as
 * deducted stops matching the amount the balance is checked against — which is precisely the
 * gap that let MAX through step 1 and failed it on step 3.
 */
describe('totalDeducted', () => {
  it('is the exact inverse of maxBaseFromBalance', () => {
    for (const percent of [0, 0.3, 0.5, 1.5]) {
      for (const corridorFee of [0, 0.21, 1.5]) {
        const balance = 250.75;
        const base = maxBaseFromBalance(balance, percent, corridorFee);
        expect(totalDeducted(base, percent, corridorFee)).toBeCloseTo(balance, 9);
      }
    }
  });

  it('adds the corridor fee on top of base + platform fee', () => {
    expect(totalDeducted(100, 0.5, 0.21)).toBeCloseTo(100.71, 9);
    expect(totalDeducted(100, 0.5)).toBeCloseTo(100.5, 9);
  });
});
