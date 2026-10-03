import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Which chain a deposit settles on is a question with a real answer, and not one the user can
 * give. Liquidity is quoted per chain AND per size, so the chain that can fill THIS order is
 * found by asking rather than assumed to be Base.
 */

const getRates = vi.fn();

vi.mock('./providers/paycrest', () => ({
  PaycrestProvider: class {
    name = 'paycrest';
    capabilities = { onRamp: true, offRamp: true, institutions: true, rates: true };
    getRates = getRates;
  },
}));
vi.mock('./providers/bitnob', () => ({
  BitnobProvider: class {
    name = 'bitnob';
    capabilities = { onRamp: true, offRamp: true, institutions: true, rates: true };
    getRates = getRates;
  },
}));

const quoted = { data: { buy: { rate: 1354, provider_id: 'p' }, sell: { rate: 1354, provider_id: 'p' } } };
/** Paycrest omits `buy` entirely for a size nobody is quoting on that chain. */
const notQuoted = { data: { sell: { rate: 1354, provider_id: 'p' } } };

beforeEach(() => {
  vi.resetModules();
  getRates.mockReset();
});

async function pick(amount: number, currency = 'NGN') {
  const { Ramp } = await import('./index');
  return Ramp.pickDepositNetwork(amount, currency);
}

describe('pickDepositNetwork', () => {
  it('takes the first chain that quotes this amount', async () => {
    getRates.mockResolvedValue(quoted);
    expect(await pick(20)).toBe('base');
  });

  it('moves on when the preferred chain is not quoting', async () => {
    // The whole point: Base being quiet no longer means the deposit is refused.
    getRates.mockResolvedValueOnce(notQuoted).mockResolvedValueOnce(quoted);
    expect(await pick(100)).toBe('polygon');
  });

  it('reaches the third chain when the first two are quiet', async () => {
    getRates
      .mockResolvedValueOnce(notQuoted)
      .mockResolvedValueOnce(notQuoted)
      .mockResolvedValueOnce(quoted);
    expect(await pick(100)).toBe('arbitrum');
  });

  it('asks each chain by name', async () => {
    getRates.mockResolvedValue(notQuoted);
    await pick(50);
    expect(getRates.mock.calls.map((c) => c[2])).toEqual(['base', 'polygon', 'arbitrum']);
  });

  it('falls back to the first chain when none answer', async () => {
    // Attempt it anyway: the provider's own refusal is a better explanation than ours.
    getRates.mockResolvedValue(notQuoted);
    expect(await pick(5000)).toBe('base');
  });

  it('keeps looking when a chain throws rather than answering', async () => {
    // Two rejections for base, because withFallback retries the second provider before giving
    // up on a chain — a single reject is absorbed there and never reaches the chain loop.
    getRates
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(quoted);
    expect(await pick(100)).toBe('polygon');
  });
});
