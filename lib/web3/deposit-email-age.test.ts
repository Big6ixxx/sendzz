import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A deposit found long after it landed (a backfilled address, a first scan of an old wallet) is
 * recorded without an email: announcing it now would tell the user about money from days ago.
 */
const sendDepositEmail = vi.fn(async () => {});
let inserted: { id: string; user_id: string; amount_usdc: number; tx_hash: string; network: string; created_at: string }[] = [];

vi.mock('@/lib/email/sendEmail', () => ({ sendDepositEmail }));
vi.mock('@/lib/supabase/adminClient', () => ({
  supabaseAdmin: {
    from: (table: string) =>
      table === 'deposits'
        ? { upsert: () => ({ select: async () => ({ data: inserted, error: null }) }) }
        : { select: () => ({ eq: () => ({ single: async () => ({ data: { email: 'user@example.com' } }) }) }) },
  },
}));

const { insertDeposits } = await import('./deposit-scanner');

const row = (id: string, ageMs: number) => ({
  id,
  user_id: 'u1',
  amount_usdc: 1,
  tx_hash: `hash-${id}`,
  network: 'solana',
  created_at: new Date(Date.now() - ageMs).toISOString(),
});

describe('deposit emails', () => {
  beforeEach(() => sendDepositEmail.mockClear());

  it('emails an arrival from the last day', async () => {
    inserted = [row('new', 60_000)];
    await insertDeposits([{} as never]);
    expect(sendDepositEmail).toHaveBeenCalledTimes(1);
  });

  it('records an older arrival without emailing', async () => {
    inserted = [row('old', 3 * 24 * 60 * 60 * 1000), row('new', 60_000)];
    await expect(insertDeposits([{} as never])).resolves.toBe(2);
    expect(sendDepositEmail).toHaveBeenCalledTimes(1);
    expect(sendDepositEmail.mock.calls[0]).toContain('hash-new');
  });
});
