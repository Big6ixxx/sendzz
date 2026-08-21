import { describe, expect, it } from 'vitest';
import { buildReceiptRows, receiptBodyMarkup } from './template';
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

/**
 * The downloadable receipt leads with what actually landed in the bank.
 *
 * Its headline used to read "$42.00 USDC", which is the funding amount, not the thing the
 * person holding the receipt cares about. It now leads with the payout in their own currency,
 * and drops the "Payout Amount" row so one page does not state the same figure twice.
 *
 * This applies to the PDF ONLY. `buildReceiptRows` still carries the row, so the email and the
 * in-app view are untouched.
 */
describe('receiptBodyMarkup — downloadable receipt headline', () => {
  const html = (data: ReceiptData) => receiptBodyMarkup(data, 'logo.png');

  it('leads with the fiat payout, not the USDC amount', () => {
    const out = html(withdrawal);
    expect(out).toContain('57,958.00 NGN');
    expect(out).not.toContain('$42.00 USDC');
  });

  it('drops the Payout Amount row, since the headline already states it', () => {
    expect(html(withdrawal)).not.toContain('Payout Amount');
  });

  it('leaves the shared rows alone, so the email still shows Payout Amount', () => {
    // The regression to guard against: "fix the PDF" quietly stripping the row everywhere.
    expect(labels(withdrawal)).toContain('Payout Amount');
    expect(valueOf(withdrawal, 'Payout Amount')).toBe('57,958 NGN');
  });

  it('keeps every other row on the receipt', () => {
    const out = html(withdrawal);
    for (const label of ['Exchange Rate', 'Bank', 'Account', 'Source Chain', 'Reference ID']) {
      expect(out, label).toContain(label);
    }
  });

  it('still leads with USDC when there is no fiat payout', () => {
    // Sends and bridges have no payout figure, so USDC is the only amount they have.
    const transfer: ReceiptData = {
      id: withdrawal.id,
      type: 'sent',
      status: 'completed',
      timestamp: withdrawal.timestamp,
      amountUsdc: 42,
    };
    expect(html(transfer)).toContain('$42.00 USDC');
  });

  it('prints no prefix for a currency we have no symbol for, just the code', () => {
    // Falling back to the code would print it twice: "ZAR57,958.00 ZAR".
    const out = html({ ...withdrawal, fiatCurrency: 'ZAR' });
    expect(out).toContain('57,958.00 ZAR');
    expect(out).not.toContain('ZAR57,958.00');
  });

  it('prints no prefix for letter abbreviations either', () => {
    // "FRw14,222.21 RWF" reads as noise, not as a currency mark. The code alone is cleaner.
    for (const [code, abbrev] of [
      ['RWF', 'FRw'],
      ['KES', 'KSh'],
      ['UGX', 'USh'],
      ['XOF', 'CFA'],
      ['XAF', 'FCFA'],
    ]) {
      const out = html({ ...withdrawal, fiatCurrency: code });
      expect(out, code).toContain(`57,958.00 ${code}`);
      expect(out, code).not.toContain(`${abbrev}57,958.00`);
    }
  });

  it('still prints a real symbol where one exists', () => {
    expect(html(withdrawal)).toContain('₦57,958.00 NGN');
    expect(html({ ...withdrawal, fiatCurrency: 'GHS' })).toContain('GH₵57,958.00 GHS');
    expect(html({ ...withdrawal, fiatCurrency: 'BRL' })).toContain('R$57,958.00 BRL');
  });

  it('falls back to USDC when a currency is missing its amount', () => {
    const partial: ReceiptData = { ...withdrawal, fiatPayoutAmount: undefined };
    expect(html(partial)).toContain('$42.00 USDC');
  });
});
