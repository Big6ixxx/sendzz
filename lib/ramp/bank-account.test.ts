import { describe, expect, it } from 'vitest';
import { bankAccountProblem } from './bank-account';

describe('bankAccountProblem', () => {
  it('accepts a 10 digit Nigerian account number', () => {
    expect(bankAccountProblem('NGN', '9061793498')).toBeNull();
  });

  it('refuses a phone number typed as the account number, and says to drop the 0', () => {
    // The withdrawal that failed: the lookup found the holder, the payout refused the number.
    expect(bankAccountProblem('NGN', '09061793498')).toMatch(/leave out the first 0/);
  });

  it('refuses any other length', () => {
    expect(bankAccountProblem('ngn', '906179349')).toMatch(/10 digits/);
    expect(bankAccountProblem('NGN', '123456789012')).toMatch(/10 digits/);
  });

  it('leaves other currencies alone', () => {
    expect(bankAccountProblem('KES', '0712345678901')).toBeNull();
    expect(bankAccountProblem(undefined, '1')).toBeNull();
  });
});

describe('bankAccountHint', () => {
  it('stays quiet while a number is still being typed, and speaks once it is too long', async () => {
    const { bankAccountHint } = await import('./bank-account');
    expect(bankAccountHint('NGN', '906179')).toBeNull();
    expect(bankAccountHint('NGN', '9061793498')).toBeNull();
    expect(bankAccountHint('NGN', '09061793498')).toMatch(/leave out the first 0/);
    expect(bankAccountHint('KES', '0712345678901')).toBeNull();
  });
});

describe('bankAccountHint, a short number', () => {
  it('is pointed out once the person stops typing, not before', async () => {
    const { bankAccountHint } = await import('./bank-account');
    expect(bankAccountHint('NGN', '906179349')).toBeNull();
    expect(bankAccountHint('NGN', '906179349', true)).toMatch(/10 digits/);
    expect(bankAccountHint('NGN', '', true)).toBeNull();
  });
});
