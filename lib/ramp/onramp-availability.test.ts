import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A corridor is not open or closed — it is quoted at some sizes and not others.
 *
 * Paycrest answers NGN at 20 USDC and goes quiet at 30, while remaining open for business
 * throughout. The old check probed a fixed 100, got no `buy` rate, and told the user "NGN
 * deposits are paused" — sending them away from a corridor that would have taken their money.
 */

const getRates = vi.fn();

vi.mock('./providers/paycrest', () => ({
  PaycrestProvider: class {
    name = 'paycrest';
    capabilities = { onRamp: true, offRamp: true, institutions: true };
    getRates = getRates;
  },
}));
vi.mock('./providers/bitnob', () => ({
  BitnobProvider: class {
    name = 'bitnob';
    capabilities = { onRamp: true, offRamp: true, institutions: true };
    getRates = getRates;
  },
}));

/** Paycrest omits the key entirely for a size nobody is quoting. */
const quoted = { data: { buy: { rate: 1354, provider_id: 'p' }, sell: { rate: 1354, provider_id: 'p' } } };
const notQuoted = { data: { sell: { rate: 1354, provider_id: 'p' } } };

beforeEach(() => {
  vi.resetModules();
  getRates.mockReset();
});

async function check(currency: string, amount?: number) {
  const { Ramp } = await import('./index');
  return Ramp.isOnRampAvailable(currency, amount);
}

describe('on-ramp availability is asked per size', () => {
  it('asks about the amount it was given', async () => {
    getRates.mockResolvedValue(quoted);
    await check('NGN', 20);
    expect(getRates).toHaveBeenCalledWith(20, 'NGN');
  });

  it('probes small when no amount is known', async () => {
    // With nothing typed the only answerable question is "is this corridor alive at all", and
    // the smallest probe is the one most likely to be quoted.
    getRates.mockResolvedValue(quoted);
    await check('NGN');
    expect(getRates.mock.calls[0][0]).toBeLessThanOrEqual(1);
  });

  it('rounds a fractional amount UP, so a pass is never optimistic', async () => {
    getRates.mockResolvedValue(quoted);
    await check('NGN', 12.3456);
    expect(getRates).toHaveBeenCalledWith(13, 'NGN');
  });

  it('reports unavailable only for the size that is not quoted', async () => {
    getRates.mockResolvedValueOnce(quoted);
    expect(await check('NGN', 20)).toBe(true);

    getRates.mockResolvedValueOnce(notQuoted);
    expect(await check('NGN', 100)).toBe(false);
  });

  it('fails open when the provider cannot be reached', async () => {
    // Our own outage is not a closed corridor, and blocking a deposit on it is the worse error.
    getRates.mockRejectedValue(new Error('network'));
    expect(await check('NGN', 50)).toBe(true);
  });
});
