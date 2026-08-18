import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openBeneficiary, sealBeneficiary } from './beneficiary-vault';

/**
 * The sealed beneficiary is the only thing that lets the server finish a payout after the user's
 * browser drops. If it cannot be opened again the deposit is stranded, and if it is readable at
 * rest the withdrawals table stops honouring its "masked bank info only" rule.
 */
const KEY = 'dGVzdC1rZXktZm9yLXZhdWx0LXJvdW5kdHJpcC10ZXN0cw==';
const BENEFICIARY = {
  accountNumber: '0241353454',
  accountName: 'YUNUS ABDULMAJID',
  bankName: 'GTBank',
  memo: 'withdrawal',
};

beforeEach(() => {
  process.env.WITHDRAWAL_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  delete process.env.WITHDRAWAL_ENCRYPTION_KEY;
});

describe('beneficiary vault', () => {
  it('round-trips a beneficiary', () => {
    const opened = openBeneficiary(sealBeneficiary(BENEFICIARY));
    expect(opened).toEqual(BENEFICIARY);
  });

  it('does not leave the account number readable in the sealed value', () => {
    const sealed = sealBeneficiary(BENEFICIARY) ?? '';
    expect(sealed).not.toContain('0241353454');
    expect(sealed).not.toContain('YUNUS');
  });

  it('produces a different ciphertext each time, so identical payouts do not correlate', () => {
    expect(sealBeneficiary(BENEFICIARY)).not.toBe(sealBeneficiary(BENEFICIARY));
  });

  it('returns null rather than throwing when the value cannot be opened', () => {
    expect(openBeneficiary('not-a-sealed-value')).toBeNull();
    expect(openBeneficiary(null)).toBeNull();
    expect(openBeneficiary(undefined)).toBeNull();
  });

  it('refuses to store plaintext when no key is configured', () => {
    delete process.env.WITHDRAWAL_ENCRYPTION_KEY;
    const original = process.env.TOTP_ENCRYPTION_KEY;
    delete process.env.TOTP_ENCRYPTION_KEY;
    expect(sealBeneficiary(BENEFICIARY)).toBeNull();
    if (original !== undefined) process.env.TOTP_ENCRYPTION_KEY = original;
  });
});
