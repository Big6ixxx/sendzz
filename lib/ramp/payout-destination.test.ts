import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Which destination a manual fiat payout is sent to.
 *
 * Worth pinning precisely: an operator acts on whatever this returns, and sending someone's
 * money to the wrong account is not recoverable. The tiers exist because the full number is
 * deliberately not stored on the withdrawal — only a mask — so it has to be recovered.
 */

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const CONTACTS = [
  { bank_name: 'Premium Trust Bank', bank_code: '000031', account_number: '1234566462', account_name: 'AGROLINKING SOLUTIONS LTD' },
  { bank_name: 'GTBank', bank_code: '000013', account_number: '0987654321', account_name: 'SOMEONE ELSE' },
];

/**
 * Loads the module with the vault stubbed, since sealing needs a key we do not have in tests.
 *
 * `resetModules` first, and nothing from this module is imported statically at the top of the
 * file: a static import would load the real vault before `doMock` ran, and the mock would
 * silently never apply — which is exactly how the first version of this test passed the
 * fallback cases while failing the sealed one.
 */
async function withVault(opened: { accountNumber: string; accountName: string; bankName: string } | null) {
  vi.resetModules();
  vi.doMock('@/lib/ramp/beneficiary-vault', () => ({
    openBeneficiary: vi.fn().mockReturnValue(opened),
  }));
  return import('./payout-destination');
}

describe('resolvePayoutDestination', () => {
  it('prefers the sealed beneficiary over everything else', async () => {
    const { resolvePayoutDestination } = await withVault({
      accountNumber: '9999999999',
      accountName: 'SEALED NAME',
      bankName: 'Sealed Bank',
    });

    const d = resolvePayoutDestination({
      sealedBeneficiary: 'cipher',
      bankAccountMasked: '******6462',
      contacts: CONTACTS,
    });

    expect(d.source).toBe('sealed');
    expect(d.accountNumber).toBe('9999999999');
    // The contact ends ...6462 and must NOT win — the sealed copy is what the payout was
    // actually created against.
    expect(d.accountNumber).not.toBe('1234566462');
  });

  it('falls back to a saved contact matching the last four digits', async () => {
    const { resolvePayoutDestination } = await withVault(null);

    const d = resolvePayoutDestination({
      sealedBeneficiary: null,
      bankAccountMasked: '******6462',
      contacts: CONTACTS,
    });

    expect(d.source).toBe('contact');
    expect(d.accountNumber).toBe('1234566462');
    expect(d.accountName).toBe('AGROLINKING SOLUTIONS LTD');
    expect(d.bankName).toBe('Premium Trust Bank');
  });

  it('refuses to guess when no contact matches', async () => {
    // The mobile-money case: three of the first four real debts landed here. Returning the
    // nearest contact would send someone else's money to this account.
    const { resolvePayoutDestination } = await withVault(null);

    const d = resolvePayoutDestination({
      sealedBeneficiary: null,
      bankAccountMasked: '******9077',
      contacts: CONTACTS,
    });

    expect(d.source).toBe('masked');
    expect(d.accountNumber).toBeNull();
    expect((await withVault(null)).isPayable(d)).toBe(false);
    expect(d.masked).toBe('******9077');
  });

  it('does not match on a mask too short to be meaningful', async () => {
    const { resolvePayoutDestination } = await withVault(null);

    const d = resolvePayoutDestination({
      sealedBeneficiary: null,
      bankAccountMasked: '**21',
      contacts: [{ ...CONTACTS[0], account_number: '21' }],
    });
    // Two digits is not identification.
    expect(d.source).toBe('masked');
  });

  it('treats an unopenable sealed blob as absent rather than throwing', async () => {
    // A rotated or missing encryption key. It must degrade to the contact tier, not crash the
    // admin page that is trying to settle a debt.
    const { resolvePayoutDestination } = await withVault(null);

    const d = resolvePayoutDestination({
      sealedBeneficiary: 'unopenable-cipher',
      bankAccountMasked: '******6462',
      contacts: CONTACTS,
    });

    expect(d.source).toBe('contact');
    expect((await withVault(null)).isPayable(d)).toBe(true);
  });

  it('is unpayable when nothing at all survived', async () => {
    const { resolvePayoutDestination, isPayable } = await withVault(null);
    const d = resolvePayoutDestination({
      sealedBeneficiary: null,
      bankAccountMasked: null,
      contacts: [],
    });
    expect(isPayable(d)).toBe(false);
    expect(d.masked).toBeNull();
  });
});

describe('last4', () => {
  it('ignores masking characters and formatting', async () => {
    const { last4 } = await withVault(null);
    expect(last4('******6462')).toBe('6462');
    expect(last4('1234 5664 62')).toBe('6462');
    expect(last4('+254 712 349 077')).toBe('9077');
  });

  it('returns a short string rather than padding it', async () => {
    const { last4 } = await withVault(null);
    expect(last4('21')).toBe('21');
    expect(last4(null)).toBe('');
  });
});
