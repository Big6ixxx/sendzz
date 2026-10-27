import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A withdrawal settlement is the only Stellar send that skips the PIN, so naming an order id
 * must not be enough: the send has to be exactly the order's.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose stand-ins for database rows
type Row = Record<string, any>;
const db = vi.hoisted(() => ({ users: [] as Row[], withdrawals: [] as Row[] }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/adminClient', () => ({
  supabaseAdmin: {
    from: (table: 'users' | 'withdrawals') => {
      const filters: ((r: Row) => boolean)[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mimics Supabase's chainable builder
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        maybeSingle: async () => ({ data: db[table].find((r) => filters.every((f) => f(r))) ?? null }),
      };
      return q;
    },
  },
}));

const { checkWithdrawalSend } = await import('./withdrawal-send');

const ORDER = 'brails_1';
const ADDRESS = 'GBRAILSDEPOSITADDRESS';
const send = (over: Partial<Parameters<typeof checkWithdrawalSend>[0]> = {}) =>
  checkWithdrawalSend({
    userEmail: 'me@example.com',
    withdrawalOrderId: ORDER,
    recipientAddress: ADDRESS,
    amount: 10,
    memo: '123',
    feeAmount: 0.1,
    ...over,
  });

beforeEach(() => {
  db.users = [{ id: 'u1', email: 'me@example.com' }, { id: 'u2', email: 'other@example.com' }];
  db.withdrawals = [{
    id: 'w1', user_id: 'u1', status: 'processing', provider: 'brails', provider_order_id: ORDER,
    amount_usdc: 10, fiat_currency: 'NGN', tx_hash: null,
    provider_metadata: { network: 'stellar', deposit_address: ADDRESS, deposit_memo: '123', fee_usdc: 0.1 },
  }];
});

describe('checkWithdrawalSend', () => {
  it('allows the send the order was created for', async () => {
    await expect(send()).resolves.toEqual({ ok: true, rowId: 'w1' });
  });

  it('allows the flat fee the order was created with, and no more', async () => {
    db.withdrawals[0].corridor_fee_usdc = 2;
    await expect(send({ amount: 12 })).resolves.toEqual({ ok: true, rowId: 'w1' });
    await expect(send({ amount: 12.5 })).resolves.toMatchObject({ ok: false });
  });

  it("refuses someone else's order", async () => {
    await expect(send({ userEmail: 'other@example.com' })).resolves.toMatchObject({ ok: false });
  });

  it('refuses any other recipient, memo, larger amount or larger fee', async () => {
    await expect(send({ recipientAddress: 'GATTACKER' })).resolves.toMatchObject({ ok: false });
    await expect(send({ memo: '999' })).resolves.toMatchObject({ ok: false });
    await expect(send({ amount: 10.5 })).resolves.toMatchObject({ ok: false });
    await expect(send({ feeAmount: 5 })).resolves.toMatchObject({ ok: false });
  });

  it('refuses an order already sent, closed, or not on Stellar', async () => {
    db.withdrawals[0].tx_hash = 'abc123';
    await expect(send()).resolves.toMatchObject({ ok: false });
    db.withdrawals[0].tx_hash = null;
    db.withdrawals[0].status = 'completed';
    await expect(send()).resolves.toMatchObject({ ok: false });
    db.withdrawals[0].status = 'processing';
    db.withdrawals[0].provider_metadata.network = 'base';
    await expect(send()).resolves.toMatchObject({ ok: false });
  });

  it('refuses an order that does not exist', async () => {
    await expect(send({ withdrawalOrderId: 'made_up' })).resolves.toMatchObject({ ok: false });
  });
});
