import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What these pin down is the binding, because the binding is the whole idea.
 *
 * A PIN check that merely returns true can be reused for any payment. These tests assert that
 * a token is tied to one purpose, one destination and one amount — and, just as importantly,
 * that two spellings of the SAME transaction still match, because a hash that drifts between
 * minting and spending would refuse honest payments in production.
 */

// ── Stubs ────────────────────────────────────────────────────────────────────
// The module talks to Supabase and to Privy. Neither is the subject here, so both are replaced
// with the smallest thing that lets the logic under test run.

const updateFilters: Record<string, unknown> = {};
let updateResult: { data: { id: string }[] | null; error: { message: string } | null } = {
  data: [{ id: 'auth-row' }],
  error: null,
};
let insertError: { message: string } | null = null;
let currentUserRow: { id: string } | null = { id: 'user-1' };

vi.mock('@/lib/supabase/adminClient', () => {
  /** Records every `.eq()`/`.is()`/`.gt()` so a test can assert what the UPDATE filtered on. */
  const updateChain = () => {
    const chain = {
      eq: (col: string, val: unknown) => {
        updateFilters[col] = val;
        return chain;
      },
      is: (col: string, val: unknown) => {
        updateFilters[`is:${col}`] = val;
        return chain;
      },
      gt: (col: string, val: unknown) => {
        updateFilters[`gt:${col}`] = val;
        return chain;
      },
      select: () => Promise.resolve(updateResult),
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => ({
        insert: () => Promise.resolve({ error: insertError }),
        update: () => updateChain(),
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: table === 'users' ? currentUserRow : null,
              }),
          }),
        }),
      }),
    },
  };
});

vi.mock('@/lib/auth/session', () => ({
  getVerifiedIdentity: () =>
    Promise.resolve({
      email: 'ada@example.com',
      privyUserId: 'privy-1',
      sessionId: 'session-1',
    }),
}));

import {
  AuthorizationError,
  consumeAuthorization,
  mintAuthorization,
  payloadHash,
} from './transaction-auth';

beforeAll(() => {
  process.env.PIN_PEPPER = 'test-pepper-value-at-least-16-chars';
});

beforeEach(() => {
  for (const key of Object.keys(updateFilters)) delete updateFilters[key];
  updateResult = { data: [{ id: 'auth-row' }], error: null };
  insertError = null;
  currentUserRow = { id: 'user-1' };
});

describe('payloadHash', () => {
  const base = { destination: 'ada@example.com', amount: 40 };

  it('changes when the amount changes', () => {
    expect(payloadHash('transfer', base)).not.toBe(
      payloadHash('transfer', { ...base, amount: 40.01 }),
    );
  });

  it('changes when the destination changes', () => {
    // The attack this exists to stop: a token minted for a small payment to someone you
    // trust, re-aimed at somebody else.
    expect(payloadHash('transfer', base)).not.toBe(
      payloadHash('transfer', { ...base, destination: 'mallory@example.com' }),
    );
  });

  it('changes when the purpose changes', () => {
    expect(payloadHash('transfer', base)).not.toBe(payloadHash('withdrawal', base));
  });

  it('changes when the chain changes', () => {
    expect(payloadHash('crypto_transfer', { ...base, chain: 'base' })).not.toBe(
      payloadHash('crypto_transfer', { ...base, chain: 'polygon' }),
    );
  });

  it('treats the same transaction written differently as the same transaction', () => {
    // These all describe one payment. If any of them hashed differently, the mint and the
    // consume could disagree and refuse a payment the user correctly authorised.
    const canonical = payloadHash('transfer', { destination: 'ada@example.com', amount: 40 });

    expect(payloadHash('transfer', { destination: 'ADA@example.com', amount: 40 })).toBe(canonical);
    expect(payloadHash('transfer', { destination: ' ada@example.com ', amount: 40 })).toBe(canonical);
    expect(payloadHash('transfer', { destination: 'ada@example.com', amount: '40' })).toBe(canonical);
    expect(payloadHash('transfer', { destination: 'ada@example.com', amount: '40.00' })).toBe(canonical);
    expect(payloadHash('transfer', { destination: 'ada@example.com', amount: 40, chain: null })).toBe(
      canonical,
    );
  });

  it('refuses to hash an operation with no usable amount', () => {
    expect(() => payloadHash('transfer', { destination: 'ada@example.com', amount: 'abc' })).toThrow();
  });
});

describe('mintAuthorization', () => {
  it('gives each authorisation its own token', async () => {
    const a = await mintAuthorization({
      userId: 'user-1',
      sessionId: 'session-1',
      purpose: 'transfer',
      payload: { destination: 'ada@example.com', amount: 40 },
    });
    const b = await mintAuthorization({
      userId: 'user-1',
      sessionId: 'session-1',
      purpose: 'transfer',
      payload: { destination: 'ada@example.com', amount: 40 },
    });

    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThan(30);
  });

  it('gives a withdrawal longer to be spent than a transfer', async () => {
    // Not cosmetic: a withdrawal may bridge funds onto the settlement chain first, and a
    // token that expires mid-bridge strands a user who has already paid to move money.
    const transfer = await mintAuthorization({
      userId: 'user-1',
      sessionId: 'session-1',
      purpose: 'transfer',
      payload: { destination: 'ada@example.com', amount: 40 },
    });
    const withdrawal = await mintAuthorization({
      userId: 'user-1',
      sessionId: 'session-1',
      purpose: 'withdrawal',
      payload: { destination: '0123456789', amount: 40 },
    });

    expect(Date.parse(withdrawal.expiresAt)).toBeGreaterThan(Date.parse(transfer.expiresAt));
  });

  it('fails loudly when the row cannot be stored', async () => {
    // Returning a token nothing could later verify would mean every payment failing at the
    // point of use, long after the PIN was accepted.
    insertError = { message: 'db down' };
    await expect(
      mintAuthorization({
        userId: 'user-1',
        sessionId: 'session-1',
        purpose: 'transfer',
        payload: { destination: 'ada@example.com', amount: 40 },
      }),
    ).rejects.toThrow();
  });
});

describe('consumeAuthorization', () => {
  const payload = { destination: 'ada@example.com', amount: 40 };

  it('refuses when no token is presented', async () => {
    await expect(
      consumeAuthorization({ token: undefined, purpose: 'transfer', payload }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses when the caller has no account row', async () => {
    currentUserRow = null;
    await expect(
      consumeAuthorization({ token: 'tok', purpose: 'transfer', payload }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('spends the token against user, session, purpose, payload and expiry at once', async () => {
    await consumeAuthorization({ token: 'tok', purpose: 'transfer', payload });

    // All five conditions have to ride inside the UPDATE. Checking any of them separately
    // would leave a window where two requests both see an unspent token.
    expect(updateFilters.user_id).toBe('user-1');
    expect(updateFilters.session_id).toBe('session-1');
    expect(updateFilters.purpose).toBe('transfer');
    expect(updateFilters.payload_hash).toBe(payloadHash('transfer', payload));
    expect(updateFilters['is:consumed_at']).toBeNull();
    expect(updateFilters['gt:expires_at']).toBeTruthy();
  });

  it('refuses when nothing was updated', async () => {
    // One outcome for every reason: already spent, expired, wrong session, wrong payload.
    // The caller learns only that it was refused.
    updateResult = { data: [], error: null };
    await expect(
      consumeAuthorization({ token: 'tok', purpose: 'transfer', payload }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses rather than passing when the database errors', async () => {
    updateResult = { data: null, error: { message: 'db down' } };
    await expect(
      consumeAuthorization({ token: 'tok', purpose: 'transfer', payload }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
