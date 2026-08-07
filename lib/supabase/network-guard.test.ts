/**
 * The guard has one job: no testnet row reaches a production database.
 *
 * The cases that matter most are the RPCs. Every money movement in this app goes through
 * `create_transfer_and_lock_balance`, `claim_transfer`, `accept_transfer`,
 * `reclaim_transfer` or `finalize_withdrawal_*` — none of which touch `.insert()`, so a
 * guard that only wrapped table mutations would have blocked nothing that matters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** A stand-in with the shape the guard proxies: `.from()` builders and `.rpc()`. */
function fakeClient() {
  const calls: string[] = [];
  const builder = {
    insert: vi.fn((_row?: unknown) => { calls.push('insert'); return builder; }),
    update: vi.fn((_row?: unknown) => { calls.push('update'); return builder; }),
    upsert: vi.fn((_row?: unknown) => { calls.push('upsert'); return builder; }),
    delete: vi.fn((_arg?: unknown) => { calls.push('delete'); return builder; }),
    select: vi.fn((_cols?: string) => { calls.push('select'); return builder; }),
    eq: vi.fn((_col?: string, _val?: unknown) => builder),
  };
  return {
    calls,
    from: vi.fn((_table: string) => builder),
    rpc: vi.fn((fn: string, _args?: unknown) => {
      calls.push(`rpc:${fn}`);
      return { data: null, error: null };
    }),
    auth: { signInWithOtp: vi.fn((_opts?: unknown) => 'signed-in') },
  };
}

/** Loads the guard fresh under a given env, since the policy is module-level. */
async function loadGuard(env: {
  simulation?: string;
  dbNetwork?: string;
  supabaseUrl?: string;
}) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', env.simulation ?? 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_NETWORK', env.dbNetwork ?? '');
  vi.stubEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    env.supabaseUrl ?? 'https://some-testnet-project.supabase.co',
  );
  return import('./network-guard');
}

/** The real production project, which must never accept testnet writes. */
const PROD_URL = 'https://bnqafdsqkuktaeswrtuu.supabase.co';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe('testnet app against an unmarked (production) database', () => {
  it('blocks every writing RPC', async () => {
    const { guardSupabaseWrites, TestnetWriteBlockedError } = await loadGuard({});
    const client = guardSupabaseWrites(fakeClient());

    for (const fn of [
      'create_transfer_and_lock_balance',
      'claim_transfer',
      'accept_transfer',
      'reclaim_transfer',
      'finalize_withdrawal_success',
      'finalize_withdrawal_failed',
    ]) {
      expect(() => client.rpc(fn), fn).toThrow(TestnetWriteBlockedError);
    }
  });

  it('blocks an unknown RPC, rather than assuming it only reads', async () => {
    const { guardSupabaseWrites } = await loadGuard({});
    const client = guardSupabaseWrites(fakeClient());
    expect(() => client.rpc('some_future_function')).toThrow();
  });

  it('blocks table mutations', async () => {
    const { guardSupabaseWrites } = await loadGuard({});
    const client = guardSupabaseWrites(fakeClient());

    expect(() => client.from('transfers').insert({})).toThrow();
    expect(() => client.from('users').update({})).toThrow();
    expect(() => client.from('users').upsert({})).toThrow();
    expect(() => client.from('deposits').delete()).toThrow();
  });

  it('still allows reads, so the app is usable', async () => {
    const { guardSupabaseWrites } = await loadGuard({});
    const inner = fakeClient();
    const client = guardSupabaseWrites(inner);

    client.from('transfers').select('*');
    client.rpc('get_public_stats');

    expect(inner.calls).toEqual(['select', 'rpc:get_public_stats']);
  });

  it('leaves auth alone, so login still works', async () => {
    const { guardSupabaseWrites } = await loadGuard({});
    const client = guardSupabaseWrites(fakeClient());
    expect(client.auth.signInWithOtp()).toBe('signed-in');
  });
});

describe('production database cannot be relabelled as testnet', () => {
  // This is the regression that let a test bridge and a test user into live tables:
  // the marker was set correctly, but next to the production URL, and a label was the
  // only thing the guard checked.
  it('ignores NEXT_PUBLIC_SUPABASE_NETWORK=testnet on a production project', async () => {
    const { guardSupabaseWrites, DB_WRITES_ALLOWED, IS_PRODUCTION_DB } = await loadGuard({
      dbNetwork: 'testnet',
      supabaseUrl: PROD_URL,
    });

    expect(IS_PRODUCTION_DB).toBe(true);
    expect(DB_WRITES_ALLOWED).toBe(false);

    const client = guardSupabaseWrites(fakeClient());
    expect(() => client.from('users').insert({})).toThrow();
    expect(() => client.rpc('create_transfer_and_lock_balance')).toThrow();
  });

  it('says plainly that the label was ignored', async () => {
    const { guardSupabaseWrites } = await loadGuard({
      dbNetwork: 'testnet',
      supabaseUrl: PROD_URL,
    });
    const client = guardSupabaseWrites(fakeClient());

    expect(() => client.from('users').insert({})).toThrow(/is a production database/);
  });

  it('still lets mainnet write to production, which is normal operation', async () => {
    const { DB_WRITES_ALLOWED } = await loadGuard({
      simulation: 'false',
      supabaseUrl: PROD_URL,
    });
    expect(DB_WRITES_ALLOWED).toBe(true);
  });
});

describe('when the app and database agree', () => {
  it('passes the client straight through on testnet + testnet DB', async () => {
    const { guardSupabaseWrites, DB_WRITES_ALLOWED } = await loadGuard({
      dbNetwork: 'testnet',
    });
    const inner = fakeClient();

    expect(DB_WRITES_ALLOWED).toBe(true);
    expect(guardSupabaseWrites(inner)).toBe(inner); // no proxy in the path at all
    guardSupabaseWrites(inner).from('transfers').insert({});
    expect(inner.calls).toContain('insert');
  });

  it('never interferes with mainnet, which is production today', async () => {
    const { guardSupabaseWrites, DB_WRITES_ALLOWED } = await loadGuard({
      simulation: 'false',
    });
    const inner = fakeClient();

    expect(DB_WRITES_ALLOWED).toBe(true);
    expect(guardSupabaseWrites(inner)).toBe(inner);
  });
});

describe('default posture', () => {
  it('treats an unmarked database as production', async () => {
    const { DB_NETWORK, DB_WRITES_ALLOWED } = await loadGuard({});
    // Forgetting the variable must block writes, not permit them.
    expect(DB_NETWORK).toBe('mainnet');
    expect(DB_WRITES_ALLOWED).toBe(false);
  });
});
