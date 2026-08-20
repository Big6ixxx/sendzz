import { describe, expect, it } from 'vitest';
import { matchBank } from './index';
import type { RampInstitution } from './types';

/**
 * Turning what the user picked into the code a payout is addressed with.
 *
 * This is the step that failed after a real deposit had already landed: "Invalid beneficiary
 * bank_code". Callers pass `bankName || bankCode`, so a blank name sends the CODE in as the
 * name — and the substring fallback then resolved it to *some* institution rather than none. A
 * plausible code for the wrong bank is worse than no code, because nothing rejects it until the
 * provider does, by which time the user's USDC is gone.
 */
const NGN: RampInstitution[] = [
  { name: 'Guaranty Trust Bank', code: '000013', institutionCode: '000013', currency: 'NGN' },
  { name: 'Access Bank', code: '000014', institutionCode: '000014', currency: 'NGN' },
  { name: 'Kuda Microfinance Bank', code: '090267', institutionCode: '090267', currency: 'NGN' },
];

describe('matchBank', () => {
  it('resolves a code passed where a name was expected', () => {
    // The blank-name path: `bankDetails.bankName || bankDetails.bankCode`.
    expect(matchBank(NGN, '000013')).toEqual({ code: '000013', name: 'Guaranty Trust Bank' });
  });

  it('refuses to guess an UNKNOWN code rather than substring-matching a wrong bank', () => {
    expect(matchBank(NGN, '999999')).toBeNull();
  });

  it('refuses any identifier-shaped query it does not recognise', () => {
    for (const q of ['000', '12345678', 'GTB001']) {
      expect(matchBank(NGN, q), q).toBeNull();
    }
  });

  it('still resolves an exact bank name', () => {
    expect(matchBank(NGN, 'Access Bank')).toEqual({ code: '000014', name: 'Access Bank' });
  });

  it('still tolerates human spelling of a real name', () => {
    expect(matchBank(NGN, 'Kuda')).toEqual({ code: '090267', name: 'Kuda Microfinance Bank' });
    expect(matchBank(NGN, 'guaranty trust')).toEqual({
      code: '000013',
      name: 'Guaranty Trust Bank',
    });
  });

  it('matches a code case- and whitespace-insensitively', () => {
    expect(matchBank(NGN, '  000014 ')).toEqual({ code: '000014', name: 'Access Bank' });
  });

  it('returns null for an empty query rather than the first bank in the list', () => {
    expect(matchBank(NGN, '')).toBeNull();
    expect(matchBank(NGN, '   ')).toBeNull();
  });

  it('does not match a query that normalises away to nothing', () => {
    // "Bank PLC" is entirely stopwords; matching it would pick an arbitrary institution.
    expect(matchBank(NGN, 'Bank PLC')).toBeNull();
  });

  it('returns null against an empty institution list instead of throwing', () => {
    expect(matchBank([], 'Access Bank')).toBeNull();
  });
});
