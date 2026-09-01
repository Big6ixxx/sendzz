import { describe, expect, it } from 'vitest';
import { isAlreadyInitialized } from './settle-race';

/**
 * The incident this guards against.
 *
 * A user sent 37 USDC on Stellar. The beneficiary was never attached, so no payout existed for
 * the deposit to belong to — and because Bitnob hands every Stellar payout the same static
 * address and discards our reference, nothing on their side could reattach it. The quote
 * expired, the withdrawal was marked failed, and the money was already gone from the wallet.
 *
 * The attach step now runs from three places so no single failure can strand a deposit. That
 * only works if the callers that lose the race stay quiet: a quote that already carries a
 * payout must read as success and fall through to finalize, never as an error.
 */
describe('isAlreadyInitialized', () => {
  it('recognises a quote that already carries a payout', () => {
    for (const msg of [
      'Payout already initialized for this quote',
      'payout already initialised',
      'A payout already exists for quote QT2_21789627',
      'cannot transition from pending_address_deposit',
      'Quote already has a beneficiary',
    ]) {
      expect(isAlreadyInitialized(msg), msg).toBe(true);
    }
  });

  it('does NOT swallow a real initialize failure', () => {
    // These must surface: they mean no payout was created, and the sealed beneficiary has to
    // stay on the row so the cron can try again.
    for (const msg of [
      'Invalid beneficiary bank_code',
      'Unable to verify bank details',
      'INSUFFICIENT_FUNDS',
      'Validation error: account_number is required',
      'Request timed out',
    ]) {
      expect(isAlreadyInitialized(msg), msg).toBe(false);
    }
  });

  it('treats an empty or missing message as a real failure', () => {
    // Guessing "already done" from no information would silently drop a payout.
    expect(isAlreadyInitialized('')).toBe(false);
    expect(isAlreadyInitialized(undefined as unknown as string)).toBe(false);
  });
});

