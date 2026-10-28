import { describe, expect, it } from 'vitest';
import { buildOnRampCustomer, depositIdentityGap, namesMatch } from './onramp-kyc';
import type { DiditVerifiedIdentity } from '@/lib/kyc/didit-client';

/** Paycrest refuses an on-ramp order without the customer's verified details (source.kyc). */
const NOW = new Date('2026-10-28T12:00:00Z');
const passport: DiditVerifiedIdentity = {
  firstName: 'Ada',
  lastName: 'Obi',
  fullName: 'Ada Chioma Obi',
  issuingState: 'NGA',
  nationality: 'NGA',
  dateOfBirth: '1995-04-12',
  documentType: 'Passport',
  documentNumber: 'B01234567',
};
const build = (over: Partial<Parameters<typeof buildOnRampCustomer>[0]> = {}) =>
  buildOnRampCustomer({ identity: passport, currency: 'GHS', email: 'Ada@Example.com', now: NOW, ...over });

describe('buildOnRampCustomer', () => {
  it('describes the customer from their verified document', () => {
    const r = build();
    expect(r).toEqual({
      ok: true,
      customer: {
        entityType: 'person',
        personDetails: {
          fullName: 'Ada Chioma Obi',
          birthDate: '1995-04-12',
          nationality: 'NG',
          contact: { email: 'ada@example.com' },
          idDocument: { type: 'passport', number: 'B01234567', issuerCountry: 'NG' },
        },
      },
    });
  });

  it('needs verification first', () => {
    expect(build({ identity: null })).toMatchObject({ ok: false, need: 'verification' });
  });

  it('refuses anyone under 18', () => {
    expect(build({ identity: { ...passport, dateOfBirth: '2009-10-29' } })).toMatchObject({ ok: false, need: 'adult' });
    expect(build({ identity: { ...passport, dateOfBirth: '2008-10-28' } })).toMatchObject({ ok: true });
  });

  describe('NGN needs the NIN, read from the verified document', () => {
    it('uses the NIN a Nigerian passport carries', () => {
      const r = build({ currency: 'NGN', identity: { ...passport, personalNumber: '12345678901' } });
      expect(r.ok && r.customer.personDetails.idDocument).toEqual({ type: 'nationalID', number: '12345678901', issuerCountry: 'NG' });
    });

    it("uses a NIN card's own number", () => {
      const card = { ...passport, documentType: 'Identity Card', documentNumber: '12345678901' };
      expect(build({ currency: 'NGN', identity: card })).toMatchObject({ ok: true });
    });

    it('asks a user whose document has no NIN to verify again — a voter\'s card, an older passport', () => {
      const voters = { ...passport, documentType: 'Identity Card', documentNumber: '90F5B1234567890123' };
      expect(build({ currency: 'NGN', identity: voters })).toMatchObject({ ok: false, need: 'reverify' });
      expect(build({ currency: 'NGN' })).toMatchObject({ ok: false, need: 'reverify' });
    });
  });

  it('asks a user whose document gave no date of birth to verify again — a printed NIN slip', () => {
    const slip = { ...passport, documentType: 'Identity Card', documentNumber: '12345678901', dateOfBirth: undefined };
    const r = build({ currency: 'NGN', identity: slip });
    expect(r).toMatchObject({ ok: false, need: 'reverify' });
    expect(!r.ok && r.message).toMatch(/date of birth/);
  });

  describe('KES needs a Kenyan mobile number', () => {
    it('takes it from an M-Pesa refund account', () => {
      const r = build({ currency: 'KES', refundAccount: { institution: 'SAFAKEPC', accountIdentifier: '0712345678' } });
      expect(r.ok && r.customer.personDetails.contact?.phoneE164).toBe('+254712345678');
    });

    it('refuses a bank refund account, unless the form is only pre-checking', () => {
      const bank = { institution: 'KCBLKENX', accountIdentifier: '1234567890' };
      expect(build({ currency: 'KES', refundAccount: bank })).toMatchObject({ ok: false, need: 'kenyan_phone' });
      expect(build({ currency: 'KES', skipPhone: true })).toMatchObject({ ok: true });
    });
  });
});

describe('depositIdentityGap', () => {
  it('asks only for what this corridor needs', () => {
    // A passport without the NIN cannot carry naira, and is perfectly good for shillings.
    expect(depositIdentityGap(passport, 'NGN')).toMatch(/NIN or BVN/);
    expect(depositIdentityGap(passport, 'KES')).toBeNull();
    expect(depositIdentityGap({ ...passport, personalNumber: '12345678901' }, 'NGN')).toBeNull();
  });

  it('never names a document type, and never uses a dash', () => {
    for (const cur of ['NGN', 'KES', 'GHS']) {
      const msg = depositIdentityGap({ ...passport, dateOfBirth: undefined }, cur)!;
      expect(msg).not.toMatch(/passport|NIN card|slip|voter|—/i);
      expect(msg).toMatch(/date of birth/);
    }
  });
});

describe('namesMatch', () => {
  it('accepts the verified name in any order, with extra names', () => {
    expect(namesMatch('Ada Chioma Obi', 'OBI ADA CHIOMA')).toBe(true);
    expect(namesMatch('Ada Obi', 'OBI, ADA NGOZI')).toBe(true);
  });

  it('flags someone else', () => {
    expect(namesMatch('Ada Obi', 'EMEKA OKAFOR')).toBe(false);
    expect(namesMatch('Ada Obi', 'ADA OKAFOR')).toBe(false);
  });
});

describe('a BVN comes from the registry lookup', () => {
  it('sends the BVN Didit matched against the bank register', () => {
    const lookedUp = { ...passport, lookup: { source: 'NIBSS', identifier: '22212345678' } };
    const r = build({ currency: 'NGN', identity: lookedUp });
    expect(r.ok && r.customer.personDetails.idDocument).toEqual({ type: 'BVN', number: '22212345678', issuerCountry: 'NG' });
  });

  it('sends a NIN matched against the national register as the national ID', () => {
    const lookedUp = { ...passport, lookup: { source: 'NIMC', identifier: '12345678901' } };
    const r = build({ currency: 'NGN', identity: lookedUp });
    expect(r.ok && r.customer.personDetails.idDocument.type).toBe('nationalID');
  });
});
