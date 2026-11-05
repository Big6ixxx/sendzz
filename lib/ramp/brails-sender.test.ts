import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const identity = vi.hoisted(() => ({ value: null as null | Record<string, string> }));
vi.mock('@/lib/kyc/verified-identity', () => ({ verifiedIdentityOf: async () => identity.value }));

const { brailsSenderFor, countryName } = await import('./brails-sender');

beforeEach(() => {
  identity.value = null;
});

describe('brailsSenderFor', () => {
  it("uses the address on the user's ID when it shows one", async () => {
    identity.value = { firstName: 'Ada', lastName: 'Obi', issuingState: 'NGA', address: '12 Allen Avenue, Ikeja, Lagos' };
    await expect(brailsSenderFor({ id: 'u1' })).resolves.toEqual({
      accountName: 'Ada Obi',
      country: 'NG',
      address: '12 Allen Avenue, Ikeja, Lagos',
    });
  });

  it("falls back to the sender's country name when the ID shows no address", async () => {
    identity.value = { firstName: 'Ada', lastName: 'Obi', issuingState: 'NGA' };
    await expect(brailsSenderFor({ id: 'u1' })).resolves.toMatchObject({ country: 'NG', address: 'Nigeria' });
  });

  it('has no sender for an unverified user', async () => {
    await expect(brailsSenderFor({ id: 'u1' })).resolves.toBeNull();
  });
});

describe('countryName', () => {
  it('names a country from its code', () => {
    expect(countryName('KE')).toBe('Kenya');
    expect(countryName('rw')).toBe('Rwanda');
  });
});
