import { describe, it, expect } from 'vitest';
import { matchContactBank } from './contact-bank';
import type { RampInstitution } from '@/lib/ramp/types';

const inst = (code: string, name: string): RampInstitution => ({ code, name, institutionCode: code, currency: 'NGN' });

const nigeria = [inst('058', 'Guaranty Trust Bank'), inst('033', 'United Bank for Africa')];
const kenya = [inst('MPESA', 'M-Pesa'), inst('AIRTEL', 'Airtel Money')];

describe('saved contacts belong to the country whose list has their bank', () => {
  it('matches by code, then by name and its aliases', () => {
    expect(matchContactBank(nigeria, { bankCode: '058', bankName: '' })).toEqual({ code: '058', name: 'Guaranty Trust Bank' });
    expect(matchContactBank(nigeria, { bankCode: 'GTBINGLA', bankName: 'GTBank' })).toEqual({ code: '058', name: 'Guaranty Trust Bank' });
    expect(matchContactBank(nigeria, { bankCode: 'x', bankName: 'UBA' })).toEqual({ code: '033', name: 'United Bank for Africa' });
  });

  it('a Nigerian bank is not offered for a Kenyan payout', () => {
    expect(matchContactBank(kenya, { bankCode: '058', bankName: 'Guaranty Trust Bank' })).toBeNull();
  });

  it('nothing matches before the country list has loaded', () => {
    expect(matchContactBank([], { bankCode: '058', bankName: 'GTBank' })).toBeNull();
  });
});
