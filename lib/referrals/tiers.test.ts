import { afterEach, describe, expect, it } from 'vitest';
import {
  computeCommission,
  maxNetSharePercent,
  minimumWithdrawalUsdc,
  referenceFeePercent,
  tierForVolume,
  tierVolumeRatePercent,
} from './tiers';

/**
 * These pin the commercial promise, which is the thing that costs money when it slips.
 *
 * The promise: a referrer earns a FIXED PERCENTAGE OF VOLUME, and that percentage does not
 * move when a corridor is repriced. Gold is 0.25% whether the corridor charges 0.5% or 1% —
 * half the fee in the first case, a quarter in the second.
 */

const set = (k: string, v: string | undefined) => {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

afterEach(() => {
  for (const k of [
    'REFERRAL_REFERENCE_FEE_PERCENT',
    'REFERRAL_MAX_NET_SHARE_PERCENT',
    'REFERRAL_MIN_WITHDRAWAL_USDC',
    'REFERRAL_TIER_GOLD_FEE_SHARE',
    'REFERRAL_TIER_GOLD_MIN_VOLUME',
  ]) {
    set(k, undefined);
  }
});

describe('tier rates', () => {
  it('translates the quoted fee shares into the documented volume rates', () => {
    // 20 / 35 / 50 percent of a 0.5% reference corridor.
    expect(tierVolumeRatePercent('bronze')).toBeCloseTo(0.1, 9);
    expect(tierVolumeRatePercent('silver')).toBeCloseTo(0.175, 9);
    expect(tierVolumeRatePercent('gold')).toBeCloseTo(0.25, 9);
  });

  it('moves every rate together when the reference corridor moves', () => {
    // The reference is a variable precisely so this is a decision somebody makes, rather
    // than a constant that silently stops matching the corridor it was derived from.
    set('REFERRAL_REFERENCE_FEE_PERCENT', '1');
    expect(tierVolumeRatePercent('gold')).toBeCloseTo(0.5, 9);
  });

  it('picks the highest tier the volume qualifies for', () => {
    expect(tierForVolume(0)).toBe('bronze');
    expect(tierForVolume(4_999)).toBe('bronze');
    expect(tierForVolume(5_000)).toBe('silver');
    expect(tierForVolume(24_999)).toBe('silver');
    expect(tierForVolume(25_000)).toBe('gold');
    expect(tierForVolume(1_000_000)).toBe('gold');
  });

  it('reads the commercial numbers from the environment', () => {
    set('REFERRAL_TIER_GOLD_FEE_SHARE', '60');
    expect(tierVolumeRatePercent('gold')).toBeCloseTo(0.3, 9);
    set('REFERRAL_TIER_GOLD_MIN_VOLUME', '10000');
    expect(tierForVolume(10_000)).toBe('gold');
  });

  it('has sane defaults when nothing is configured', () => {
    expect(referenceFeePercent()).toBe(0.5);
    expect(maxNetSharePercent()).toBe(90);
    expect(minimumWithdrawalUsdc()).toBe(50);
  });
});

describe('computeCommission', () => {
  /** A withdrawal with no third-party cost, priced at the standard corridor. */
  const standard = (volume: number, feePercent = 0.5) => ({
    tier: 'gold' as const,
    volumeUsdc: volume,
    grossFeeUsdc: volume * (feePercent / 100),
    corridorCostUsdc: 0,
  });

  it('pays the volume rate regardless of what the corridor charges', () => {
    // The whole promise, in one test. Same volume, two corridors, same payout.
    const cheap = computeCommission(standard(1_000, 0.5));
    const pricey = computeCommission(standard(1_000, 1));

    expect(cheap.amountUsdc).toBeCloseTo(2.5, 6);
    expect(pricey.amountUsdc).toBeCloseTo(2.5, 6);

    // Which is half the fee on one and a quarter on the other.
    expect(cheap.amountUsdc / cheap.grossFeeUsdc).toBeCloseTo(0.5, 6);
    expect(pricey.amountUsdc / pricey.grossFeeUsdc).toBeCloseTo(0.25, 6);
  });

  it('leaves the cap dormant on a healthy withdrawal', () => {
    const result = computeCommission({
      tier: 'gold',
      volumeUsdc: 500,
      grossFeeUsdc: 2.5,
      corridorCostUsdc: 0.2,
    });
    expect(result.amountUsdc).toBeCloseTo(1.25, 6);
    expect(result.capped).toBe(false);
  });

  it('caps a commission that would exceed what the withdrawal actually netted', () => {
    // $50 at 0.5% is $0.25, less a $0.20 corridor cost leaves $0.05 of margin. The volume
    // rate alone would pay $0.125 — two and a half times everything we made.
    const result = computeCommission({
      tier: 'gold',
      volumeUsdc: 50,
      grossFeeUsdc: 0.25,
      corridorCostUsdc: 0.2,
    });

    expect(result.uncappedUsdc).toBeCloseTo(0.125, 6);
    expect(result.amountUsdc).toBeCloseTo(0.045, 6); // 90% of $0.05
    expect(result.capped).toBe(true);
    // The point of the cap: we still keep something.
    expect(result.netFeeUsdc - result.amountUsdc).toBeGreaterThan(0);
  });

  it('never pays out of a withdrawal that lost money', () => {
    // A corridor cost larger than the fee. Without the clamp this would produce a negative
    // cap and, multiplied through, a nonsense figure.
    const result = computeCommission({
      tier: 'gold',
      volumeUsdc: 50,
      grossFeeUsdc: 0.25,
      corridorCostUsdc: 0.4,
    });
    expect(result.netFeeUsdc).toBeLessThan(0);
    expect(result.amountUsdc).toBe(0);
  });

  it('shows its working, so a payout can be explained later', () => {
    // Recomputing from config months later would answer with today's rates, not the ones
    // that applied. Every figure the explanation needs is on the result.
    const result = computeCommission(standard(1_000));
    expect(result).toMatchObject({
      tier: 'gold',
      volumeUsdc: 1_000,
      grossFeeUsdc: 5,
      corridorCostUsdc: 0,
      netFeeUsdc: 5,
      capped: false,
    });
    expect(result.tierRatePercent).toBeCloseTo(0.25, 9);
    expect(result.uncappedUsdc).toBeCloseTo(2.5, 6);
  });

  it('scales with the tier', () => {
    const volume = 10_000;
    const fee = volume * 0.005;
    const at = (tier: 'bronze' | 'silver' | 'gold') =>
      computeCommission({ tier, volumeUsdc: volume, grossFeeUsdc: fee, corridorCostUsdc: 0 })
        .amountUsdc;

    expect(at('bronze')).toBeCloseTo(10, 6); // 0.10%
    expect(at('silver')).toBeCloseTo(17.5, 6); // 0.175%
    expect(at('gold')).toBeCloseTo(25, 6); // 0.25%
  });
});
