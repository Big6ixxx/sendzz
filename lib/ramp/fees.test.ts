import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFee,
  baseFromTotal,
  feeFromBase,
  getCorridorFee,
  getProviderFee,
  getWithdrawalFeePercent,
  totalFromBase,
  treasuryFor,
} from './fees';

/**
 * The fee percentage is a pricing decision that has to land identically on every path — both
 * providers, every corridor, the UI and the money math. These tests pin the properties that
 * keep that true, so a future rate change can't half-apply the way `1.003` once did: the
 * conversions are exact inverses, and nothing carries its own copy of the rate.
 *
 * Deposits are absent on purpose. They no longer carry a fee at all.
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

  it('backs the fee OUT of a fixed spend (the Max button)', () => {
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
    // back on — the resolver throws when unconfigured, which is the point.
    process.env.WITHDRAWAL_FEE_PERCENT = '0.5';
    for (const provider of ['paycrest', 'bitnob'] as const) {
      const { percent } = getProviderFee(provider);
      const { base, fee, total } = applyFee(250, provider);
      expect(base).toBe(250);
      expect(fee).toBeCloseTo(feeFromBase(250, percent), 9);
      expect(total).toBeCloseTo(totalFromBase(250, percent), 9);
    }
  });

  it('charges both providers the same rate', () => {
    // They used to have separate variables, from when Paycrest skimmed its own partner fee.
    // It no longer does, so a provider-specific rate would only be a way to drift apart.
    process.env.WITHDRAWAL_FEE_PERCENT = '0.5';
    expect(getProviderFee('paycrest').percent).toBe(getProviderFee('bitnob').percent);
  });
});

/**
 * Per-corridor pricing. Some corridors cost more to serve, and charging them all the cheapest
 * rate means subsidising the expensive ones out of margin.
 */
describe('getWithdrawalFeePercent', () => {
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  afterEach(() => {
    set('WITHDRAWAL_FEE_PERCENT_KES', undefined);
    set('WITHDRAWAL_FEE_PERCENT', '0.5');
  });

  it('uses the standard rate when a corridor has no override', () => {
    set('WITHDRAWAL_FEE_PERCENT', '0.5');
    expect(getWithdrawalFeePercent('NGN')).toBe(0.5);
    expect(getWithdrawalFeePercent()).toBe(0.5);
  });

  it('prefers a corridor override where one is set', () => {
    set('WITHDRAWAL_FEE_PERCENT', '0.5');
    set('WITHDRAWAL_FEE_PERCENT_KES', '1');
    expect(getWithdrawalFeePercent('KES')).toBe(1);
    // And leaves every other corridor alone.
    expect(getWithdrawalFeePercent('NGN')).toBe(0.5);
  });

  it('is case-insensitive on the currency', () => {
    set('WITHDRAWAL_FEE_PERCENT_KES', '1');
    expect(getWithdrawalFeePercent('kes')).toBe(1);
  });

  it('throws rather than assuming a rate when nothing is configured', () => {
    for (const bad of [undefined, '', 'abc', '-1', '101']) {
      set('WITHDRAWAL_FEE_PERCENT', bad);
      expect(() => getWithdrawalFeePercent()).toThrow(/WITHDRAWAL_FEE_PERCENT/);
    }
  });

  it('picks up a change without a reload — the value is read per call', () => {
    set('WITHDRAWAL_FEE_PERCENT', '0.5');
    expect(getWithdrawalFeePercent()).toBe(0.5);
    set('WITHDRAWAL_FEE_PERCENT', '0.9');
    expect(getWithdrawalFeePercent()).toBe(0.9);
  });
});

/**
 * One address map, shared by withdrawals, bridges and external sends. It used to be two
 * hardcoded copies, so a chain added to one and not the other collected some fees and
 * silently skipped others.
 */
describe('treasuryFor', () => {
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  afterEach(() => {
    set('FEE_TREASURY_BASE', undefined);
    set('BITNOB_FEE_TREASURY_BASE', undefined);
  });

  it('reads the current name', () => {
    set('FEE_TREASURY_BASE', '0xabc');
    expect(treasuryFor('base')).toBe('0xabc');
  });

  it('falls back to the legacy name so a mid-rename deploy keeps collecting', () => {
    set('BITNOB_FEE_TREASURY_BASE', '0xlegacy');
    expect(treasuryFor('base')).toBe('0xlegacy');
  });

  it('prefers the current name when both are set', () => {
    set('FEE_TREASURY_BASE', '0xnew');
    set('BITNOB_FEE_TREASURY_BASE', '0xlegacy');
    expect(treasuryFor('base')).toBe('0xnew');
  });

  it('is undefined for an unconfigured chain, so the caller can fail closed', () => {
    expect(treasuryFor('base')).toBeUndefined();
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

  const KEYS = [
    'CORRIDOR_FEE_RWF', 'CORRIDOR_FEE_NGN', 'CORRIDOR_FEE_UGX',
    'CORRIDOR_FEE_BITNOB_RWF', 'CORRIDOR_FEE_PAYCREST_RWF',
  ];
  afterEach(() => KEYS.forEach((k) => set(k, undefined)));

  it('reads the per-currency amount for any provider', () => {
    set('CORRIDOR_FEE_RWF', '0.3');
    expect(getCorridorFee('bitnob', 'RWF')).toBe(0.3);
    // The point of the rename: a corridor that costs something costs it whoever serves it,
    // unless that provider is given its own rate.
    expect(getCorridorFee('paycrest', 'RWF')).toBe(0.3);
  });

  it('lets a provider-specific rate win over the per-currency one', () => {
    set('CORRIDOR_FEE_RWF', '0.3');
    set('CORRIDOR_FEE_PAYCREST_RWF', '0');
    expect(getCorridorFee('bitnob', 'RWF')).toBe(0.3);
    // Settles the quoted amount in full, so it must not inherit the other provider's skim.
    expect(getCorridorFee('paycrest', 'RWF')).toBe(0);
  });

  it('is case-insensitive on the currency', () => {
    set('CORRIDOR_FEE_RWF', '0.3');
    expect(getCorridorFee('bitnob', 'rwf')).toBe(0.3);
  });

  it('is 0 for an unconfigured corridor', () => {
    expect(getCorridorFee('bitnob', 'UGX')).toBe(0);
  });

  it('is 0 for an explicitly free corridor', () => {
    set('CORRIDOR_FEE_NGN', '0');
    expect(getCorridorFee('bitnob', 'NGN')).toBe(0);
  });

  it('falls back to 0 rather than throwing on a malformed value', () => {
    set('CORRIDOR_FEE_RWF', 'abc');
    expect(getCorridorFee('bitnob', 'RWF')).toBe(0);
    set('CORRIDOR_FEE_RWF', '-1');
    expect(getCorridorFee('bitnob', 'RWF')).toBe(0);
  });
});
