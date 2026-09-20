import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rules these hold in place are the ones that cost money when they break:
 * only revenue-earning deposits pay, a deposit never pays twice, and a reversal never claws
 * back something already sent.
 */

interface Row { [key: string]: unknown }

const tables: Record<string, Row[]> = {};
const upserts: Row[] = [];
let updateCalls: { table: string; values: Row; filters: Row }[] = [];

vi.mock('@/lib/supabase/adminClient', () => {
  const selectChain = (table: string) => {
    const filters: Row = {};
    const chain = {
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: () => {
        const found = (tables[table] ?? []).find((row) =>
          Object.entries(filters).every(([k, v]) => row[k] === v),
        );
        return Promise.resolve({ data: found ?? null, error: null });
      },
    };
    return chain;
  };

  const updateChain = (table: string, values: Row) => {
    const filters: Row = {};
    const chain = {
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      then: undefined,
    };
    // The module awaits the builder directly, so it has to be thenable.
    return Object.assign(
      Promise.resolve().then(() => {
        updateCalls.push({ table, values, filters });
        return { error: null };
      }),
      chain,
    );
  };

  return {
    supabaseAdmin: {
      from: (table: string) => ({
        select: () => selectChain(table),
        update: (values: Row) => updateChain(table, values),
        upsert: (row: Row) => {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
});

import { accrueReferralEarning, voidReferralEarning } from './accrue';

const DEPOSIT = {
  id: 'dep-1',
  user_id: 'referee-1',
  amount_usdc: 1000,
  status: 'confirmed',
  provider: 'paycrest',
};

const REFEREE = { id: 'referee-1', referred_by: 'referrer-1' };

beforeEach(() => {
  tables.deposits = [{ ...DEPOSIT }];
  tables.users = [{ ...REFEREE }];
  upserts.length = 0;
  updateCalls = [];

  process.env.REFERRAL_SHARE_PERCENT = '20';
  // Our cut of a fiat on-ramp. The referral share is a fraction of THIS, never of the deposit.
  process.env.PAYCREST_FEE_PERCENT = '1';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('accrueReferralEarning', () => {
  it('shares our revenue, not the deposit', async () => {
    await accrueReferralEarning('dep-1');

    expect(upserts).toHaveLength(1);
    const row = upserts[0];

    // 1% of 1000 USDC is our fee; 20% of that is the commission. Emphatically NOT 20% of
    // 1000 — paying that would be paying out two hundred times what we earned.
    expect(row.basis_usdc).toBeCloseTo(10, 6);
    expect(row.amount_usdc).toBeCloseTo(2, 6);
    expect(row.referrer_id).toBe('referrer-1');
    expect(row.referee_id).toBe('referee-1');
    expect(row.deposit_id).toBe('dep-1');
  });

  it('stores the rate it used rather than leaving it to be looked up later', async () => {
    await accrueReferralEarning('dep-1');
    // Without this the row would silently restate itself the first time the rate changed,
    // and every past payout would stop agreeing with the record that explains it.
    expect(upserts[0].percent).toBe(20);
  });

  it('pays nothing on an on-chain deposit', async () => {
    // These earn us nothing and cost the depositor nothing but gas. Paying a share of them
    // is money out of our own pocket to anyone willing to cycle a balance in and out.
    tables.deposits = [{ ...DEPOSIT, provider: 'onchain' }];
    await accrueReferralEarning('dep-1');
    expect(upserts).toHaveLength(0);
  });

  it('pays nothing on a deposit that has not confirmed', async () => {
    tables.deposits = [{ ...DEPOSIT, status: 'pending' }];
    await accrueReferralEarning('dep-1');
    expect(upserts).toHaveLength(0);
  });

  it('pays nothing when the depositor was not referred', async () => {
    tables.users = [{ id: 'referee-1', referred_by: null }];
    await accrueReferralEarning('dep-1');
    expect(upserts).toHaveLength(0);
  });

  it('relies on the unique deposit for idempotency, not on checking first', async () => {
    // Provider webhooks redeliver. The upsert has to be the thing that makes a repeat a
    // no-op, because "called once per deposit" is not something this can assume.
    await accrueReferralEarning('dep-1');
    expect(upserts[0]).toMatchObject({ deposit_id: 'dep-1' });
  });

  it('stays quiet when no share is configured', async () => {
    delete process.env.REFERRAL_SHARE_PERCENT;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await accrueReferralEarning('dep-1');
    expect(upserts).toHaveLength(0);
  });

  it('does not fail the webhook it runs inside', async () => {
    // Its caller's real job is confirming the user's deposit. Nothing about a commission
    // should be able to break that.
    tables.deposits = [];
    await expect(accrueReferralEarning('missing')).resolves.toBeUndefined();
  });

  it('skips amounts too small to be worth a row', async () => {
    tables.deposits = [{ ...DEPOSIT, amount_usdc: 0.0001 }];
    await accrueReferralEarning('dep-1');
    expect(upserts).toHaveLength(0);
  });
});

describe('voidReferralEarning', () => {
  it('only releases earnings that have not been paid out', async () => {
    await voidReferralEarning('dep-1');

    const call = updateCalls.find((c) => c.table === 'referral_earnings');
    expect(call?.values.status).toBe('void');
    // The guard that matters: a commission already sent on-chain cannot be taken back, and
    // rewriting it here would make the ledger disagree with what left the treasury.
    expect(call?.filters.status).toBe('accrued');
  });
});
