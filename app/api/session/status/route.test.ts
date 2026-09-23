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
const DAY = 24 * 60 * 60;

function mockRow(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  vi.doMock('@/lib/supabase/adminClient', () => ({
    supabaseAdmin: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }),
      }),
    },
  }));
}

const touchSpy = vi.fn();

function mockIdentity(identity: { sessionId: string } | null) {
  vi.doMock('@/lib/auth/session', async (orig) => {
    const actual = await orig<typeof import('@/lib/auth/session')>();
    return {
      ...actual,
      getVerifiedIdentity: vi.fn().mockResolvedValue(
        identity ? { email: 'a@b.com', privyUserId: 'p1', sessionId: identity.sessionId } : null,
      ),
      touchSessionIfStale: touchSpy,
    };
  });
}

async function call(active = false) {
  const { GET } = await import('./route');
  const url = `http://localhost/api/session/status${active ? '?active=1' : ''}`;
  const res = await GET(new Request(url));
  return { status: res.status, body: await res.json() };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  touchSpy.mockClear();
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

  it('reports `expired` only past the real idle limit', async () => {
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: DAY * 7 + 1 });

    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body.reason).toBe('expired');
  });

  it('keeps a daily visitor signed in long past the old 24-hour mark', async () => {
    // The regression this limit was raised for: the clock only ever moved on a TRANSACTION, so
    // somebody who opened the app every day but last sent money two days ago was signed out.
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: DAY * 2 });

    const { status } = await call();
    expect(status).toBe(200);
  });

  it('stays alive just inside the limit', async () => {
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: DAY * 7 - 60 });

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('extends the session when the user genuinely interacted', async () => {
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: DAY * 2 });

    await call(true);
    expect(touchSpy).toHaveBeenCalledWith(SESSION_ID, DAY * 2);
  });

  it('does NOT extend on a bare poll', async () => {
    // The hole this closes: counting the check itself meant a tab left open in the background
    // renewed its own session forever and could never expire.
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: DAY * 2 });

    const { status } = await call(false);
    expect(status).toBe(200);
    expect(touchSpy).not.toHaveBeenCalled();
  });

  it('does not extend an already-dead session', async () => {
    mockIdentity({ sessionId: SESSION_ID });
    mockRow({ revoked_at: null, idle_seconds: DAY * 7 + 1 });

    await call(true);
    expect(touchSpy).not.toHaveBeenCalled();
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
