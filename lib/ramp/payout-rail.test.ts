import { describe, expect, it } from 'vitest';
import { isMobileMoneyCode } from './msisdn';

/**
 * Which rail a payout is built for.
 *
 * A beneficiary is shaped by its rail: a bank transfer carries account_number + bank_code, a
 * mobile-money payout carries an MSISDN, a network and sender identity. Build the wrong shape
 * and the provider rejects it as an invalid beneficiary.
 *
 * The rail used to be chosen by a fixed preference — `bank` first wherever a corridor offered
 * one — regardless of which institution the user actually picked. So a payout to M-PESA was
 * assembled as a bank transfer carrying a mobile-money operator code. On a deferred payout that
 * rejection arrives only after the deposit has landed, which is how a withdrawal ends up funded
 * with no payout and a user out of pocket.
 *
 * The rail must follow the institution. These pin the classification that decision rests on.
 */
describe('isMobileMoneyCode', () => {
  it('recognises the mobile-money operators the app offers', () => {
    for (const code of [
      'SAFAKEPC', // M-PESA, Kenya
      'AIRTKEPC', // Airtel Money, Kenya
      'MTNGHPC', // MTN MoMo, Ghana
      'VODAGHPC', // Vodafone Cash, Ghana
      'MTNUGPC', // MTN MoMo, Uganda
      'MTNRWF', // MTN MoMo, Rwanda
      'AIRTRWF', // Airtel Money, Rwanda
      'ORANGEXOF',
      'WAVEXOF',
      'QMONEYGMD',
    ]) {
      expect(isMobileMoneyCode(code), code).toBe(true);
    }
  });

  it('does not classify a numeric bank code as mobile money', () => {
    // Nigerian bank codes — these must build a BANK beneficiary.
    for (const code of ['000013', '000014', '090267', '058']) {
      expect(isMobileMoneyCode(code), code).toBe(false);
    }
  });

  it('is case-insensitive, since codes arrive from several sources', () => {
    expect(isMobileMoneyCode('safakepc')).toBe(true);
    expect(isMobileMoneyCode('SafaKePc')).toBe(true);
  });

  it('treats an empty or missing code as not-mobile-money rather than throwing', () => {
    expect(isMobileMoneyCode('')).toBe(false);
    expect(isMobileMoneyCode(undefined as unknown as string)).toBe(false);
  });

  it('does not match an unknown code that merely looks like an operator', () => {
    // Guessing here would build a mobile-money beneficiary for something that is not one.
    expect(isMobileMoneyCode('MTNZZZ')).toBe(false);
    expect(isMobileMoneyCode('SAFARICOM')).toBe(false);
  });
});
