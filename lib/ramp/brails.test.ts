import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBrailsClient, verifyBrailsSignature } from '@/lib/brails/client';
import { BrailsProvider, brailsNeedsSender, brailsPhone, brailsStellarMemo, parseBrailsInstitution } from './providers/brails';

import { alpha2FromAlpha3 } from './iso-country';

// Brails lists networks only when configured; the client reads its key once, on first use.
vi.hoisted(() => {
  process.env.BRAILS_API_KEY = 'test-key';
});

// The real one reads the database and Didit; these tests only need its answer.
const senderFor = vi.hoisted(() => vi.fn());
vi.mock('./brails-sender', () => ({ brailsSenderFor: senderFor }));
import { offRampRank, rampProviderNames } from './index';

describe('provider order', () => {
  it('withdrawals try Brails, then Bitnob, then Paycrest', () => {
    const order = [...rampProviderNames()].sort((a, b) => offRampRank(a) - offRampRank(b));
    expect(order).toEqual(['brails', 'bitnob', 'paycrest']);
  });

  it('keeps Bitnob as the primary for catalogue calls', () => {
    expect(rampProviderNames()[0]).toBe('bitnob');
  });
});

describe('Brails institution codes', () => {
  it('carry both the country and the network', () => {
    expect(parseBrailsInstitution('GH:MTN')).toEqual({ country: 'GH', rail: 'mobile_money', network: 'MTN' });
    expect(parseBrailsInstitution('tz:vodacom')).toEqual({ country: 'TZ', rail: 'mobile_money', network: 'VODACOM' });
    expect(parseBrailsInstitution('NG:100004')).toEqual({ country: 'NG', rail: 'bank', network: '100004' });
  });

  it('refuse a network the country does not have, or a code that is not ours', () => {
    // Ghana is MTN-only at Brails; a Bitnob operator code must never be read as a Brails one.
    expect(parseBrailsInstitution('GH:AIRTEL')).toBeNull();
    expect(parseBrailsInstitution('MTNGHPC')).toBeNull();
    expect(parseBrailsInstitution('NG:OPAY')).toBeNull();
    expect(parseBrailsInstitution('')).toBeNull();
  });
});

describe('phone numbers', () => {
  it('are sent as international digits without a plus', () => {
    expect(brailsPhone('0545240030', 'GH')).toBe('233545240030');
    expect(brailsPhone('+254 712 200 002', 'KE')).toBe('254712200002');
    expect(brailsPhone('0967654321', 'ZM')).toBe('260967654321');
  });
});

describe('corridors', () => {
  const provider = new BrailsProvider();

  it('lists each network under its country code', async () => {
    const { data } = await provider.getInstitutions('UGX', 'UG');
    expect(data.map((i) => i.code)).toEqual(['UG:MTN', 'UG:AIRTEL']);
  });

  it('does not pay a shared currency to a country it has not been set up for', async () => {
    // XAF also covers Chad, which Brails does not pay out to.
    await expect(provider.getInstitutions('XAF', 'TD')).rejects.toThrow();
  });

  it('lists the networks of the newer corridors under their own country', async () => {
    const { data } = await provider.getInstitutions('XOF', 'SN');
    expect(data.map((i) => i.code)).toEqual(['SN:ORANGE', 'SN:WAVE', 'SN:FREE', 'SN:EXPRESSO']);
  });

  it('knows which corridors need the sender', () => {
    expect(brailsNeedsSender('SN')).toBe(true);
    expect(brailsNeedsSender('cd')).toBe(true);
    expect(brailsNeedsSender('GA')).toBe(false);
    expect(brailsNeedsSender('NG')).toBe(false);
  });
});

describe('sender country', () => {
  it("turns Didit's alpha-3 issuing state into Brails' alpha-2", () => {
    expect(alpha2FromAlpha3('NGA')).toBe('NG');
    expect(alpha2FromAlpha3('civ')).toBe('CI');
    expect(alpha2FromAlpha3('XYZ')).toBeNull();
  });
});

describe('sender-gated corridors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuse a user with no verified name, before any address is made', async () => {
    const provider = new BrailsProvider();
    senderFor.mockResolvedValueOnce(null);
    const address = vi.spyOn(provider as unknown as { depositAddressFor: () => Promise<unknown> }, 'depositAddressFor');
    await expect(
      provider.createOffRampOrder({
        amountUsdc: 5,
        fiatCurrency: 'XOF',
        payoutCountry: 'SN',
        network: 'base',
        bank: { accountNumber: '771234567', bankCode: 'SN:WAVE', accountName: 'Awa Diop' },
        userEmail: 'someone@example.com',
      } as never),
    ).rejects.toThrow(/Verify your identity to send to Senegal/);
    expect(address).not.toHaveBeenCalled();
  });
});

describe('Stellar memo', () => {
  it('is the same 18 digits for a user every time, and differs between users', () => {
    const a = brailsStellarMemo('Someone@Example.com');
    expect(a).toMatch(/^\d{18}$/);
    expect(brailsStellarMemo('someone@example.com ')).toBe(a);
    expect(brailsStellarMemo('other@example.com')).not.toBe(a);
  });
});

describe('corridor limits', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuse a payout below what Brails accepts, before any USDC is sent', async () => {
    const provider = new BrailsProvider();
    vi.spyOn(provider as unknown as { countryRate: () => Promise<number> }, 'countryRate').mockResolvedValue(1375);
    // $0.30 ≈ ₦412 — under Brails' ₦500 minimum.
    await expect(
      provider.quoteOffRamp({ amountUsdc: 0.3, fiatCurrency: 'NGN', network: 'base', payoutCountry: 'NG' }),
    ).rejects.toThrow(/start at 500 NGN/);
    // $1 ≈ ₦1,375 — fine.
    await expect(
      provider.quoteOffRamp({ amountUsdc: 1, fiatCurrency: 'NGN', network: 'base', payoutCountry: 'NG' }),
    ).resolves.toMatchObject({ provider: 'brails', binding: false });
  });

  it('refuse a payout above what Brails accepts', async () => {
    const provider = new BrailsProvider();
    vi.spyOn(provider as unknown as { countryRate: () => Promise<number> }, 'countryRate').mockResolvedValue(585);
    // $400 ≈ 234,000 XOF — over Senegal's 200,000 maximum.
    await expect(
      provider.quoteOffRamp({ amountUsdc: 400, fiatCurrency: 'XOF', network: 'base', payoutCountry: 'SN' }),
    ).rejects.toThrow(/limited to 200,000 XOF/);
  });

  it('show the rate this country is quoted, not the currency-wide one', async () => {
    const provider = new BrailsProvider();
    vi.spyOn(provider as unknown as { sellRate: () => Promise<number> }, 'sellRate').mockResolvedValue(622.88);
    vi.spyOn(getBrailsClient(), 'createPayoutQuote').mockResolvedValue({
      quoteId: 'q', sourceAmount: 208, targetAmount: 124576, rate: 597.9648, fee: 0, expiresAt: '',
    });
    const quote = await provider.quoteOffRamp({ amountUsdc: 2, fiatCurrency: 'XAF', network: 'base', payoutCountry: 'CM' });
    expect(quote.rate).toBeCloseTo(597.9648);
    expect(quote.payoutAmount).toBeCloseTo(1195.93, 1);
  });
});

describe('webhook signatures', () => {
  afterEach(() => vi.unstubAllEnvs());
  const body = JSON.stringify({ event: 'payout.transfer.success', data: { id: 'abc' } });

  it('accept an HMAC-SHA512 of the body under the webhook secret', () => {
    vi.stubEnv('BRAILS_WEBHOOK_SECRET', 'test-secret');
    const sig = createHmac('sha512', 'test-secret').update(body).digest('hex');
    expect(verifyBrailsSignature(body, sig)).toBe(true);
  });

  it('reject a wrong or missing signature, or no configured secret', () => {
    vi.stubEnv('BRAILS_WEBHOOK_SECRET', 'test-secret');
    const forged = createHmac('sha512', 'other').update(body).digest('hex');
    expect(verifyBrailsSignature(body, forged)).toBe(false);
    expect(verifyBrailsSignature(body, null)).toBe(false);
    vi.stubEnv('BRAILS_WEBHOOK_SECRET', '');
    const sig = createHmac('sha512', 'test-secret').update(body).digest('hex');
    expect(verifyBrailsSignature(body, sig)).toBe(false);
  });
});
