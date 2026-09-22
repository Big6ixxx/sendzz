import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The three answers this route can give, and why telling them apart matters.
 *
 * `revoked` and `expired` are the app's own rules and the client ends the session on them.
 * `unauthenticated` means only that the access token did not verify — Privy's concern, not
 * ours. Reporting that as `expired` is what signed users out roughly hourly, because the
 * client checks on tab focus and a woken tab is still holding the pre-refresh token.
 */

const SESSION_ID = 'sess_abc';

function mockRow(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  vi.doMock('@/lib/supabase/adminClient', () => ({
    supabaseAdmin: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }),
      }),
    },
  }));
}

function mockIdentity(identity: { sessionId: string } | null) {
  vi.doMock('@/lib/auth/session', async (orig) => {
    const actual = await orig<typeof import('@/lib/auth/session')>();
    return {
      ...actual,
      getVerifiedIdentity: vi.fn().mockResolvedValue(
        identity ? { email: 'a@b.com', privyUserId: 'p1', sessionId: identity.sessionId } : null,
      ),
    };
  });
}

async function call() {
  const { GET } = await import('./route');
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('GET /api/session/status', () => {
  it('reports `unauthenticated` when the token does not verify', async () => {
    // The case that caused the logouts. It must NOT be reported as `expired`.
    mockIdentity(null);
    mockRow(null);

    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body.reason).toBe('unauthenticated');
    expect(body.reason).not.toBe('expired');
  });

  it('reports `revoked` when the device was signed out elsewhere', async () => {
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: '2026-09-18T00:00:00Z', idle_seconds: 10 });

    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body.reason).toBe('revoked');
  });

  it('reports `expired` only past the real 24-hour idle limit', async () => {
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: 24 * 60 * 60 + 1 });

    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body.reason).toBe('expired');
  });

  it('stays alive just inside the limit', async () => {
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: 24 * 60 * 60 - 60 });

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('stays alive for a session row that does not exist yet', async () => {
    // resolveSession creates the row on first sight and lets the request through, so this
    // route must agree — otherwise the client ends a session the API is still serving.
    mockIdentity({ sessionId: SESSION_ID });
    mockRow(null);

    const { status } = await call();
    expect(status).toBe(200);
  });

  it('stays alive when the session table cannot be read', async () => {
    // Fails open, exactly as resolveSession does. A database blip is not a verdict.
    mockIdentity({ sessionId: SESSION_ID });
    mockRow(null, { message: 'connection reset' });

    const { status } = await call();
    expect(status).toBe(200);
  });
});
