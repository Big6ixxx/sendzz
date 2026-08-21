import { describe, expect, it, vi } from 'vitest';
import { resolvePayoutFiat, type QuoteLookup } from './payout-figure';
import type { RampOrderResponse, RampProviderName } from './types';

/**
 * Which number the receipt records when providers disagree.
 *
 * Withdrawals fall back between providers: the user is quoted by whichever leads the list, and
 * a different one settles when that first is down. The first provider's price does not apply to
 * the second's payout — recording it anyway is the same quote-vs-payout mismatch that paid a
 * user 57,958 NGN on a 58,063 quote, just arriving by a rarer route.
 */
const order = (extra: Partial<RampOrderResponse> = {}): RampOrderResponse => ({
  id: 'offramp_1',
  provider: 'bitnob',
  status: 'pending',
  providerAccount: { validUntil: '' },
  source: { type: 'crypto', currency: 'USDC' },
  destination: { type: 'fiat', currency: 'NGN' },
  amount: '42',
  createdAt: new Date().toISOString(),
  ...extra,
});

const ctx = (extra: Partial<Parameters<typeof resolvePayoutFiat>[2]> = {}) => ({
  amountUsdc: 42,
  fiatCurrency: 'NGN',
  network: 'base',
  ...extra,
});

const noQuote: QuoteLookup = async () => null;
const quotes = (payoutAmount: number, rate: number): QuoteLookup =>
  async (provider: RampProviderName) => ({
    provider,
    rate,
    payoutAmount,
    binding: true,
  });

describe('resolvePayoutFiat', () => {
  it('records the figure the settling order states, over any caller estimate', () => {
    return expect(
      resolvePayoutFiat(
        order({ fiatAmount: '57958', fiatRate: 1379.95 }),
        'bitnob',
        ctx({ fiatAmount: 58063, exchangeRate: 1382.45 }),
        noQuote,
      ),
    ).resolves.toEqual({ fiatAmount: 57958, exchangeRate: 1379.95 });
  });

  it('derives the rate when the order states an amount but no rate', async () => {
    const r = await resolvePayoutFiat(order({ fiatAmount: '57958' }), 'bitnob', ctx(), noQuote);
    expect(r.exchangeRate).toBeCloseTo(57958 / 42, 6);
  });

  it('asks the SETTLING provider when the order states nothing', async () => {
    const lookup = vi.fn(quotes(57000, 1357.14));
    const r = await resolvePayoutFiat(
      order({ provider: 'paycrest' }),
      'paycrest',
      ctx({ quotedBy: 'bitnob', fiatAmount: 58063, exchangeRate: 1382.45 }),
      lookup,
    );
    expect(lookup).toHaveBeenCalledWith('paycrest', {
      amountUsdc: 42,
      fiatCurrency: 'NGN',
      network: 'base',
    });
    expect(r).toEqual({ fiatAmount: 57000, exchangeRate: 1357.14 });
  });

  it('never inherits the price of a provider that is not paying', async () => {
    // Paycrest settled an order Bitnob quoted, and neither the order nor a fresh quote gives a
    // figure. Recording Bitnob's 58,063 against a Paycrest payout is the bug, so record nothing.
    const r = await resolvePayoutFiat(
      order({ provider: 'paycrest' }),
      'paycrest',
      ctx({ quotedBy: 'bitnob', fiatAmount: 58063, exchangeRate: 1382.45 }),
      noQuote,
    );
    expect(r).toEqual({ fiatAmount: undefined, exchangeRate: undefined });
  });

  it('does use the caller estimate when the same provider quoted and settled', async () => {
    const r = await resolvePayoutFiat(
      order(),
      'bitnob',
      ctx({ quotedBy: 'bitnob', fiatAmount: 58063, exchangeRate: 1382.45 }),
      noQuote,
    );
    expect(r).toEqual({ fiatAmount: 58063, exchangeRate: 1382.45 });
  });

  it('falls back to amount × rate when no explicit estimate was passed', async () => {
    const r = await resolvePayoutFiat(order(), 'bitnob', ctx({ exchangeRate: 1380 }), noQuote);
    expect(r.fiatAmount).toBeCloseTo(42 * 1380, 6);
  });

  it('treats a failing quote lookup as no quote rather than an error', async () => {
    const throwing: QuoteLookup = async () => {
      throw new Error('provider down');
    };
    await expect(
      resolvePayoutFiat(order(), 'bitnob', ctx({ exchangeRate: 1380 }), throwing),
    ).resolves.toMatchObject({ exchangeRate: 1380 });
  });

  it('ignores a zero or unparseable figure on the order', async () => {
    const lookup = quotes(57000, 1357.14);
    for (const fiatAmount of ['0', 'n/a', '']) {
      const r = await resolvePayoutFiat(order({ fiatAmount }), 'bitnob', ctx(), lookup);
      expect(r.fiatAmount, fiatAmount).toBe(57000);
    }
  });
});
