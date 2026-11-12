import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const db = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as null | { code?: string; message: string } },
  rpcArgs: [] as Record<string, unknown>[],
  existing: [] as { id: string }[],
  inserted: [] as Record<string, unknown>[],
}));

vi.mock('./adminClient', () => ({
  supabaseAdmin: {
    rpc: async (_name: string, args: Record<string, unknown>) => (db.rpcArgs.push(args), db.rpc),
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        overlaps: () => q,
        limit: async () => ({ data: db.existing, error: null }),
        insert: (row: Record<string, unknown>) => (db.inserted.push(row), q),
        single: async () => ({ data: { id: 'new' }, error: null }),
      };
      return q;
    },
  },
}));

const { writeTransferRow } = await import('./transfer-row');

const input = {
  senderId: 'u1',
  senderEmail: 'a@example.com',
  recipientId: null,
  recipientEmail: 'bola@example.com',
  amount: 30,
  status: 'completed' as const,
  note: null,
  txHash: '0xbase',
  sourceChain: 'base',
  legHashes: ['0xbase', '0xpoly'],
  recordedBy: 'app' as const,
};

beforeEach(() => {
  db.rpc = { data: [{ transfer_id: 't1', outcome: 'merged' }], error: null };
  db.rpcArgs = [];
  db.existing = [];
  db.inserted = [];
});

describe('writeTransferRow', () => {
  it('writes through record_transfer with every leg hash', async () => {
    await expect(writeTransferRow(input)).resolves.toEqual({ id: 't1', outcome: 'merged' });
    expect(db.rpcArgs[0]).toMatchObject({ p_leg_hashes: ['0xbase', '0xpoly'], p_recorded_by: 'app' });
    expect(db.inserted).toEqual([]);
  });

  it('still records the send the old way before migration 066 is applied', async () => {
    db.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.record_transfer' } };
    await expect(writeTransferRow(input)).resolves.toEqual({ id: 'new', outcome: 'inserted' });
    expect(db.inserted[0]).toMatchObject({ tx_hash: '0xbase', amount: 30, source_chain: 'base' });
  });

  it('does not write twice the old way either', async () => {
    db.rpc = { data: null, error: { code: 'PGRST202', message: 'missing' } };
    db.existing = [{ id: 'old' }];
    await expect(writeTransferRow(input)).resolves.toEqual({ id: 'old', outcome: 'existing' });
    expect(db.inserted).toEqual([]);
  });

  it('is null, and writes nothing, when record_transfer fails for any other reason', async () => {
    db.rpc = { data: null, error: { code: '23514', message: 'check constraint' } };
    await expect(writeTransferRow(input)).resolves.toBeNull();
    expect(db.inserted).toEqual([]);
  });
});
