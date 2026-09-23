import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Presence extending a session, and the throttle that keeps it affordable.
 *
 * Why presence counts at all is explained on SESSION_IDLE_LIMIT_MS. What matters here is the
 * cost: the check that proves a visit runs about once a minute per tab, so writing every time
 * would be a round trip a minute per device to move a number that only matters in days.
 */

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

async function load(touch = vi.fn()) {
  vi.doMock('@/lib/supabase/adminClient', () => ({
    supabaseAdmin: { rpc: touch },
  }));
  const mod = await import('./session');
  return { mod, touch };
}

describe('touchSessionIfStale', () => {
  it('writes when the clock is stale', async () => {
    const { mod, touch } = await load(vi.fn().mockResolvedValue({ error: null }));
    await mod.touchSessionIfStale('sess_1', 2 * 60 * 60); // 2 hours idle
    expect(touch).toHaveBeenCalledWith('touch_user_session', { p_session_id: 'sess_1' });
  });

  it('skips the write while the stamp is still fresh', async () => {
    // A tab checking in must not become a write on every check.
    const { mod, touch } = await load();
    await mod.touchSessionIfStale('sess_1', 5 * 60); // 5 minutes idle
    expect(touch).not.toHaveBeenCalled();
  });

  it('skips when there is no session id', async () => {
    const { mod, touch } = await load();
    await mod.touchSessionIfStale(undefined, 99999);
    expect(touch).not.toHaveBeenCalled();
  });

  it('treats a missing idle reading as fresh rather than writing blindly', async () => {
    const { mod, touch } = await load();
    await mod.touchSessionIfStale('sess_1', null);
    expect(touch).not.toHaveBeenCalled();
  });
});

describe('SESSION_IDLE_LIMIT_MS', () => {
  it('is a week, not a day', async () => {
    const { mod } = await load();
    expect(mod.SESSION_IDLE_LIMIT_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('comfortably outlasts a gap between transactions', async () => {
    const { mod } = await load();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    expect(threeDays).toBeLessThan(mod.SESSION_IDLE_LIMIT_MS);
  });
});
