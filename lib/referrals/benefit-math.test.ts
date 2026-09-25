import { describe, expect, it } from 'vitest';
import { applyBenefits, maxWithdrawableBase } from './benefit-math';
import { maxBaseFromBalance } from '@/lib/ramp/fees';

/**
 * This decides what a user is charged and how much they are allowed to withdraw. Both are
 * numbers somebody looks at before pressing a button, so both have to be exactly right —
 * quoting one fee and deducting another is the failure the whole shared-arithmetic
 * arrangement exists to prevent.
 */

const none = { waiverVolumeUsdc: 0, feeCreditUsdc: 0 };

describe('applyBenefits', () => {
  it('charges the standard fee when there is nothing to apply', () => {
    const result = applyBenefits({ volumeUsdc: 1_000, feePercent: 0.5, balances: none });
    expect(result.feeUsdc).toBeCloseTo(5, 6);
    expect(result.standardFeeUsdc).toBeCloseTo(5, 6);
    expect(result.waivedVolumeUsdc).toBe(0);
    expect(result.creditAppliedUsdc).toBe(0);
  });

  it('is free while the withdrawal fits inside the allowance', () => {
    const result = applyBenefits({
      volumeUsdc: 150,
      feePercent: 0.5,
      balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 0 },
    });
    expect(result.feeUsdc).toBe(0);
    expect(result.waivedVolumeUsdc).toBeCloseTo(150, 6);
    // Still reports what it would have cost, so the screen can show the saving.
    expect(result.standardFeeUsdc).toBeCloseTo(0.75, 6);
  });

  it('charges only the part beyond the allowance', () => {
    // $250 with $200 free: the fee applies to $50.
    const result = applyBenefits({
      volumeUsdc: 250,
      feePercent: 0.5,
      balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 0 },
    });
    expect(result.waivedVolumeUsdc).toBeCloseTo(200, 6);
    expect(result.feeUsdc).toBeCloseTo(0.25, 6);
  });

  it('spends the allowance before the credit', () => {
    // Order matters: the allowance is in VOLUME and the credit is cash-equivalent. Spending
    // the credit first would burn it on a fee the allowance was about to remove for nothing.
    const result = applyBenefits({
      volumeUsdc: 150,
      feePercent: 0.5,
      balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 2 },
    });
    expect(result.waivedVolumeUsdc).toBeCloseTo(150, 6);
    expect(result.creditAppliedUsdc).toBe(0); // untouched
    expect(result.feeUsdc).toBe(0);
  });

  it('applies the credit to whatever the allowance did not cover', () => {
    const result = applyBenefits({
      volumeUsdc: 1_000,
      feePercent: 0.5,
      balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 2 },
    });
    // Fee on the remaining $800 is $4.00; $2.00 of credit leaves $2.00 to pay.
    expect(result.creditAppliedUsdc).toBeCloseTo(2, 6);
    expect(result.feeUsdc).toBeCloseTo(2, 6);
  });

  it('never returns a negative fee, however large the credit', () => {
    const result = applyBenefits({
      volumeUsdc: 100,
      feePercent: 0.5,
      balances: { waiverVolumeUsdc: 0, feeCreditUsdc: 50 },
    });
    expect(result.feeUsdc).toBe(0);
    // And only spends what was needed — the rest stays on the balance.
    expect(result.creditAppliedUsdc).toBeCloseTo(0.5, 6);
  });

  it('ignores a negative balance rather than charging extra for it', () => {
    const result = applyBenefits({
      volumeUsdc: 100,
      feePercent: 0.5,
      balances: { waiverVolumeUsdc: -50, feeCreditUsdc: -1 },
    });
    expect(result.feeUsdc).toBeCloseTo(0.5, 6);
  });
});

describe('maxWithdrawableBase', () => {
  it('agrees with the plain inverse when there are no benefits', () => {
    // Same answer as lib/ramp/fees, which is what makes it safe to swap one for the other —
    // except never larger, because this one rounds down on purpose. See floorToMicro.
    for (const available of [10, 100, 1_000, 12_345.67]) {
      for (const corridor of [0, 0.2]) {
        const mine = maxWithdrawableBase({
          availableUsdc: available,
          feePercent: 0.5,
          corridorFeeUsdc: corridor,
          balances: none,
        });
        const plain = maxBaseFromBalance(available, 0.5, corridor);

        expect(mine).toBeLessThanOrEqual(plain);
        expect(mine).toBeCloseTo(plain, 5);
      }
    }
  });

  it('lets the whole balance out when it fits inside the allowance', () => {
    // No fee at all, so nothing needs holding back for one.
    expect(
      maxWithdrawableBase({
        availableUsdc: 150,
        feePercent: 0.5,
        corridorFeeUsdc: 0,
        balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 0 },
      }),
    ).toBeCloseTo(150, 6);
  });

  it('raises the ceiling rather than lowering it', () => {
    // The bug this guards: a MAX that ignores the allowance offers a referee LESS than they
    // can actually withdraw — understating it for exactly the people it was created for.
    const withAllowance = maxWithdrawableBase({
      availableUsdc: 1_000,
      feePercent: 0.5,
      corridorFeeUsdc: 0,
      balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 0 },
    });
    const without = maxWithdrawableBase({
      availableUsdc: 1_000,
      feePercent: 0.5,
      corridorFeeUsdc: 0,
      balances: none,
    });
    expect(withAllowance).toBeGreaterThan(without);
  });

  it('produces an amount whose full deduction fits the balance exactly', () => {
    // The property that matters: MAX must be spendable. Anything larger fails at the
    // pre-transfer check, after a quote already exists.
    const cases = [
      { available: 1_000, balances: none },
      { available: 1_000, balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 0 } },
      { available: 1_000, balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 2 } },
      { available: 150, balances: { waiverVolumeUsdc: 200, feeCreditUsdc: 0 } },
      { available: 500, balances: { waiverVolumeUsdc: 0, feeCreditUsdc: 10 } },
    ];

    for (const { available, balances } of cases) {
      const corridor = 0.2;
      const base = maxWithdrawableBase({
        availableUsdc: available,
        feePercent: 0.5,
        corridorFeeUsdc: corridor,
        balances,
      });
      const { feeUsdc } = applyBenefits({ volumeUsdc: base, feePercent: 0.5, balances });
      // Never over: an amount MAX filled in must be one the pre-transfer check accepts.
      expect(base + feeUsdc + corridor).toBeLessThanOrEqual(available);
      // And not meaningfully short — the deliberate round-down costs a millionth of a dollar.
      expect(base + feeUsdc + corridor).toBeGreaterThan(available - 1e-4);
    }
  });

  it('is zero when the balance cannot even cover the corridor cost', () => {
    expect(
      maxWithdrawableBase({
        availableUsdc: 0.1,
        feePercent: 0.5,
        corridorFeeUsdc: 0.2,
        balances: none,
      }),
    ).toBe(0);
  });

  it('handles a zero fee rate without dividing by it', () => {
    expect(
      maxWithdrawableBase({
        availableUsdc: 100,
        feePercent: 0,
        corridorFeeUsdc: 0,
        balances: { waiverVolumeUsdc: 0, feeCreditUsdc: 5 },
      }),
    ).toBeCloseTo(100, 6);
  });
});
