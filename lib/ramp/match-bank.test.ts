import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { payoutRailOf, pickBank } from './index';
import type { RampInstitution } from './types';

/**
 * Turning what the user picked into the code a payout is addressed with.
 *
 * This is the step that failed after a real deposit had already landed: "Invalid beneficiary
 * bank_code". Callers pass `bankName || bankCode`, so a blank name sends the CODE in as the
 * name — and a substring fallback used to resolve it to *some* institution rather than none. A
 * plausible code for the wrong bank is worse than no code, because nothing rejects it until the
 * provider does, by which time the user's USDC is gone.
 */
const NGN: RampInstitution[] = [
  { name: 'Guaranty Trust Bank', code: '000013', institutionCode: '000013', currency: 'NGN' },
  { name: 'Access Bank', code: '000014', institutionCode: '000014', currency: 'NGN' },
  { name: 'Kuda Microfinance Bank', code: '090267', institutionCode: '090267', currency: 'NGN' },
];

describe('pickBank — one bank, two providers, two codes', () => {
  const BITNOB: RampInstitution[] = NGN;
  const PAYCREST: RampInstitution[] = [
    { name: 'Guaranty Trust Bank', code: 'GTBINGLA', institutionCode: 'GTBINGLA', currency: 'NGN' },
    { name: 'Access Bank', code: 'ABNGNGLA', institutionCode: 'ABNGNGLA', currency: 'NGN' },
    { name: 'Kuda Microfinance Bank', code: 'KUDANGPC', institutionCode: 'KUDANGPC', currency: 'NGN' },
  ];
  const gtb = { code: '000013', name: 'Guaranty Trust Bank' };

  it('keeps the picked code at the provider it came from', () => {
    expect(pickBank(BITNOB, gtb)).toEqual({ code: '000013', name: 'Guaranty Trust Bank' });
  });

  it("translates it to the other provider's code for the same bank", () => {
    expect(pickBank(PAYCREST, gtb)).toEqual({ code: 'GTBINGLA', name: 'Guaranty Trust Bank' });
    expect(pickBank(BITNOB, { code: 'KUDANGPC', name: 'Kuda Microfinance Bank' })).toEqual({ code: '090267', name: 'Kuda Microfinance Bank' });
  });

  it('never sends a foreign code through, even when the name is missing', () => {
    expect(pickBank(PAYCREST, { code: '000013' })).toBeNull();
  });

  it('does not trust a code that names a different bank here', () => {
    // A code shared by accident across providers must not override the bank the user chose.
    const clash: RampInstitution[] = [
      { name: 'Access Bank', code: '000013', institutionCode: '000013', currency: 'NGN' },
      { name: 'Guaranty Trust Bank', code: 'GTB', institutionCode: 'GTB', currency: 'NGN' },
    ];
    expect(pickBank(clash, gtb)).toEqual({ code: 'GTB', name: 'Guaranty Trust Bank' });
  });
});

describe('pickBank — no guessing across providers', () => {
  const inst = (name: string, code: string): RampInstitution => ({ name, code, institutionCode: code, currency: 'NGN' });

  it('refuses a near-miss name rather than paying a different institution', () => {
    // Each of these resolved to the right-hand bank by substring before.
    const list = [inst('OPAY', '100004'), inst('Citibank Nigeria', '000009'), inst('AUCHI MICROFINANCE BANK', '090264')];
    expect(pickBank(list, { code: 'MOMONGPC', name: 'MoMo Payment Service Bank' })).toBeNull();
    expect(pickBank(list, { code: 'CITXNGPC', name: 'CIT Microfinance Bank' })).toBeNull();
    expect(pickBank(list, { code: 'XXX', name: 'U & C Microfinance Bank' })).toBeNull();
  });

  it('keeps a wallet apart from its bank', () => {
    expect(pickBank([inst('Access Bank', 'ABNGNGLA')], { code: '100013', name: 'ACCESS MONEY' })).toBeNull();
  });

  it("reads Brails' country-prefixed code as the same NIP code", () => {
    const brails = [inst('Kuda Microfinance Bank', 'NG:090267')];
    expect(pickBank(brails, { code: '090267', name: 'Kuda Microfinance Bank' })).toEqual({ code: 'NG:090267', name: 'Kuda Microfinance Bank' });
  });

  it('matches names that differ only by country or licence type', () => {
    expect(pickBank([inst('MoMo PSB', '120003')], { code: 'MOMONGPC', name: 'MoMo Payment Service Bank' })).toEqual({ code: '120003', name: 'MoMo PSB' });
    expect(pickBank([inst('MTN Mobile Money', 'CM:MTN')], { code: 'MTNXAF', name: 'MTN Mobile Money Cameroon' }, 'CM')).toEqual({ code: 'CM:MTN', name: 'MTN Mobile Money' });
  });

  it("never matches a network labelled with another country", () => {
    // Paying Congo: Cameroon's MTN is a different network, whatever its name minus the country.
    expect(pickBank([inst('MTN Mobile Money Cameroon', 'MTNXAF')], { code: 'CG:MTN', name: 'MTN Mobile Money' }, 'CG')).toBeNull();
  });

  it('accepts the same code under a longer name', () => {
    expect(pickBank([inst('AIRTEL MONEY', 'AIRTKEPC')], { code: 'AIRTKEPC', name: 'AIRTEL' })).toEqual({ code: 'AIRTKEPC', name: 'AIRTEL MONEY' });
  });

  it('refuses a name two entries share', () => {
    expect(pickBank([inst('Titan Bank', 'A'), inst('Titan Bank', 'B')], { code: 'Z', name: 'Titan Bank' })).toBeNull();
  });
});

describe('verification and payout address the bank the same way', () => {
  const src = readFileSync(resolve(process.cwd(), 'lib/actions/ramp.ts'), 'utf8');

  it('verification resolves per provider before asking it', () => {
    expect(src).toMatch(/Ramp\.resolveBank\(p, \{ code: institution, name: bankName \}, fiat, country\)[\s\S]{0,300}verifyAccountFor\(p, bank\.code,/);
  });

  it('payout resolves with the picked code and name', () => {
    expect(src).toMatch(/Ramp\.resolveBank\(\s*provider,\s*\{ code: params\.bank\.bankCode, name: params\.bank\.bankName \}/);
  });
});

describe('payoutRailOf', () => {
  // Ghana prices the two differently, so a mobile money payout must not read as a bank one.
  it('tells mobile money from bank across providers', () => {
    expect(payoutRailOf('GH:MTN')).toBe('mobile_money');
    expect(payoutRailOf('NG:000013')).toBe('bank');
    expect(payoutRailOf('MTNGHPC')).toBe('mobile_money');
    expect(payoutRailOf('mtnghpc')).toBe('mobile_money');
    expect(payoutRailOf('GTBINGLA')).toBe('bank');
    expect(payoutRailOf('000013')).toBe('bank');
  });
});
