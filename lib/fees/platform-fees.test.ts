import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePlatformFee } from './platform-fees';

/**
 * The rule that keeps one withdrawal from being priced differently on different chains.
 * Stellar used to derive its own fee here, so a withdrawal quoted at BITNOB_FEE_PERCENT was
 * billed at TRANSFER_FEE_PERCENT — a smaller number, against a larger base.
 */
describe('resolvePlatformFee', () => {
  beforeEach(() => {
    process.env.TRANSFER_FEE_PERCENT = '0.3';
  });
  afterEach(() => {
    delete process.env.TRANSFER_FEE_PERCENT;
  });

  it('uses the supplied fee over the configured percentage', () => {
    // Order priced at 0.5% of 100; the transfer rate would have charged 0.30.
    expect(resolvePlatformFee(100, 'transfer', '0.5')).toBe(0.5);
  });

  it('accepts a supplied fee as a number', () => {
    expect(resolvePlatformFee(100, 'transfer', 0.5)).toBe(0.5);
  });

  it('honours a supplied zero rather than falling back', () => {
    // A provider-collected fee is 0 on our side — charging the transfer rate would double-bill.
    expect(resolvePlatformFee(100, 'transfer', '0')).toBe(0);
  });

  it('falls back to the percentage when no fee is supplied', () => {
    expect(resolvePlatformFee(100, 'transfer')).toBeCloseTo(0.3, 9);
    expect(resolvePlatformFee(100, 'transfer', null)).toBeCloseTo(0.3, 9);
    expect(resolvePlatformFee(100, 'transfer', '')).toBeCloseTo(0.3, 9);
  });

  it('falls back on a malformed or negative supplied fee', () => {
    expect(resolvePlatformFee(100, 'transfer', 'abc')).toBeCloseTo(0.3, 9);
    expect(resolvePlatformFee(100, 'transfer', -1)).toBeCloseTo(0.3, 9);
  });

  it('does not scale a supplied fee with the amount', () => {
    // The order already priced it; the settlement amount includes the corridor fee and must
    // not re-inflate what we charge.
    expect(resolvePlatformFee(10, 'transfer', '0.5')).toBe(0.5);
    expect(resolvePlatformFee(10_000, 'transfer', '0.5')).toBe(0.5);
  });
});
