import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Brails webhook handlers against an in-memory withdrawals table: the money cases are what
 * happens when a step fails half-way, and each must leave the row retryable or settled — never
 * stuck behind a claim nobody will release.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a loose stand-in for database rows
type Row = Record<string, any>;
const db = vi.hoisted(() => ({ rows: [] as Row[], rpcError: null as null | { message: string }, rpcCalls: [] as string[] }));

const valueAt = (row: Row, path: string) => {
  const m = path.match(/^provider_metadata->brails->>(\w+)$/);
  if (m) return row.provider_metadata?.brails?.[m[1]] ?? null;
  return row[path] ?? null;
};

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/adminClient', () => {
  const query = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const rows = () => (table === 'users' ? [{ id: 'u1', email: 'user@example.com' }] : db.rows).filter((r) => filters.every((f) => f(r)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mimics Supabase's chainable builder
    const q: any = {
      select: () => q,
      update: (p: Row) => ((patch = p), q),
      eq: (k: string, v: unknown) => (filters.push((r) => valueAt(r, k) === v), q),
      ilike: (k: string, v: string) => (filters.push((r) => String(valueAt(r, k) ?? '').toLowerCase() === v.toLowerCase()), q),
      is: (k: string, v: null) => (filters.push((r) => valueAt(r, k) === v), q),
      not: () => q,
      lt: () => q,
      gt: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null }),
      then: (resolve: (v: unknown) => void) => {
        const hit = rows();
        if (!patch) return resolve({ data: structuredClone(hit) });
        hit.forEach((r) => Object.assign(r, structuredClone(patch)));
        resolve({ data: hit.map((r) => ({ id: r.id })) });
      },
    };
    return q;
  };
  return {
    supabaseAdmin: {
      from: query,
      rpc: async (name: string) => {
        db.rpcCalls.push(name);
        return { error: db.rpcError };
      },
    },
  };
});

const brails = vi.hoisted(() => ({
  getTransaction: vi.fn(),
  createBeneficiary: vi.fn(),
  getPayoutRate: vi.fn(),
  createPayoutQuote: vi.fn(),
  sendPayout: vi.fn(),
  findPayoutByReference: vi.fn(),
}));
vi.mock('@/lib/brails/client', () => ({ getBrailsClient: () => brails }));
vi.mock('@/lib/ramp/beneficiary-vault', () => ({
  openBeneficiary: () => ({ accountNumber: '0123456789', accountName: 'Ada Obi', bankName: 'Kuda' }),
}));
vi.mock('@/lib/ramp/brails-sender', () => ({ brailsSenderFor: async () => null }));
vi.mock('@/lib/stellar/privy-wallet', () => ({ ledgerTransaction: async () => ({ state: 'unknown' }) }));
vi.mock('@/lib/supabase/transactions', () => ({ triggerWithdrawalNotifications: async () => {} }));
vi.mock('@/lib/referrals/accrue', () => ({ accrueReferralEarning: async () => {}, voidReferralEarning: async () => {} }));
vi.mock('@/lib/referrals/benefits', () => ({ releaseBenefitsForOrder: async () => {} }));

const { onBrailsDeposit, onBrailsPayout } = await import('./brails-payout');

const HASH = '0xabc';
const DEPOSIT_ADDRESS = '0xBrailsDepositForThisUser';
function seed(brailsMeta: Row = {}) {
  db.rows = [{
    id: 'w1', user_id: 'u1', status: 'processing', provider: 'brails', provider_order_id: 'brails_1',
    amount_usdc: 1, fiat_currency: 'NGN', institution_code: 'NG:090267', pending_beneficiary: 'sealed',
    tx_hash: HASH, provider_metadata: { network: 'base', deposit_address: DEPOSIT_ADDRESS, brails: brailsMeta },
  }];
}
const meta = () => db.rows[0].provider_metadata.brails;

beforeEach(() => {
  vi.clearAllMocks();
  db.rpcError = null;
  db.rpcCalls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  brails.getTransaction.mockResolvedValue({ id: 'd1', status: 'success', hash: HASH, amount: '1', chain: 'base', address: DEPOSIT_ADDRESS.toLowerCase() });
  brails.createBeneficiary.mockResolvedValue({ id: 'b1' });
  brails.getPayoutRate.mockResolvedValue({ sellRate: 1380 });
  brails.createPayoutQuote.mockResolvedValue({ quoteId: 'q1', sourceAmount: 100, targetAmount: 138000, rate: 1380, fee: 0, expiresAt: '' });
  brails.sendPayout.mockResolvedValue({ id: 'p1', reference: 'brails_1', status: 'pending' });
});

describe('onBrailsDeposit', () => {
  it('starts the payout and records it without dropping what was there', async () => {
    seed();
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: true });
    expect(meta()).toMatchObject({ depositId: 'd1', payoutId: 'p1', quoteId: 'q1' });
    expect(db.rows[0].provider_metadata.network).toBe('base');
  });

  it('releases the claim and asks for a retry when Brails fails before anything is sent', async () => {
    seed();
    brails.createPayoutQuote.mockRejectedValue(Object.assign(new Error('timeout'), { status: 0 }));
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: false, retry: true });
    expect(meta().payoutId).toBeUndefined();
    expect(brails.sendPayout).not.toHaveBeenCalled();
  });

  it('keeps the claim when the payout call itself had no answer', async () => {
    seed();
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('socket hang up'), { status: 0 }));
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: false, retry: false });
    expect(meta().payoutId).toBe('starting');
  });

  it('fails the withdrawal on a clear refusal', async () => {
    seed();
    brails.createBeneficiary.mockRejectedValue(Object.assign(new Error('invalid account'), { status: 422 }));
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: true });
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_failed']);
    expect(meta().payoutId).toBe('rejected');
  });

  it('fails the withdrawal and records the debt when far less arrived than expected', async () => {
    seed();
    brails.getTransaction.mockResolvedValue({ id: 'd1', status: 'success', hash: HASH, amount: '0.5', chain: 'base', address: DEPOSIT_ADDRESS });
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: true });
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_failed']);
    expect(meta().payoutId).toBe('rejected');
    expect(brails.sendPayout).not.toHaveBeenCalled();
  });

  it("never pays out a deposit that arrived at someone else's address", async () => {
    // A public hash attached to the wrong order: the money did not go where that order's did.
    seed();
    brails.getTransaction.mockResolvedValue({ id: 'd1', status: 'success', hash: HASH, amount: '1', chain: 'base', address: '0xsomeoneelse' });
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: false, retry: false });
    expect(brails.createBeneficiary).not.toHaveBeenCalled();
    expect(meta().payoutId).toBeUndefined();
  });

  it('records a payout that already exists instead of refunding it', async () => {
    seed();
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('reference already used'), { status: 409 }));
    brails.findPayoutByReference.mockResolvedValue({ id: 'p-old', reference: 'brails_1', status: 'success' });
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: true });
    expect(db.rpcCalls).toEqual([]);
    expect(meta().payoutId).toBe('p-old');
  });

  it('refunds a payout refused at the call when none exists', async () => {
    seed();
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('insufficient balance'), { status: 422 }));
    brails.findPayoutByReference.mockResolvedValue(null);
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: true });
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_failed']);
  });

  it('stays retryable when a refusal could not be recorded', async () => {
    seed();
    brails.createBeneficiary.mockRejectedValue(Object.assign(new Error('invalid account'), { status: 422 }));
    db.rpcError = { message: 'db down' };
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: false, retry: true });
    expect(meta().payoutId).toBeUndefined();
  });
});

describe('onBrailsPayout', () => {
  beforeEach(() => brails.getTransaction.mockResolvedValue({ id: 'p1', status: 'success' }));

  it('settles the withdrawal once', async () => {
    seed({ payoutId: 'p1' });
    await expect(onBrailsPayout({ id: 'p1' }, true)).resolves.toMatchObject({ ok: true });
    expect(meta()).toMatchObject({ payoutId: 'p1', settledAs: 'success', payoutStatus: 'SUCCESS' });
    await expect(onBrailsPayout({ id: 'p1' }, true)).resolves.toMatchObject({ note: 'payout already being settled' });
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_success']);
  });

  it('treats any final state but success as a failure', async () => {
    seed({ payoutId: 'p1' });
    brails.getTransaction.mockResolvedValue({ id: 'p1', status: 'EXPIRED' });
    await expect(onBrailsPayout({ id: 'p1' }, false)).resolves.toMatchObject({ ok: true });
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_failed']);
  });

  it('waits while the payout is still in flight', async () => {
    seed({ payoutId: 'p1' });
    brails.getTransaction.mockResolvedValue({ id: 'p1', status: 'PROCESSING' });
    await expect(onBrailsPayout({ id: 'p1' }, false)).resolves.toMatchObject({ ok: false, retry: true });
    expect(db.rpcCalls).toEqual([]);
  });

  it('gives the settlement back when finalising fails, so the retry can finish it', async () => {
    seed({ payoutId: 'p1' });
    db.rpcError = { message: 'db down' };
    await expect(onBrailsPayout({ id: 'p1' }, true)).resolves.toMatchObject({ ok: false, retry: true });
    expect(meta().settledAs).toBeUndefined();

    db.rpcError = null;
    await expect(onBrailsPayout({ id: 'p1' }, true)).resolves.toMatchObject({ ok: true });
    expect(meta().settledAs).toBe('success');
  });
});
