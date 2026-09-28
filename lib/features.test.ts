import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The switch defaults to OFF, and only one spelling turns it on.
 *
 * Which direction a missing value falls is the whole point. A feature that is hidden when it
 * should be visible is a bug someone reports; a feature that is visible when it should be
 * hidden has already been shown to everybody. So anything that is not exactly "true" — unset,
 * empty, "false", "1", "TRUE" — leaves it closed.
 *
 * `referralsEnabled` reads process.env at call time rather than at module load, which is what
 * lets this be tested at all. In a build it is inlined and constant either way.
 */
describe('referralsEnabled', () => {
  const set = (v: string | undefined) => {
    if (v === undefined) delete process.env.NEXT_PUBLIC_REFERRALS_ENABLED;
    else process.env.NEXT_PUBLIC_REFERRALS_ENABLED = v;
    vi.resetModules();
    return import('./features');
  };

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_REFERRALS_ENABLED;
    vi.resetModules();
  });

  it('is on for exactly "true"', async () => {
    const { referralsEnabled } = await set('true');
    expect(referralsEnabled()).toBe(true);
  });

  it.each([undefined, '', 'false', 'FALSE', 'TRUE', 'True', '1', 'yes', ' true '])(
    'is off for %j',
    async (value) => {
      const { referralsEnabled } = await set(value);
      expect(referralsEnabled()).toBe(false);
    },
  );
});
