import { describe, expect, it } from 'vitest';
import { isQuoteReusable } from './providers/bitnob';
import type { BitnobPayoutQuote } from '@/lib/bitnob/client';

/**
 * Order creation settles on the quote the user reviewed rather than striking a fresh one, so
 * the reviewed figure and the paid figure cannot drift apart. That is only safe while the quote
 * is still good — a spent or expiring quote must be re-struck, and the user shown the new
 * number before they send anything.
 */
const IN_FIVE_MINUTES = () => new Date(Date.now() + 5 * 60_000).toISOString();

const quote = (extra: Partial<BitnobPayoutQuote> = {}): BitnobPayoutQuote => ({
  id: 'q1',
  quote_id: 'q1',
  status: 'QUOTE',
  from_asset: 'USDC',
  to_currency: 'NGN',
  amount: '42',
  expires_at: IN_FIVE_MINUTES(),
  ...extra,
});

describe('isQuoteReusable', () => {
  it('reuses a fresh, unspent quote for the amount and currency it was struck for', () => {
    expect(isQuoteReusable(quote(), 42, 'NGN')).toBe(true);
  });

  it('matches the currency case-insensitively', () => {
    expect(isQuoteReusable(quote({ to_currency: 'ngn' }), 42, 'NGN')).toBe(true);
  });

  it('refuses a quote that already has a payout attached', () => {
    // Reusing it would initialize the same quote twice.
    const spent = { ...quote(), trip: { initialized_at: new Date().toISOString() } };
    expect(isQuoteReusable(spent as BitnobPayoutQuote, 42, 'NGN')).toBe(false);
  });

  it('refuses a quote struck for a different amount', () => {
    expect(isQuoteReusable(quote({ amount: '41' }), 42, 'NGN')).toBe(false);
  });

  it('tolerates float noise in the amount', () => {
    expect(isQuoteReusable(quote({ amount: '42.000000' }), 42.0000001, 'NGN')).toBe(true);
  });

  it('refuses a quote struck for a different currency', () => {
    expect(isQuoteReusable(quote({ to_currency: 'KES' }), 42, 'NGN')).toBe(false);
  });

  it('refuses a quote in a terminal state', () => {
    for (const status of ['EXPIRED', 'FAILED', 'CANCELLED']) {
      expect(isQuoteReusable(quote({ status }), 42, 'NGN'), status).toBe(false);
    }
  });

  it('refuses an expired quote', () => {
    const expired = quote({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(isQuoteReusable(expired, 42, 'NGN')).toBe(false);
  });

  it('refuses a quote without enough life left to outlast the deposit', () => {
    // The margin covers initialize AND the user's transfer landing — an expired payout cannot
    // be finalized, so a quote this close to the end is re-struck instead.
    for (const secondsLeft of [5, 60, 150]) {
      const nearlyExpired = quote({
        expires_at: new Date(Date.now() + secondsLeft * 1000).toISOString(),
      });
      expect(isQuoteReusable(nearlyExpired, 42, 'NGN'), `${secondsLeft}s left`).toBe(false);
    }
  });

  it('reuses a quote with no stated expiry', () => {
    expect(isQuoteReusable(quote({ expires_at: undefined }), 42, 'NGN')).toBe(true);
  });
});
