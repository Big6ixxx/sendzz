import { describe, expect, it } from 'vitest';

import {
  isMobileMoneyCode,
  toInternationalMsisdn,
  validateMobileMoneyNumber,
} from './msisdn';

const rw = (accountNumber: string, institutionCode = 'MTNRWF') =>
  validateMobileMoneyNumber({
    institutionCode,
    country: 'RW',
    accountNumber,
    operatorName: institutionCode === 'MTNRWF' ? 'MTN Mobile Money Rwanda' : 'Airtel Money Rwanda',
  });

describe('mobile-money number validation', () => {
  it('accepts the real Rwandan MTN number from the live test', () => {
    const r = rw('0795028175');
    expect(r.ok).toBe(true);
    expect(r.msisdn).toBe('250795028175');
  });

  /**
   * The regression that matters. An earlier fallback reported every number as
   * "Mobile Money (<number>)", so this nonsense displayed as a verified account.
   */
  it('rejects the junk number that previously showed as verified', () => {
    const r = rw('09000000009333');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/digits/i);
  });

  it('rejects a number belonging to the other operator', () => {
    expect(rw('0721234567', 'MTNRWF').ok).toBe(false);   // Airtel range picked under MTN
    expect(rw('0781234567', 'AIRTRWF').ok).toBe(false);  // MTN range picked under Airtel
  });

  it('accepts each operator on its own ranges', () => {
    for (const n of ['0781234567', '0791234567']) expect(rw(n, 'MTNRWF').ok).toBe(true);
    for (const n of ['0721234567', '0731234567']) expect(rw(n, 'AIRTRWF').ok).toBe(true);
  });

  it('accepts numbers already in international form, and with separators', () => {
    expect(rw('250795028175').msisdn).toBe('250795028175');
    expect(rw('+250 795 028 175').msisdn).toBe('250795028175');
    expect(rw('079-502-8175').msisdn).toBe('250795028175');
  });

  it('is idempotent', () => {
    const once = rw('0795028175').msisdn!;
    expect(rw(once).msisdn).toBe(once);
  });

  it('rejects empty and non-numeric input', () => {
    expect(rw('').ok).toBe(false);
    expect(rw('abcdefghij').ok).toBe(false);
  });

  it('skips prefix checks for operators we have no ranges for, rather than guessing', () => {
    const r = validateMobileMoneyNumber({
      institutionCode: 'SAFAKEPC',
      country: 'KE',
      accountNumber: '0712345678',
      operatorName: 'M-PESA',
    });
    expect(r.ok).toBe(true);
    expect(r.msisdn).toBe('254712345678');
  });

  it('knows which institution codes are mobile-money rails', () => {
    expect(isMobileMoneyCode('MTNRWF')).toBe(true);
    expect(isMobileMoneyCode('SAFAKEPC')).toBe(true);
    expect(isMobileMoneyCode('058')).toBe(false);       // a Nigerian bank code
    expect(isMobileMoneyCode('ABNGNGLA')).toBe(false);  // Access Bank
  });

  it('returns null for an unknown country instead of inventing a prefix', () => {
    expect(toInternationalMsisdn('0795028175', 'ZZ')).toBeNull();
  });
});
