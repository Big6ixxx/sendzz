import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBrailsClient, verifyBrailsSignature } from '@/lib/brails/client';
import {
  BrailsProvider,
  brailsNeedsSender,
  brailsPayoutFee,
  brailsPhone,
  brailsRecipientProblem,
  brailsStellarMemo,
  parseBrailsInstitution,
} from './providers/brails';

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
    expect(data.map((i) => i.code)).toEqual(['SN:ORANGE', 'SN:WAVE']);
  });

  it('knows which corridors need the sender', () => {
    expect(brailsNeedsSender('SN')).toBe(true);
    expect(brailsNeedsSender('et')).toBe(true);
    expect(brailsNeedsSender('GA')).toBe(false);
    expect(brailsNeedsSender('NG')).toBe(false);
  });

  it('offers no country missing from Brails\' supported-countries list, though it quotes them', async () => {
    for (const [country, currency, network] of [
      ['GA', 'XAF', 'AIRTEL'], ['MW', 'MWK', 'TNM'], ['BJ', 'XOF', 'MTN'], ['BF', 'XOF', 'ORANGE'], ['ML', 'XOF', 'ORANGE'],
      ['NE', 'XOF', 'MOOV'], ['CG', 'XAF', 'MTN'], ['GN', 'GNF', 'ORANGE'], ['MA', 'MAD', 'ORANGE'], ['CD', 'CDF', 'MPESA'],
    ]) {
      expect(parseBrailsInstitution(`${country}:${network}`)).toBeNull();
      await expect(provider.getInstitutions(currency, country)).rejects.toThrow();
    }
    // Networks Brails does not accept in a country it does serve.
    for (const code of ['CM:OM', 'SN:FREE', 'SN:EXPRESSO']) expect(parseBrailsInstitution(code)).toBeNull();
    const { data } = await provider.getPayoutCountries();
    expect(data.map((c) => c.code)).toEqual(['NG', 'GH', 'KE', 'UG', 'TZ', 'ZM', 'CM', 'CI', 'SN', 'TG', 'ET', 'GM']);
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
    vi.spyOn(provider as unknown as { countryRate: () => Promise<unknown> }, 'countryRate').mockResolvedValue({ rate: 1375, fee: 0 });
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
    vi.spyOn(provider as unknown as { countryRate: () => Promise<unknown> }, 'countryRate').mockResolvedValue({ rate: 585, fee: 0 });
    // $400 ≈ 234,000 XOF — over Senegal's 200,000 maximum.
    await expect(
      provider.quoteOffRamp({ amountUsdc: 400, fiatCurrency: 'XOF', network: 'base', payoutCountry: 'SN' }),
    ).rejects.toThrow(/limited to 200,000 XOF/);
  });

  it('show the rate this country is quoted, not the currency-wide one', async () => {
    const provider = new BrailsProvider();
    vi.spyOn(getBrailsClient(), 'getPayoutRate').mockResolvedValue({ sellRate: 622.88 } as never);
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

describe("Brails' recipient rules", () => {
  it('refuse a number outside the corridor pattern Brails enforces', () => {
    expect(brailsRecipientProblem('ZM', '260961234567')).toBeNull();
    expect(brailsRecipientProblem('ZM', '260981234567')).toMatch(/Zambia/);
    expect(brailsRecipientProblem('TG', '22891234567')).toBeNull();
    expect(brailsRecipientProblem('TG', '22811234567')).toMatch(/Togo/);
    expect(brailsRecipientProblem('GM', '2207012345')).toBeNull();
    expect(brailsRecipientProblem('GM', '22070123456')).toMatch(/Gambia/);
    expect(brailsRecipientProblem('KE', '254712345678')).toBeNull();
  });

  it('want a first and last name in Uganda', () => {
    expect(brailsRecipientProblem('UG', '256771234567', 'Ada Obi')).toBeNull();
    expect(brailsRecipientProblem('UG', '256771234567', 'Ada')).toMatch(/full name/);
  });
});

describe("Brails' fee", () => {
  afterEach(() => vi.restoreAllMocks());

  it('is read off a live quote, in dollars, once per country while it lasts', async () => {
    vi.spyOn(getBrailsClient(), 'getPayoutRate').mockResolvedValue({ sellRate: 157 } as never);
    const quote = vi.spyOn(getBrailsClient(), 'createPayoutQuote').mockResolvedValue({
      quoteId: 'q', sourceAmount: 1000, targetAmount: 157000, rate: 157, fee: 150, expiresAt: '',
    });
    const [a, b] = await Promise.all([brailsPayoutFee('ETB', 'ET'), brailsPayoutFee('ETB', 'ET')]);
    expect([a, b]).toEqual([1.5, 1.5]);
    expect(await brailsPayoutFee('ETB')).toBe(1.5);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(quote.mock.calls[0][0]).toMatchObject({ targetCurrency: 'ETB', country: 'ET' });
  });

  it("is the order's own quote fee, sent on top of the amount", async () => {
    const provider = new BrailsProvider();
    vi.spyOn(provider as unknown as { countryRate: () => Promise<unknown> }, 'countryRate').mockResolvedValue({ rate: 72, fee: 1.35 });
    vi.spyOn(provider as unknown as { depositAddressFor: () => Promise<unknown> }, 'depositAddressFor').mockResolvedValue({ address: '0xabc' });
    senderFor.mockResolvedValue({ accountName: 'Ada Obi', country: 'NG' });
    const order = await provider.createOffRampOrder({
      amountUsdc: 10, fiatCurrency: 'GMD', network: 'base', payoutCountry: 'GM', userEmail: 'a@b.c',
      bank: { accountNumber: '7012345', bankCode: 'GM:QMONEY', accountName: 'Ada Obi' },
    } as never);
    expect(order.providerFee).toBe('1.35');
  });

  it('refuses a currency Brails does not pay out', async () => {
    await expect(brailsPayoutFee('MAD', 'MA')).rejects.toThrow();
  });
});

describe('networks shared with the other providers', () => {
  it("are named as Bitnob and Paycrest name them, so a pick from either list reaches Brails", async () => {
    const { pickBank } = await import('./index');
    const { data } = await new BrailsProvider().getInstitutions('GHS', 'GH');
    expect(pickBank(data, { code: 'VODAGHPC', name: 'Vodafone Cash' }, 'GH')).toEqual({ code: 'GH:VODAFONE', name: 'Vodafone Cash' });
    expect(pickBank(data, { code: 'MOMOGHPC', name: 'MTN Mobile Money' }, 'GH')).toEqual({ code: 'GH:MTN', name: 'MTN Mobile Money' });
    // AirtelTigo stays with the others until Brails says which of its codes it is.
    expect(pickBank(data, { code: 'ATGHPC', name: 'AirtelTigo Money' }, 'GH')).toBeNull();
  });
});

describe("Brails' fee before the country is known", () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the highest of the countries paid in that currency', async () => {
    vi.spyOn(getBrailsClient(), 'getPayoutRate').mockResolvedValue({ sellRate: 600 } as never);
    vi.spyOn(getBrailsClient(), 'createPayoutQuote').mockImplementation(async (p: { country: string }) => ({
      quoteId: 'q', sourceAmount: 1000, targetAmount: 600000, rate: 600, fee: p.country === 'SN' ? 90 : 0, expiresAt: '',
    }) as never);
    expect(await brailsPayoutFee('XOF')).toBe(0.9);
  });

  it('refuses a rate that is not one, rather than quoting NaN', async () => {
    vi.spyOn(getBrailsClient(), 'getPayoutRate').mockResolvedValue({ sellRate: null } as never);
    const quote = vi.spyOn(getBrailsClient(), 'createPayoutQuote');
    await expect(brailsPayoutFee('MWK')).rejects.toThrow();
    await expect(brailsPayoutFee('KES', 'KE')).rejects.toThrow(/no KES rate/);
    expect(quote).not.toHaveBeenCalled();
  });
});
