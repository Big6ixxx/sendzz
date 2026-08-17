import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFee,
  baseFromTotal,
  feeFromBase,
  getCorridorFee,
  getProviderFee,
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
  });

  it('is a no-op at 0%', () => {
    expect(totalFromBase(100, 0)).toBe(100);
    expect(baseFromTotal(100, 0)).toBe(100);
    expect(feeFromBase(100, 0)).toBe(0);
  });

  it('applyFee agrees with the standalone helpers', () => {
    // Set explicitly: the suite doesn't load .env, and there is no compiled-in rate to fall
    // back on — getProviderFee throws when unconfigured, which is the point.
    process.env.PAYCREST_FEE_PERCENT = '0.5';
    process.env.BITNOB_FEE_PERCENT = '0.5';
    for (const provider of ['paycrest', 'bitnob'] as const) {
      const { percent } = getProviderFee(provider);
      const { base, fee, total } = applyFee(250, provider);
      expect(base).toBe(250);
      expect(fee).toBeCloseTo(feeFromBase(250, percent), 9);
      expect(total).toBeCloseTo(totalFromBase(250, percent), 9);
    }
  });

  /**
   * The rate must come from env and nowhere else. A compiled-in fallback is what previously
   * let the server charge one number while the UI displayed another.
   */
  it('reads each provider rate from its environment variable', () => {
    const prev = { p: process.env.PAYCREST_FEE_PERCENT, b: process.env.BITNOB_FEE_PERCENT };
    try {
      process.env.PAYCREST_FEE_PERCENT = '1.25';
      process.env.BITNOB_FEE_PERCENT = '0.75';
      expect(getProviderFee('paycrest').percent).toBe(1.25);
      expect(getProviderFee('bitnob').percent).toBe(0.75);
    } finally {
      process.env.PAYCREST_FEE_PERCENT = prev.p;
      process.env.BITNOB_FEE_PERCENT = prev.b;
    }
  });

  it('throws rather than assuming a rate when the variable is missing or invalid', () => {
    const prev = process.env.PAYCREST_FEE_PERCENT;
    try {
      for (const bad of [undefined, '', 'abc', '-1', '101']) {
        if (bad === undefined) delete process.env.PAYCREST_FEE_PERCENT;
        else process.env.PAYCREST_FEE_PERCENT = bad;
        expect(() => getProviderFee('paycrest')).toThrow(/PAYCREST_FEE_PERCENT/);
      }
    } finally {
      process.env.PAYCREST_FEE_PERCENT = prev;
    }
  });

  it('picks up a change without a reload — the value is read per call', () => {
    const prev = process.env.BITNOB_FEE_PERCENT;
    try {
      process.env.BITNOB_FEE_PERCENT = '0.5';
      expect(getProviderFee('bitnob').percent).toBe(0.5);
      process.env.BITNOB_FEE_PERCENT = '0.9';
      expect(getProviderFee('bitnob').percent).toBe(0.9);
    } finally {
      process.env.BITNOB_FEE_PERCENT = prev;
    }
  });
});

/**
 * Corridor fees are configured by us because Bitnob does not report them: `fees` came back "0"
 * on both the quote and the initialize response for NGN, KES, RWF and GHS, yet RWF mobile-money
 * payouts debited 0.30 USDC more than the user had deposited — three times, out of our float.
 */
describe('getCorridorFee', () => {
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  afterEach(() => {
    set('BITNOB_CORRIDOR_FEE_RWF', undefined);
    set('BITNOB_CORRIDOR_FEE_NGN', undefined);
  });

  it('reads the configured amount for the currency', () => {
    set('BITNOB_CORRIDOR_FEE_RWF', '0.3');
    expect(getCorridorFee('bitnob', 'RWF')).toBe(0.3);
  });

  it('is case-insensitive on the currency', () => {
    set('BITNOB_CORRIDOR_FEE_RWF', '0.3');
    expect(getCorridorFee('bitnob', 'rwf')).toBe(0.3);
  });

  it('is 0 for an unconfigured corridor', () => {
    expect(getCorridorFee('bitnob', 'UGX')).toBe(0);
  });

  it('is 0 for an explicitly free corridor', () => {
    set('BITNOB_CORRIDOR_FEE_NGN', '0');
    expect(getCorridorFee('bitnob', 'NGN')).toBe(0);
  });

  it('is always 0 for paycrest, which has no corridor fee', () => {
    set('BITNOB_CORRIDOR_FEE_RWF', '0.3');
    expect(getCorridorFee('paycrest', 'RWF')).toBe(0);
  });

  it('falls back to 0 rather than throwing on a malformed value', () => {
    set('BITNOB_CORRIDOR_FEE_RWF', 'abc');
    expect(getCorridorFee('bitnob', 'RWF')).toBe(0);
    set('BITNOB_CORRIDOR_FEE_RWF', '-1');
    expect(getCorridorFee('bitnob', 'RWF')).toBe(0);
  });
});
