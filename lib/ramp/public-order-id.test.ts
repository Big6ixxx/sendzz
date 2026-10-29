import { describe, expect, it } from 'vitest';
import { buildReceiptRows, receiptShortId } from '@/lib/receipt/template';
import { publicOrderId } from './public-order-id';

describe('publicOrderId', () => {
  it('leaves only the number of a Brails order', () => {
    expect(publicOrderId('brails_1787262387835_k3x9qa')).toBe('1787262387835');
  });

  it('drops any other leading provider name, and keeps every other id as it is', () => {
    expect(publicOrderId('bitnob_abc123')).toBe('abc123');
    expect(publicOrderId('Paycrest-77')).toBe('77');
    expect(publicOrderId('offramp_1787262387835')).toBe('offramp_1787262387835');
    expect(publicOrderId('0f9a2c1e-7b1d-4d2a-9a51-1c2b3d4e5f60')).toBe('0f9a2c1e-7b1d-4d2a-9a51-1c2b3d4e5f60');
  });

  it('keeps provider names off the receipt', () => {
    const rows = buildReceiptRows({
      id: 'brails_1787262387835_k3x9qa',
      orderId: 'brails_1787262387835_k3x9qa',
      type: 'withdrawal',
      status: 'completed',
      timestamp: '2026-10-29T10:00:00Z',
      amountUsdc: 10,
    } as never);
    expect(JSON.stringify(rows)).not.toMatch(/brails|bitnob|paycrest/i);
    expect(Object.fromEntries(rows)['Order ID']).toBe('1787262387835');
  });

  it("gives two orders on the same day different receipt numbers", () => {
    expect(receiptShortId('1787262387835123456')).toBe('35123456');
    expect(receiptShortId('1787269999999654321')).toBe('99654321');
    expect(receiptShortId('brails_1787262387835_k3x9qa')).toBe('62387835');
    expect(receiptShortId('offramp_1787262387835')).toBe('62387835');
    expect(receiptShortId('0f9a2c1e-7b1d-4d2a-9a51-1c2b3d4e5f60')).toBe('0f9a2c1e');
  });

  it('leaves a new Brails order id, digits only, as it is', () => {
    expect(publicOrderId('1787262387835123456')).toBe('1787262387835123456');
  });
});
