import { describe, expect, it, vi, afterEach } from 'vitest';

/**
 * The guard enforces exactly one rule: an unverified user may withdraw $100 in total, then must
 * verify. Nothing else is rationed — deposits are uncapped and sends never call this.
 *
 * These pin the behaviour that matters and, just as importantly, the work it does NOT do: a
 * verified user must not cost an allowance lookup, and no caller should reach the rolling
 * daily/weekly/monthly machinery, which has been removed outright.
 */
afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Stubs the user lookup so `resolveSupabaseUserId` returns a real id. */
function mockUserRow(id: string | null = 'u1') {
  vi.doMock('@/lib/supabase/adminClient', () => ({
    supabaseAdmin: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: id ? { id } : null }) }) }),
      }),
    },
  }));
}

describe('kycGuard', () => {
  it('refuses an unverified withdrawal past the allowance', async () => {
    mockUserRow();
    vi.doMock('./supabase-kyc', () => ({
      getUserKycStatus: vi.fn().mockResolvedValue({ status: 'not_started' }),
      getWithdrawnAgainstAllowance: vi.fn().mockResolvedValue(80),
    }));

    const { kycGuard } = await import('./guard');
    const result = await kycGuard('someone@example.com', 50);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('kyc_required');
      expect(result.allowanceUsed).toBe(80);
      expect(result.allowanceRemaining).toBe(20);
      expect(result.message).toContain('$20 left');
    }
  });

  it('allows an unverified withdrawal that fits', async () => {
    mockUserRow();
    vi.doMock('./supabase-kyc', () => ({
      getUserKycStatus: vi.fn().mockResolvedValue({ status: 'not_started' }),
      getWithdrawnAgainstAllowance: vi.fn().mockResolvedValue(40),
    }));

    const { kycGuard } = await import('./guard');
    await expect(kycGuard('someone@example.com', 60)).resolves.toEqual({ allowed: true });
  });

  it('allows a verified user without reading the allowance at all', async () => {
    mockUserRow();
    const getWithdrawnAgainstAllowance = vi.fn();
    vi.doMock('./supabase-kyc', () => ({
      getUserKycStatus: vi.fn().mockResolvedValue({ status: 'approved' }),
      getWithdrawnAgainstAllowance,
    }));

    const { kycGuard } = await import('./guard');
    await expect(kycGuard('someone@example.com', 1_000_000)).resolves.toEqual({ allowed: true });

    // A verified user has no allowance to spend, so the second query must not happen.
    expect(getWithdrawnAgainstAllowance).not.toHaveBeenCalled();
  });

  it('refuses an oversized first withdrawal from a user with no record yet', async () => {
    mockUserRow(null);
    vi.doMock('./supabase-kyc', () => ({
      getUserKycStatus: vi.fn(),
      getWithdrawnAgainstAllowance: vi.fn(),
    }));

    const { kycGuard } = await import('./guard');
    const result = await kycGuard('nobody@example.com', 500);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.allowanceRemaining).toBe(100);
  });

  it('allows a zero or negative amount outright', async () => {
    const { kycGuard } = await import('./guard');
    await expect(kycGuard('someone@example.com', 0)).resolves.toEqual({ allowed: true });
    await expect(kycGuard('someone@example.com', -5)).resolves.toEqual({ allowed: true });
  });

  it('treats the allowance as spent when the lookup fails', async () => {
    // getWithdrawnAgainstAllowance returns the full allowance on error, on purpose: defaulting
    // to zero would hand everyone a fresh $100 the moment the database hiccuped.
    mockUserRow();
    vi.doMock('./supabase-kyc', () => ({
      getUserKycStatus: vi.fn().mockResolvedValue({ status: 'not_started' }),
      getWithdrawnAgainstAllowance: vi.fn().mockResolvedValue(100),
    }));

    const { kycGuard } = await import('./guard');
    const result = await kycGuard('someone@example.com', 1);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain('used your $100');
  });
});

describe('the rolling-window system is gone', () => {
  it('exports no daily/weekly/monthly limit machinery', async () => {
    // It refused nothing (every window was Infinity for both tiers) while costing a database
    // read on every movement and implying a second rule that did not exist.
    const limits = await import('./limits');
    for (const name of ['KYC_LIMITS', 'getBindingPeriod', 'anyCeilingConfigured']) {
      expect(limits, name).not.toHaveProperty(name);
    }
  });

  it('leaves kyc_required as the only way to be refused', async () => {
    const guard = await import('./guard');
    expect(typeof guard.kycGuard).toBe('function');
    // `limit_exceeded` existed only for the verified compliance ceiling, which no longer exists.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./guard.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toContain('limit_exceeded');
  });
});
