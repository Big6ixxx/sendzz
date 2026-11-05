import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who Bitnob is told sent a mobile money payout. Bitnob uses the sender to locate them
 * (2026-11-05), so it must be the user's verified identity, not a stand-in.
 */

vi.mock('server-only', () => ({}));
const bitnob = vi.hoisted(() => ({
  initializePayout: vi.fn(),
  getSupportedCountries: vi.fn(),
}));
vi.mock('@/lib/bitnob/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBitnobClient: () => bitnob,
}));
const sender = vi.hoisted(() => ({ value: null as null | { accountName: string; country: string; address: string }, fails: false }));
vi.mock('../ramp/brails-sender', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  brailsSenderFor: async () => {
    if (sender.fails) throw new Error('Didit down');
    return sender.value;
  },
}));
vi.mock('@/lib/kyc/verified-identity', () => ({ verifiedIdentityOf: async () => null }));

const { BitnobProvider } = await import('./providers/bitnob');

const rwanda = {
  quoteId: 'q1',
  reference: 'r1',
  fiatCurrency: 'RWF',
  userEmail: 'ada.obi@example.com',
  bank: { accountNumber: '0781234567', accountName: 'Jean Uwase', bankCode: 'MTNRWF' },
  payoutCountry: 'RW',
};
const sent = () => bitnob.initializePayout.mock.calls[0][1].beneficiary.sender;

beforeEach(() => {
  vi.clearAllMocks();
  sender.value = null;
  sender.fails = false;
  bitnob.getSupportedCountries.mockResolvedValue({
    countries: [{ code: 'RW', corridors: [{ currency: 'RWF', destination_types: ['mobile_money'] }] }],
  });
  bitnob.initializePayout.mockResolvedValue({});
});

describe('Bitnob mobile money sender', () => {
  it("sends the user's verified name, country and address", async () => {
    sender.value = { accountName: 'Ada Obi', country: 'NG', address: 'Nigeria' };
    await new BitnobProvider().initializeDeferredPayout(rwanda as never);
    expect(sent()).toEqual({ account_name: 'Ada Obi', country: 'NG', address: 'Nigeria' });
  });

  it('keeps paying, with the stand-in, when the identity cannot be read', async () => {
    sender.fails = true;
    await new BitnobProvider().initializeDeferredPayout(rwanda as never);
    expect(sent()).toEqual({ account_name: 'ada.obi', country: 'RW', address: 'Rwanda' });
  });
});
