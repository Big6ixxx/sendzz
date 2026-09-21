import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Both directions matter and they fail in opposite ways.
 *
 * Too permissive and a standing condition emails admins every hour until they filter it out,
 * at which point the alert is worse than nothing. Too strict and the one email that mattered
 * never arrives.
 */

let updateMatches: { key: string }[] = [];
let updateError: { message: string } | null = null;
let insertError: { code?: string; message: string } | null = null;
let lastUpdateFilters: Record<string, unknown> = {};
let inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/adminClient', () => {
  const updateChain = () => {
    const chain = {
      eq: (col: string, val: unknown) => {
        lastUpdateFilters[col] = val;
        return chain;
      },
      lt: (col: string, val: unknown) => {
        lastUpdateFilters[`lt:${col}`] = val;
        return chain;
      },
      select: () => Promise.resolve({ data: updateMatches, error: updateError }),
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: () => ({
        update: () => updateChain(),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: insertError });
        },
      }),
    },
  };
});

import { claimAlertSlot } from './alert-cooldown';

beforeEach(() => {
  updateMatches = [];
  updateError = null;
  insertError = null;
  lastUpdateFilters = {};
  inserted = [];
});

describe('claimAlertSlot', () => {
  it('allows the first send for a key nobody has used', async () => {
    // No row to update, and the insert succeeds — this key has never fired.
    await expect(claimAlertSlot('treasury_low', 60_000)).resolves.toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it('allows a send once the cooldown has elapsed', async () => {
    updateMatches = [{ key: 'treasury_low' }];
    await expect(claimAlertSlot('treasury_low', 60_000)).resolves.toBe(true);
    // The cooldown has to be part of the UPDATE, not checked separately — otherwise two runs
    // both read a stale timestamp and both send.
    expect(lastUpdateFilters['lt:last_sent_at']).toBeTruthy();
  });

  it('refuses while the cooldown is still running', async () => {
    // Nothing matched the UPDATE, and the insert hits the primary key: a row exists and is
    // too recent. This is the case that stops an hourly cron sending an hourly email.
    insertError = { code: '23505', message: 'duplicate key' };
    await expect(claimAlertSlot('treasury_low', 60_000)).resolves.toBe(false);
  });

  it('refuses rather than sending when the database errors', async () => {
    // The condition is still true and will be noticed again next run, so a missed alert costs
    // a delay. Guessing "yes" here would cost a burst of them.
    updateError = { message: 'db down' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(claimAlertSlot('treasury_low', 60_000)).resolves.toBe(false);
  });

  it('keeps separate keys independent', async () => {
    // The urgent "payouts blocked" alert must not be swallowed by a cooldown that an earlier
    // "getting low" heads-up started.
    insertError = { code: '23505', message: 'duplicate key' };
    await expect(claimAlertSlot('treasury_low', 60_000)).resolves.toBe(false);

    insertError = null;
    await expect(claimAlertSlot('treasury_blocked', 60_000)).resolves.toBe(true);
  });
});
