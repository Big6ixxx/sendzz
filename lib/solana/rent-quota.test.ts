import { describe, it, expect } from 'vitest';
import { reserveRent } from './rent-quota';

/** An atomic counter, as consume_rate_limit is: each call is one indivisible increment. */
function limiter(limit: number) {
  let used = 0;
  return async () => {
    await Promise.resolve();
    used += 1;
    return { allowed: used <= limit };
  };
}

describe('reserveRent', () => {
  it('grants what fits under the cap', async () => {
    expect(await reserveRent(2, limiter(10))).toBe(true);
  });

  it('needs nothing for a send that opens no accounts', async () => {
    expect(await reserveRent(0, limiter(0))).toBe(true);
  });

  it('cannot be overrun by parallel submits — the bug a peek-then-charge had', async () => {
    const consume = limiter(4);
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveRent(2, consume)));
    // Four units, two per send: at most two sends are funded, however many arrive at once.
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(2);
  });
});
