import { describe, expect, it } from 'vitest';
import { buildReceiptRows } from './template';
import type { ReceiptData } from './types';

/**
 * A withdrawal receipt must say the same thing wherever it is produced.
 *
 * There are three: the downloadable PDF, the screen shown right after a withdrawal, and the
 * completion email. They each built their own field list, so the email arrived with six rows and
 * no blockchain hash, memo, bank or chain, while only the one reached from transaction history
 * was complete. `buildReceiptRows` is now the single source for all three — these tests pin the
 * fields that went missing, so a future edit cannot quietly drop them again.
 */
const withdrawal: ReceiptData = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  type: 'withdrawal',
  status: 'completed',
  timestamp: '2026-08-19T10:00:00.000Z',
  amountUsdc: 42,
  fiatCurrency: 'NGN',
  fiatPayoutAmount: 57958,
  exchangeRate: 1379.95,
  bankName: 'GTBank',
  bankAccount: '****4471',
  sourceChain: 'base',
  txHash: '0xabc123',
  note: 'rent August',
  orderId: 'offramp_1755600000000',
};

const labels = (data: ReceiptData) => buildReceiptRows(data).map(([label]) => label);
const valueOf = (data: ReceiptData, label: string) =>
  buildReceiptRows(data).find(([l]) => l === label)?.[1];

describe('buildReceiptRows — withdrawal', () => {
  it('includes every field the thin receipts used to drop', () => {
    expect(labels(withdrawal)).toEqual(
      expect.arrayContaining([
        'Blockchain TX',
        'Reference / Memo',
        'Bank',
        'Source Chain',
        'Order ID',
        'Payout Amount',
        'Exchange Rate',
      ]),
    );
  });

  it('reports the payout the recipient receives, not the USDC sold', () => {
    expect(valueOf(withdrawal, 'Payout Amount')).toBe('57,958 NGN');
  });

  it('keeps the order reference and the chain hash in separate rows', () => {
    // These were the same value once: `orderId` was populated from `txHash`, so the hash was
    // printed twice and the order reference never appeared at all.
    expect(valueOf(withdrawal, 'Order ID')).toBe('offramp_1755600000000');
    expect(valueOf(withdrawal, 'Blockchain TX')).toBe('0xabc123');
  });

  it('omits rows it has no data for rather than inventing them', () => {
    const sparse: ReceiptData = {
      id: withdrawal.id,
      type: 'withdrawal',
      status: 'completed',
      timestamp: withdrawal.timestamp,
      amountUsdc: 42,
    };
    const got = labels(sparse);
    expect(got).not.toContain('Exchange Rate');
    expect(got).not.toContain('Blockchain TX');
    expect(got).not.toContain('Reference / Memo');
    // The identifying rows always survive.
    expect(got).toEqual(['Reference ID', 'Transaction Receipt']);
  });
});
