import { describe, expect, it } from 'vitest';
import { formatFeeSummary, formatUsdc, usdcDecimalsFor } from './format-usdc';

describe('fee summary formatting', () => {
  /** The reported case: 0.03 USDC at 0.01%, which rendered as 0.03 / 0.00 / 0.03. */
  it('makes a tiny fee and its total legible', () => {
    const amount = 0.03;
    const fee = (amount * 0.01) / 100;
    const s = formatFeeSummary(amount, fee, amount + fee);

    expect(s.fee).not.toBe('0.00');       // fee is visible
    expect(s.total).not.toBe(s.amount);   // total is visibly larger
    expect(Number(s.total)).toBeGreaterThan(Number(s.amount));
  });

  it('stays at two decimals when that is honest', () => {
    const s = formatFeeSummary(100, 0.5, 100.5);
    expect(s).toEqual({ amount: '100.00', fee: '0.50', total: '100.50' });
  });

  it('all three share one precision, so the sum reads correctly', () => {
    const s = formatFeeSummary(0.03, 0.000003, 0.030003);
    const dp = (x: string) => x.split('.')[1]?.length ?? 0;
    expect(dp(s.amount)).toBe(dp(s.fee));
    expect(dp(s.fee)).toBe(dp(s.total));
    expect(Number(s.amount) + Number(s.fee)).toBeCloseTo(Number(s.total), 9);
  });

  it('picks the coarsest precision that still separates the values', () => {
    expect(usdcDecimalsFor([100, 0.5, 100.5])).toBe(2);
    expect(usdcDecimalsFor([0.03, 0.000003, 0.030003])).toBe(6);
  });

  it('never renders a non-zero amount as zero', () => {
    expect(formatUsdc(0.0000001, 2)).toBe('< 0.000001');
    expect(formatUsdc(0, 2)).toBe('0.00');
  });

  it('handles bad input without throwing', () => {
    expect(formatUsdc(NaN)).toBe('0.00');
    expect(formatUsdc(Infinity)).toBe('0.00');
  });
});
