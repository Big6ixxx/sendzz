import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A refusal only the user can fix (a refund account in someone else's name) must reach them.
 * Retried on the fallback provider, it came back as that provider's "not supported" instead.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('a provider refusal is not retried elsewhere', () => {
  it('passes straight through the fallback', () => {
    expect(read('lib/ramp/index.ts')).toMatch(/if \(err instanceof RampRefusedError\) throw err;/);
  });

  it('is what Paycrest raises for a refund account in another name', () => {
    expect(read('lib/paycrest/client.ts')).toMatch(/throw new RampRefusedError\('The refund account must be in your own name/);
  });
});
