import { describe, expect, it } from 'vitest';

import { GENERIC_ERROR_MESSAGE, toUserSafeMessage } from './sanitize';

describe('toUserSafeMessage', () => {
  /** The exact strings that reached users' screens. */
  it('rejects the real leaked errors', () => {
    const leaks = [
      'Bitnob GET /api/payouts/account-lookup?country=RW&bank_code=MTNRWF&account_number=0795028175 failed (400): {"type":"https://api.bitnob.com/errors/VALIDATION_ERROR","title":"Validation Error","status":400,"correlation_id":"req_019fe742"}',
      'Paycrest API Error (504): <!DOCTYPE html><html lang="en-US"><head><title>504</title></head></html>',
      'Something went wrong: Error: Paycrest API Error (504)',
      'Bitnob could not verify this account (bank_code=MTNRWF, country=RW).',
      'Error: An error occurred in the Server Components render. A digest property is included',
      'at verifyBankAccount (ramp.ts:423:9)',
    ];
    for (const l of leaks) expect(toUserSafeMessage(l)).toBeNull();
  });

  it('never lets a provider name through', () => {
    for (const n of ['Paycrest', 'bitnob', 'Privy', 'Alchemy', 'Didit', 'Supabase']) {
      expect(toUserSafeMessage(`The ${n} service is down`)).toBeNull();
    }
  });

  it('keeps genuinely useful, clean messages', () => {
    const good = [
      'Insufficient balance to complete this transfer.',
      "That number doesn't look like a MTN Mobile Money Rwanda number — they start with 078 or 079.",
      'Unable to verify account details. Please check the information and try again.',
      'This transfer has already been claimed.',
      'Minimum withdrawal is 1 USDC equivalent',
    ];
    for (const g of good) expect(toUserSafeMessage(g)).toBe(g);
  });

  it('rejects empty, over-long and bare-status strings', () => {
    expect(toUserSafeMessage('')).toBeNull();
    expect(toUserSafeMessage(null)).toBeNull();
    expect(toUserSafeMessage('x'.repeat(301))).toBeNull();
    expect(toUserSafeMessage('400 Bad Request')).toBeNull();
    expect(toUserSafeMessage('Internal Server Error')).toBeNull();
  });

  it('rejects uuids, hashes and request ids', () => {
    expect(toUserSafeMessage('Failed for 019fe742-1818-7000-ad87-621b0432a497')).toBeNull();
    expect(toUserSafeMessage('reverted 0x08c379a000000000000000000000')).toBeNull();
  });

  it('exposes a generic fallback for callers', () => {
    expect(GENERIC_ERROR_MESSAGE).toBe('Something went wrong. Please try again.');
  });
});
