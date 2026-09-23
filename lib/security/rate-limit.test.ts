import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two behaviours worth pinning: the key an attempt is counted against, and what happens
 * when the limiter itself is unreachable. The second is deliberately the opposite of how the
 * rest of this codebase fails, so it needs a test saying so on purpose rather than a reader
 * assuming it is a bug.
 */

let rpcArgs: Record<string, unknown> | null = null;
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: [{ allowed: true, used: 1, reset_at: new Date(Date.now() + 60_000).toISOString() }],
  error: null,
};

vi.mock('@/lib/supabase/adminClient', () => ({
  supabaseAdmin: {
    rpc: (_name: string, args: Record<string, unknown>) => {
      rpcArgs = args;
      return Promise.resolve(rpcResult);
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Map([['x-forwarded-for', '203.0.113.7, 10.0.0.1']])),
}));

import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from './rate-limit';

beforeEach(() => {
  rpcArgs = null;
  rpcResult = {
    data: [{ allowed: true, used: 1, reset_at: new Date(Date.now() + 60_000).toISOString() }],
    error: null,
  };
});

describe('checkRateLimit', () => {
  it('counts against the account when one is known', () => {
    return checkRateLimit(RATE_LIMITS.codeVerify, 'ada@example.com').then(() => {
      // The account is the better key: an attacker cannot cheaply change it, where an IP is
      // a proxy away.
      expect(rpcArgs?.p_key).toBe('2fa:verify:user:ada@example.com');
      expect(rpcArgs?.p_limit).toBe(RATE_LIMITS.codeVerify.limit);
      expect(rpcArgs?.p_window_ms).toBe(RATE_LIMITS.codeVerify.windowMs);
    });
  });

  it('falls back to the caller IP when there is no account', async () => {
    await checkRateLimit(RATE_LIMITS.read, null);
    // The first hop of x-forwarded-for, not the whole chain.
    expect(rpcArgs?.p_key).toBe('read:ip:203.0.113.7');
  });

  it('keeps different rules in different buckets', async () => {
    await checkRateLimit(RATE_LIMITS.codeSend, 'ada@example.com');
    const send = rpcArgs?.p_key;
    await checkRateLimit(RATE_LIMITS.codeVerify, 'ada@example.com');
    // Otherwise asking for a code would spend the allowance for checking one.
    expect(send).not.toBe(rpcArgs?.p_key);
  });

  it('refuses when the window is spent', async () => {
    rpcResult = {
      data: [{ allowed: false, used: 11, reset_at: new Date(Date.now() + 120_000).toISOString() }],
      error: null,
    };
    const result = await checkRateLimit(RATE_LIMITS.codeVerify, 'ada@example.com');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('ALLOWS when the limiter itself is unreachable, and says so loudly', async () => {
    // Deliberate, and the opposite of how everything else here fails. A limiter that failed
    // closed would turn one unreachable table into nobody being able to withdraw — a total
    // outage in response to something that is not a security incident. The endpoints behind
    // it are all authenticated in their own right.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpcResult = { data: null, error: { message: 'connection refused' } };

    const result = await checkRateLimit(RATE_LIMITS.codeVerify, 'ada@example.com');

    expect(result.allowed).toBe(true);
    // Silence would make a limiter that is not limiting indistinguishable from a healthy one.
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0]?.[0])).toContain('NOT ENFORCING');
    logged.mockRestore();
  });

  it('allows rather than throwing when the function returns nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpcResult = { data: [], error: null };
    await expect(checkRateLimit(RATE_LIMITS.read, null)).resolves.toMatchObject({ allowed: true });
    logged.mockRestore();
  });
});

describe('limits are set where a real person never meets them', () => {
  it('lets somebody mistype a code several times', () => {
    // Four fumbles in a row is ordinary. Twenty in ten minutes is not a person.
    expect(RATE_LIMITS.codeVerify.limit).toBeGreaterThanOrEqual(5);
    expect(RATE_LIMITS.codeVerify.limit).toBeLessThanOrEqual(20);
  });

  it('keeps emailed codes much tighter than reads', () => {
    // Each one lands in somebody's inbox; a chain read only costs us quota.
    expect(RATE_LIMITS.codeSend.limit).toBeLessThan(RATE_LIMITS.read.limit);
  });

  it('bounds anything that spends our money', () => {
    expect(RATE_LIMITS.sponsor.limit).toBeLessThanOrEqual(60);
    expect(RATE_LIMITS.walletCreate.limit).toBeLessThanOrEqual(60);
  });
});

describe('rateLimitResponse', () => {
  it('is a 429 carrying Retry-After', async () => {
    const res = rateLimitResponse({
      allowed: false,
      used: 11,
      resetAt: new Date(Date.now() + 90_000),
      retryAfterSeconds: 90,
    });
    expect(res.status).toBe(429);
    // The header a well-behaved client actually reads, rather than only a message a human would.
    expect(res.headers.get('Retry-After')).toBe('90');
    await expect(res.json()).resolves.toMatchObject({ retryAfterSeconds: 90 });
  });
});
