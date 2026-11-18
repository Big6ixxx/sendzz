import { describe, expect, it, vi } from 'vitest';
import { ceilUsdc, solveForFiatTarget, type QuoteFn } from './fiat-target';
import type { RampPayoutQuote } from './types';

/**
 * A typed fiat target is a floor, not a suggestion. Someone entering 5,000 NGN is paying an
 * invoice; 4,987 is a failed payment. These pin that the solver never lands under the target,
 * and lands as close above it as the provider's pricing allows.
 */

/** A provider whose payout is exactly `rate × usdc` — the linear case. */
const atRate = (rate: number): QuoteFn =>
  async (amountUsdc) => ({
    provider: 'bitnob',
    rate,
    payoutAmount: amountUsdc * rate,
    binding: true,
  });

describe('ceilUsdc', () => {
  it('rounds up at 6dp so rounding only ever favours the recipient', () => {
    expect(ceilUsdc(1.0000001)).toBe(1.000001);
    expect(ceilUsdc(3.6231884)).toBe(3.623189);
  });

  it('leaves an exact 6dp value alone', () => {
    expect(ceilUsdc(3.623188)).toBe(3.623188);
  });
});

describe('solveForFiatTarget', () => {
  it('hits the target when the seed rate is already the real rate', async () => {
    const res = await solveForFiatTarget(5000, 1380, atRate(1380));
    expect(res?.meetsTarget).toBe(true);
    expect(res!.quote.payoutAmount).toBeGreaterThanOrEqual(5000);
  });

  it('recovers when the seed rate is optimistic — the bug users actually hit', async () => {
    // Display rate 1382.45, real payout rate 1379.95. Dividing by the seed alone pays out
    // ~4,990 on a 5,000 request; the solver must correct to the real rate.
    const res = await solveForFiatTarget(5000, 1382.45, atRate(1379.95));
    expect(res?.meetsTarget).toBe(true);
    expect(res!.quote.payoutAmount).toBeGreaterThanOrEqual(5000);
  });

  it('overshoots only by a rounding sliver, never a whole unit', async () => {
    const res = await solveForFiatTarget(5000, 1382.45, atRate(1379.95));
    // "5000.something", not 5001 — the entire point of solving rather than padding.
    expect(res!.quote.payoutAmount).toBeLessThan(5001);
  });

  it('needs only two quotes for a stable rate', async () => {
    const fn = vi.fn(atRate(1379.95));
    await solveForFiatTarget(5000, 1382.45, fn);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('stops at one quote when the seed is the real rate', async () => {
    const fn = vi.fn(atRate(1400));
    const res = await solveForFiatTarget(5000, 1400, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(res?.meetsTarget).toBe(true);
  });

  it('comes back down when a pessimistic seed overshoots, rather than overpaying', async () => {
    // Seeded at another provider's worse rate: 15,000 at 1396.58 asks for 10.7405 USDC, which
    // pays 15,016.64 at the real 1398.198. Users paid that extra on every naira withdrawal.
    const res = await solveForFiatTarget(15000, 1396.581, atRate(1398.198));
    expect(res?.meetsTarget).toBe(true);
    expect(res!.amountUsdc).toBe(ceilUsdc(15000 / 1398.198));
    expect(res!.quote.payoutAmount).toBeLessThan(15000.01);
  });

  it('keeps the amount that met the target when stepping down comes up short', async () => {
    // Pays a little less per USDC on smaller amounts: the step down falls short, so it goes back.
    const banded: QuoteFn = async (amountUsdc) => ({
      provider: 'bitnob', rate: 0, binding: true,
      payoutAmount: amountUsdc * (amountUsdc >= 3.6 ? 1400 : 1390),
    });
    const res = await solveForFiatTarget(5000, 1380, banded);
    expect(res?.meetsTarget).toBe(true);
    expect(res!.quote.payoutAmount).toBeGreaterThanOrEqual(5000);
  });

  it('still converges when the rate keeps drifting against us', async () => {
    let rate = 1380;
    const drifting: QuoteFn = async (amountUsdc) => {
      rate -= 1; // worse on every attempt
      return {
        provider: 'bitnob',
        rate,
        payoutAmount: amountUsdc * rate,
        binding: true,
      } as RampPayoutQuote;
    };
    const res = await solveForFiatTarget(5000, 1380, drifting, 3);
    // It may not reach the target against a rate that moves every call, but it must report that
    // honestly rather than claim success.
    expect(res).not.toBeNull();
    expect(res!.meetsTarget).toBe(res!.quote.payoutAmount + 1e-9 >= 5000);
  });

  it('returns null rather than guessing when the provider will not quote', async () => {
    expect(await solveForFiatTarget(5000, 1380, async () => null)).toBeNull();
  });

  it('rejects nonsense inputs instead of dividing by zero', async () => {
    const fn = vi.fn(atRate(1380));
    expect(await solveForFiatTarget(0, 1380, fn)).toBeNull();
    expect(await solveForFiatTarget(5000, 0, fn)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('never repeats the same amount forever when the gap is sub-cent', async () => {
    const seen: number[] = [];
    const fn: QuoteFn = async (amountUsdc) => {
      seen.push(amountUsdc);
      // Pays a hair under the target no matter what, forcing the epsilon step.
      return { provider: 'bitnob', rate: 1380, payoutAmount: 4999.9999, binding: true };
    };
    await solveForFiatTarget(5000, 1380, fn, 3);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
