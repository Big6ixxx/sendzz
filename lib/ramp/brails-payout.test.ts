import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Brails webhook handlers against an in-memory withdrawals table: the money cases are what
 * happens when a step fails half-way, and each must leave the row retryable or settled — never
 * stuck behind a claim nobody will release.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a loose stand-in for database rows
type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  rpcError: null as null | { message: string },
  updateError: null as null | { message: string },
  rpcCalls: [] as string[],
}));

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
      not: (k: string, op: string, v: unknown) => (
        filters.push((r) =>
          op === 'in' ? !String(v).slice(1, -1).split(',').includes(String(valueAt(r, k))) : valueAt(r, k) !== v,
        ),
        q
      ),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(valueAt(r, k))), q),
      order: () => q,
      lte: (k: string, v: string) => (filters.push((r) => String(valueAt(r, k) ?? '') <= v), q),
      lt: () => q,
      gt: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null }),
      then: (resolve: (v: unknown) => void) => {
        const hit = rows();
        if (!patch) return resolve({ data: structuredClone(hit) });
        if (db.updateError) return resolve({ data: null, error: db.updateError });
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
  findDepositByHash: vi.fn(),
}));
vi.mock('@/lib/brails/client', () => ({ getBrailsClient: () => brails }));
const vault = vi.hoisted(() => ({ readable: true }));
vi.mock('@/lib/ramp/beneficiary-vault', () => ({
  openBeneficiary: () => (vault.readable ? { accountNumber: '0123456789', accountName: 'Ada Obi', bankName: 'Kuda' } : null),
}));
const sender = vi.hoisted(() => ({ value: null as null | { accountName: string; country: string } }));
vi.mock('@/lib/ramp/brails-sender', () => ({ brailsSenderFor: async () => sender.value }));
vi.mock('@/lib/stellar/privy-wallet', () => ({ ledgerTransaction: async () => ({ state: 'unknown' }) }));
vi.mock('@/lib/supabase/transactions', () => ({ triggerWithdrawalNotifications: async () => {} }));
vi.mock('@/lib/referrals/accrue', () => ({ accrueReferralEarning: async () => {}, voidReferralEarning: async () => {} }));
vi.mock('@/lib/referrals/benefits', () => ({ releaseBenefitsForOrder: async () => {} }));

const { onBrailsDeposit, onBrailsPayout, reconcileBrailsPayouts, listUnfundedBrailsWithdrawals } = await import(
  './brails-payout'
);

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
  sender.value = null;
  vault.readable = true;
  db.rpcError = null;
  db.updateError = null;
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

  it('gives Brails the phone in its own field where it asks for one (Ethiopia)', async () => {
    seed();
    Object.assign(db.rows[0], { fiat_currency: 'ETB', institution_code: 'ET:ETHIO' });
    sender.value = { accountName: 'Ada Obi', country: 'NG' };
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: true });
    const { destination } = brails.createBeneficiary.mock.calls[0][0];
    expect(destination).toMatchObject({ type: 'MOBILEMONEY', network: 'ETHIO', sender: sender.value });
    expect(destination.phoneNumber).toBe(destination.accountNumber);
  });

  it('sends no phone field where Brails does not ask for one', async () => {
    seed();
    await onBrailsDeposit({ id: 'd1' });
    expect(brails.createBeneficiary.mock.calls[0][0].destination.phoneNumber).toBeUndefined();
  });

  it('releases the claim and asks for a retry when Brails fails before anything is sent', async () => {
    seed();
    brails.createPayoutQuote.mockRejectedValue(Object.assign(new Error('timeout'), { status: 0 }));
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: false, retry: true });
    expect(meta().payoutId).toBeUndefined();
    expect(brails.sendPayout).not.toHaveBeenCalled();
  });

  it('schedules a retry when the payout call itself had no answer', async () => {
    seed();
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('Unable to process request at the moment'), { status: 503 }));
    const before = Date.now();
    await expect(onBrailsDeposit({ id: 'd1' })).resolves.toMatchObject({ ok: false, retry: false });
    expect(meta()).toMatchObject({ payoutId: 'retrying', payoutAttempts: 1, beneficiaryId: 'b1' });
    expect(Date.parse(meta().retryAt) - before).toBeGreaterThanOrEqual(60_000);
    expect(meta().corridorDownAt).toBeTruthy();
    expect(db.rpcCalls).toEqual([]);
  });

  it('does not mark the corridor down for an error of our own', async () => {
    seed();
    brails.sendPayout.mockRejectedValue(new TypeError('cannot read properties of undefined'));
    await onBrailsDeposit({ id: 'd1' });
    expect(meta().payoutId).toBe('retrying');
    expect(meta().corridorDownAt).toBeUndefined();
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

describe('reconcileBrailsPayouts', () => {
  const due = (extra: Row = {}) => ({
    payoutId: 'retrying', payoutAttempts: 1, retryAt: new Date(Date.now() - 1000).toISOString(),
    receivedUsd: 1, beneficiaryId: 'b-saved', corridorDownAt: new Date().toISOString(), ...extra,
  });

  it('retries a due payout with the saved beneficiary and clears the corridor flag', async () => {
    seed(due());
    await expect(reconcileBrailsPayouts()).resolves.toMatchObject({ retried: 1 });
    expect(brails.createBeneficiary).not.toHaveBeenCalled();
    expect(brails.sendPayout.mock.calls[0][0]).toMatchObject({ reference: 'brails_1', beneficiaryId: 'b-saved' });
    expect(meta()).toMatchObject({ payoutId: 'p1' });
    expect(meta().corridorDownAt).toBeUndefined();
  });

  it('leaves a retry that is not due yet alone', async () => {
    seed(due({ retryAt: new Date(Date.now() + 60_000).toISOString() }));
    await expect(reconcileBrailsPayouts()).resolves.toMatchObject({ retried: 0 });
    expect(brails.sendPayout).not.toHaveBeenCalled();
  });

  it('refunds once every attempt has failed and Brails has no payout', async () => {
    seed(due({ payoutAttempts: 3 }));
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('Unable to process request'), { status: 503 }));
    brails.findPayoutByReference.mockResolvedValue(null);
    await reconcileBrailsPayouts();
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_failed']);
    expect(meta().payoutId).toBe('rejected');
  });

  it('follows a payout Brails holds only as initiated rather than refund it', async () => {
    seed(due({ payoutAttempts: 3 }));
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('Unable to process request'), { status: 503 }));
    brails.findPayoutByReference.mockResolvedValue({ id: 'p-init', reference: 'brails_1', status: 'initiated' });
    await reconcileBrailsPayouts();
    expect(db.rpcCalls).toEqual([]);
    expect(meta().payoutId).toBe('p-init');
  });

  it('refunds a retry that can no longer read where the money goes', async () => {
    seed(due());
    vault.readable = false;
    await reconcileBrailsPayouts();
    expect(brails.sendPayout).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_failed']);
    expect(meta().payoutId).toBe('rejected');
  });

  it('gives a second beneficiary attempt its own reference', async () => {
    seed(due({ beneficiaryId: undefined, beneficiaryTries: 1 }));
    await reconcileBrailsPayouts();
    expect(brails.createBeneficiary.mock.calls[0][0].reference).toBe('brails_1-1');
    expect(meta()).toMatchObject({ payoutId: 'p1', beneficiaryId: 'b1', beneficiaryTries: 2 });
  });

  it('follows a payout Brails turns out to be making instead of refunding it', async () => {
    seed(due({ payoutAttempts: 3 }));
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('timeout'), { status: 0 }));
    brails.findPayoutByReference.mockResolvedValue({ id: 'p-real', reference: 'brails_1', status: 'pending' });
    await reconcileBrailsPayouts();
    expect(db.rpcCalls).toEqual([]);
    expect(meta().payoutId).toBe('p-real');
  });

  it('checks again later, without refunding, when Brails cannot be asked', async () => {
    seed(due({ payoutAttempts: 3 }));
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('timeout'), { status: 0 }));
    brails.findPayoutByReference.mockRejectedValue(new Error('down'));
    await reconcileBrailsPayouts();
    expect(db.rpcCalls).toEqual([]);
    expect(meta()).toMatchObject({ payoutId: 'retrying', payoutAttempts: 3, needsReview: true, checkOnly: true });
  });

  it('only asks Brails, without paying again, once attempts are used up', async () => {
    seed(due({ payoutAttempts: 3, checkOnly: true, needsReview: true }));
    brails.findPayoutByReference.mockResolvedValue(null);
    await reconcileBrailsPayouts();
    expect(brails.sendPayout).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_failed']);
  });

  it('uses up no attempt when our own side is rate limited', async () => {
    seed(due());
    brails.getPayoutRate.mockRejectedValue(Object.assign(new Error('too many requests'), { status: 429 }));
    await reconcileBrailsPayouts();
    expect(meta()).toMatchObject({ payoutId: 'retrying', payoutAttempts: 1 });
    expect(meta().needsReview).toBeUndefined();
    expect(Date.parse(meta().retryAt)).toBeGreaterThan(Date.now());
  });

  it('keeps a reopened stale claim due when the attempt goes nowhere', async () => {
    seed({ payoutId: 'starting', payoutStartedAt: new Date(Date.now() - 11 * 60_000).toISOString(), receivedUsd: 1 });
    sender.value = null;
    Object.assign(db.rows[0], { fiat_currency: 'ETB', institution_code: 'ET:ETHIO' });
    await reconcileBrailsPayouts();
    expect(meta().payoutId).toBe('retrying');
    expect(Date.parse(meta().retryAt)).toBeLessThanOrEqual(Date.now());
  });

  it('lists a row Brails keeps refusing to answer about for review', async () => {
    seed(due({ payoutAttempts: 3, needsReview: true, checkOnly: true }));
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('timeout'), { status: 0 }));
    brails.findPayoutByReference.mockRejectedValue(new Error('down'));
    await expect(reconcileBrailsPayouts()).resolves.toMatchObject({ review: ['brails_1'] });
  });

  it('keeps a retry on the backoff when it fails before the payout call', async () => {
    seed(due());
    brails.createPayoutQuote.mockRejectedValue(Object.assign(new Error('Unable to process request'), { status: 503 }));
    await reconcileBrailsPayouts();
    expect(brails.sendPayout).not.toHaveBeenCalled();
    expect(meta()).toMatchObject({ payoutId: 'retrying', payoutAttempts: 2 });
  });

  it('lifts the corridor flag when the payout turns out to exist and be moving', async () => {
    seed(due({ payoutAttempts: 3 }));
    brails.sendPayout.mockRejectedValue(Object.assign(new Error('timeout'), { status: 0 }));
    brails.findPayoutByReference.mockResolvedValue({ id: 'p-real', reference: 'brails_1', status: 'pending' });
    await reconcileBrailsPayouts();
    expect(meta().corridorDownAt).toBeUndefined();
    expect(meta().payoutSentAt).toBeTruthy();
  });

  it('never pays a claim older than the retry code — it may have been paid by hand', async () => {
    seed({ payoutId: 'starting', receivedUsd: 1 });
    await expect(reconcileBrailsPayouts()).resolves.toMatchObject({ review: ['brails_1'] });
    expect(brails.sendPayout).not.toHaveBeenCalled();
  });

  it('retries a claim whose process stopped mid-call', async () => {
    seed({ payoutId: 'starting', payoutStartedAt: new Date(Date.now() - 11 * 60_000).toISOString(), receivedUsd: 1, beneficiaryId: 'b-saved' });
    await expect(reconcileBrailsPayouts()).resolves.toMatchObject({ retried: 1 });
    expect(meta().payoutId).toBe('p1');
  });

  it('settles a payout whose final webhook never came', async () => {
    seed({ payoutId: 'p1', payoutStartedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    brails.getTransaction.mockResolvedValue({ id: 'p1', status: 'SUCCESS' });
    await expect(reconcileBrailsPayouts()).resolves.toMatchObject({ settled: 1 });
    expect(db.rpcCalls).toEqual(['finalize_withdrawal_success']);
  });

  it('keeps waiting on a payout still in flight', async () => {
    seed({ payoutId: 'p1', payoutStartedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    brails.getTransaction.mockResolvedValue({ id: 'p1', status: 'PENDING' });
    await reconcileBrailsPayouts();
    expect(db.rpcCalls).toEqual([]);
  });
});

describe('listUnfundedBrailsWithdrawals', () => {
  it('lists a withdrawal with no transaction, and never fails it', async () => {
    seed();
    db.rows[0].tx_hash = null;
    await expect(listUnfundedBrailsWithdrawals()).resolves.toEqual(['brails_1']);
    expect(db.rpcCalls).toEqual([]);
    expect(db.rows[0].status).toBe('processing');
  });

  it('leaves a funded one off the list', async () => {
    seed();
    await expect(listUnfundedBrailsWithdrawals()).resolves.toEqual([]);
  });
});
