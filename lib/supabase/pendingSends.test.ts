import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: { pending_sends: [] as Row[], users: [] as Row[] } as Record<string, Row[]>,
}));

/** Just enough PostgREST for the reconciler's own tables: eq filters, select, delete. */
vi.mock('./adminClient', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let mode: 'select' | 'delete' = 'select';
      const result = () => {
        if (mode === 'delete') {
          db.tables[table] = db.tables[table].filter((r) => !filters.every((f) => f(r)));
          return { data: null, error: null };
        }
        return { data: db.tables[table].filter((r) => filters.every((f) => f(r))), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        delete: () => ((mode = 'delete'), q),
        order: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        limit: async () => result(),
        maybeSingle: async () => ({ data: result().data?.[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(result()),
      };
      return q;
    },
  },
}));

const ledger = vi.hoisted(() => ({
  recorded: false,
  recordedFor: null as string | null,
  outcome: 'inserted' as 'inserted' | 'existing' | 'merged',
  writes: [] as Record<string, unknown>[],
  checks: [] as Record<string, unknown>[],
}));
vi.mock('./transfer-row', () => ({
  alreadyRecorded: async (p: Record<string, unknown>) => (
    ledger.checks.push(p), ledger.recorded ? { id: 't0', recipientId: ledger.recordedFor } : null
  ),
  writeTransferRow: async (p: Record<string, unknown>) => (ledger.writes.push(p), { id: 't1', outcome: ledger.outcome }),
}));

const owner = vi.hoisted(() => ({ account: null as null | { id: string; email: string }, delivered: true }));
vi.mock('./address-owner', () => ({ accountForAddress: async () => owner.account }));
vi.mock('@/lib/web3/verify-send', () => ({ deliveredToAddress: async () => owner.delivered }));
const cleared = vi.hoisted(() => [] as string[][]);
vi.mock('./deposit-dedup', () => ({
  clearDuplicateDeposit: async (userId: string, hash: string) => void cleared.push([userId, hash]),
}));
vi.mock('@/lib/circle/gateway', () => ({ isEvmUsdcChain: () => false }));
vi.mock('@/lib/stellar/config', () => ({ STELLAR_HORIZON_URL: 'https://horizon.test' }));

const { reconcilePendingSends } = await import('./pendingSends');

const STELLAR = 'GCMG3EVLUQ5WXQKXHMHLTHXF7HJ4UK2T6MLU3YQRSCUKNQ5RFCPHPDS7';
const HASH = '557302a71c00000000000000000000000000000000000000000000000a47b58b2';

beforeEach(() => {
  owner.account = null;
  owner.delivered = true;
  ledger.recorded = false;
  ledger.recordedFor = null;
  cleared.length = 0;
  ledger.outcome = 'inserted';
  ledger.writes = [];
  ledger.checks = [];
  db.tables = {
    users: [],
    pending_sends: [
      {
        id: 'p1',
        user_id: 'u1',
        tx_hash: HASH,
        chain: 'stellar',
        sender_email: 'a@example.com',
        recipient: STELLAR,
        amount: 30,
        note: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  };
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ successful: true }), { status: 200 }));
});

describe('reconcilePendingSends', () => {
  it("looks the Stellar address up as stored, case kept, so it finds the app's row", async () => {
    // Lowercasing it here is what used to miss the app's row and record every Stellar send twice.
    ledger.recorded = true;

    const result = await reconcilePendingSends();

    expect(ledger.checks[0]).toMatchObject({ recipientEmail: STELLAR, legHashes: [HASH], appOnly: false });
    expect(result.recovered).toBe(0);
    expect(ledger.writes).toEqual([]);
    expect(db.tables.pending_sends).toEqual([]);
  });

  it('records a send the app missed as a recovery row, keeping the Stellar address as it is', async () => {
    const result = await reconcilePendingSends();

    expect(result.recovered).toBe(1);
    expect(ledger.writes).toEqual([
      expect.objectContaining({
        recipientEmail: STELLAR,
        txHash: HASH,
        legHashes: [HASH],
        sourceChain: 'stellar',
        recordedBy: 'recovery',
      }),
    ]);
    expect(db.tables.pending_sends).toEqual([]);
  });

  it('still clears a deposit the arrival was credited as when the row already exists', async () => {
    // The scanner can credit the arrival between the app's write and this run.
    ledger.recorded = true;
    ledger.recordedFor = 'u2';
    await reconcilePendingSends();
    expect(cleared).toEqual([['u2', HASH]]);
  });

  it("counts nothing recovered when the app's row landed first after all", async () => {
    ledger.outcome = 'existing';
    const result = await reconcilePendingSends();
    expect(result.recovered).toBe(0);
    expect(db.tables.pending_sends).toEqual([]);
  });
});

describe('reconcilePendingSends, sends to a Sendzz wallet', () => {
  it('links the transfer to the account that owns the address', async () => {
    owner.account = { id: 'u2', email: 'bola@example.com' };
    await reconcilePendingSends();
    expect(ledger.writes[0]).toMatchObject({ recipientId: 'u2' });
  });

  it('does not link it when the chain shows the money went somewhere else', async () => {
    // The intent's recipient comes from the browser; a real send paid elsewhere must not be
    // written into another user's history.
    owner.account = { id: 'u2', email: 'bola@example.com' };
    owner.delivered = false;
    await reconcilePendingSends();
    expect(ledger.writes[0]).toMatchObject({ recipientId: null });
  });
});
