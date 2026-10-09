import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('server-only', () => ({}));

const rpc = vi.fn();
let row: Record<string, unknown> | null = null;
const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

vi.mock('@/lib/supabase/adminClient', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }),
      update,
    }),
  },
}));

const { paycrestRefundHash, recordPaycrestRefund } = await import('./provider-refund');

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  update.mockClear();
  row = null;
});

describe('paycrestRefundHash', () => {
  it('takes the refund entry from the order log', () => {
    const order = { transactions: [
      { status: 'crypto_deposited', txHash: '0xdeposit' },
      { status: 'order_refunded', txHash: '0xrefund' },
    ] };
    expect(paycrestRefundHash(order)).toBe('0xrefund');
  });

  it('never mistakes the deposit hash for the refund', () => {
    expect(paycrestRefundHash({ txHash: '0xdeposit' })).toBeNull();
    expect(paycrestRefundHash({ transactions: [{ status: 'crypto_deposited', txHash: '0xdeposit' }] })).toBeNull();
  });
});

describe('recordPaycrestRefund settles the debt', () => {
  it('closes an owed refund with the refund hash', async () => {
    row = { id: 'w1', refund_owed_usdc: 10, refund_tx_hash: null };
    expect(await recordPaycrestRefund('ord', '0xrefund')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('finalize_withdrawal_refunded', { p_withdrawal_id: 'w1', p_refund_tx_hash: '0xrefund' });
  });

  it('names the provider as evidence when no hash is given', async () => {
    row = { id: 'w1', refund_owed_usdc: 10, refund_tx_hash: null };
    await recordPaycrestRefund('ord', null);
    expect(rpc).toHaveBeenCalledWith('finalize_withdrawal_refunded', { p_withdrawal_id: 'w1', p_refund_tx_hash: 'paycrest-refund:ord' });
  });

  it('does nothing twice', async () => {
    row = { id: 'w1', refund_owed_usdc: 10, refund_tx_hash: '0xrefund' };
    await recordPaycrestRefund('ord', '0xrefund');
    expect(rpc).not.toHaveBeenCalledWith('finalize_withdrawal_refunded', expect.anything());
  });

  it('settles nothing when nothing was owed', async () => {
    row = { id: 'w1', refund_owed_usdc: null, refund_tx_hash: null };
    await recordPaycrestRefund('ord', null);
    expect(rpc).not.toHaveBeenCalledWith('finalize_withdrawal_refunded', expect.anything());
    expect(update).toHaveBeenCalledWith({ status: 'reversed' });
  });
});

describe('every refunded path settles, and refunding is not final', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const webhook = read('app/api/webhook/paycrest/route.ts');
  const tx = read('lib/supabase/transactions.ts');

  it('the webhook records the refund and lets a late refunded through', () => {
    expect(webhook).toMatch(/recordPaycrestRefund\(orderId, paycrestRefundHash\(orderData\)\)/);
    expect(webhook).toMatch(/currentW\.status !== 'processing' && status !== 'refunded'/);
    expect(webhook).toMatch(/\['failed', 'refunded', 'expired'\]\.includes\(status\)\) \{\s*const reason/);
  });

  it('polling and the browser-called path both settle, the latter only after asking Paycrest', () => {
    expect(tx).toMatch(/statusLower === "refunded" && provider === "paycrest"/);
    expect(tx).toMatch(/const live = await getOrderStatus\(orderId, "paycrest"\);\s*if \(live\?\.status\?\.toLowerCase\(\) !== "refunded"\) return \{ ok: true \};/);
    expect(tx).not.toMatch(/\["refunded", "refunding"\]\.includes\(statusLower\)\s*\?/);
  });
});
