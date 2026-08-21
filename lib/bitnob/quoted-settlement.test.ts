import { describe, expect, it } from 'vitest';
import { quotedSettlement, type BitnobPayoutQuote } from './client';

/**
 * What the beneficiary is actually paid.
 *
 * This is the number a user is promised, the number the provider pays, and the number on the
 * receipt — and until it was read off the quote itself, those were three different numbers: a
 * withdrawal quoted at 58,063 NGN paid out 57,958, because the quote came from the indicative
 * exchange-rate endpoint while the payout settled at the quote's own rate.
 */
const quote = (extra: Partial<BitnobPayoutQuote>): BitnobPayoutQuote => ({
  id: 'q1',
  quote_id: 'q1',
  status: 'QUOTE',
  from_asset: 'USDC',
  to_currency: 'NGN',
  amount: '42',
  ...extra,
});

describe('quotedSettlement', () => {
  it('reads the settlement amount and rate the quote itself states', () => {
    const s = quotedSettlement(
      quote({ settlement_amount: '57958.11', exchange_rate: { rate: '1379.955' } }),
      42,
    );
    expect(s).toEqual({ amount: 57958.11, rate: 1379.955 });
  });

  it('prefers the quoted payout over anything derivable from a rate', () => {
    // The rate would imply 58,063 — the figure that was over-promised. The stated payout wins.
    const s = quotedSettlement(
      quote({ settlement_amount: '57958', exchange_rate: { rate: '1382.45' } }),
      42,
    );
    expect(s?.amount).toBe(57958);
  });

  it('accepts the destination amount under any of the keys Bitnob has used for it', () => {
    for (const key of [
      'settlement_amount',
      'amount_to_receive',
      'receive_amount',
      'destination_amount',
      'to_amount',
    ] as const) {
      const s = quotedSettlement(quote({ [key]: '57958' }), 42);
      expect(s?.amount, key).toBe(57958);
    }
  });

  it('derives the rate when only the payout is reported', () => {
    const s = quotedSettlement(quote({ settlement_amount: '57958' }), 42);
    expect(s?.rate).toBeCloseTo(57958 / 42, 6);
  });

  it('derives the payout when only the rate is reported', () => {
    const s = quotedSettlement(quote({ rate: '1379.955' }), 42);
    expect(s?.amount).toBeCloseTo(42 * 1379.955, 6);
  });

  it('falls back to the quote’s own source amount when the caller passes none', () => {
    const s = quotedSettlement(quote({ amount: '42', settlement_amount: '57958' }));
    expect(s?.rate).toBeCloseTo(57958 / 42, 6);
  });

  it('returns null rather than inventing a payout when the quote says nothing usable', () => {
    // Callers fall back to the indicative rate AND label it an estimate. A guessed number
    // presented as a quote is the failure this whole path exists to prevent.
    expect(quotedSettlement(quote({}), 0)).toBeNull();
    expect(quotedSettlement(quote({ settlement_amount: '0', amount: '0' }), 0)).toBeNull();
  });

  it('ignores zero and non-numeric amounts instead of treating them as a payout', () => {
    const s = quotedSettlement(
      quote({ settlement_amount: '0', amount_to_receive: 'n/a', receive_amount: '57958' }),
      42,
    );
    expect(s?.amount).toBe(57958);
  });
});
