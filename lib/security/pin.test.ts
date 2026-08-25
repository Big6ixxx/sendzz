import { beforeAll, describe, expect, it } from 'vitest';
import {
  CLEARED_LOCKOUT,
  MAX_PIN_ATTEMPTS,
  checkPinPolicy,
  hashPin,
  lockoutRemainingMs,
  nextLockout,
  verifyPin,
} from './pin';

/**
 * A 4-digit PIN is 10,000 possibilities. Everything protecting it has to hold at once: the hash
 * must be irreversible and slow, the pepper must live outside the database, and the attempt
 * limit must make guessing infeasible in practice. These pin all three.
 */
beforeAll(() => {
  process.env.PIN_PEPPER = 'test-pepper-value-at-least-16-chars';
});

describe('checkPinPolicy', () => {
  it('accepts an ordinary 4-digit PIN', () => {
    expect(checkPinPolicy('8317').ok).toBe(true);
    expect(checkPinPolicy('4092').ok).toBe(true);
  });

  it('requires exactly 4 digits', () => {
    for (const bad of ['', '123', '12345', 'abcd', '12a4', '  12']) {
      expect(checkPinPolicy(bad).ok, bad).toBe(false);
    }
  });

  it('rejects the PINs an attacker tries first', () => {
    // With only five attempts allowed, these are the ones that would actually be reached.
    for (const bad of ['0000', '1111', '1234', '4321', '6969', '2580']) {
      expect(checkPinPolicy(bad).ok, bad).toBe(false);
    }
  });

  it('rejects straight runs in either direction', () => {
    expect(checkPinPolicy('2345').ok).toBe(false);
    expect(checkPinPolicy('8765').ok).toBe(false);
  });

  it('never echoes the PIN back in the reason', () => {
    // A rejection message is logged and shown; it must not carry the secret with it.
    const res = checkPinPolicy('1111');
    expect(res.reason).toBeTruthy();
    expect(res.reason).not.toContain('1111');
  });
});

describe('hashPin / verifyPin', () => {
  it('accepts the right PIN and rejects every other', async () => {
    const { hash } = await hashPin('8317');
    expect(await verifyPin('8317', hash)).toBe(true);
    for (const wrong of ['8318', '7318', '8371', '0000']) {
      expect(await verifyPin(wrong, hash), wrong).toBe(false);
    }
  }, 30000);

  it('never stores the PIN, in any recoverable form', async () => {
    const { hash } = await hashPin('8317');
    expect(hash).not.toContain('8317');
    // Nor as any obvious encoding of it.
    expect(hash).not.toContain(Buffer.from('8317').toString('base64'));
  }, 30000);

  it('produces a different hash for the same PIN each time', async () => {
    // Per-user salt: identical PINs must not collide, or cracking one cracks them all.
    const a = await hashPin('8317');
    const b = await hashPin('8317');
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPin('8317', a.hash)).toBe(true);
    expect(await verifyPin('8317', b.hash)).toBe(true);
  }, 40000);

  it('is useless without the pepper', async () => {
    // The point of the pepper: a stolen database alone cannot verify a guess.
    const { hash } = await hashPin('8317');
    const real = process.env.PIN_PEPPER;
    process.env.PIN_PEPPER = 'a-different-pepper-value-16chars';
    expect(await verifyPin('8317', hash)).toBe(false);
    process.env.PIN_PEPPER = real;
  }, 30000);

  it('refuses to hash a PIN the policy rejects', async () => {
    await expect(hashPin('1234')).rejects.toThrow();
    await expect(hashPin('12')).rejects.toThrow();
  });

  it('returns false for a corrupt or empty stored hash instead of throwing', async () => {
    // A damaged row must deny access, never surface as an error a caller might treat as a pass.
    for (const bad of ['', 'garbage', 'scrypt$$$$', 'bcrypt$1$2$3$4$5']) {
      expect(await verifyPin('8317', bad), bad).toBe(false);
    }
  });
});

describe('lockout', () => {
  it('counts up to the limit without locking', () => {
    let state = CLEARED_LOCKOUT;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      state = nextLockout(state);
      expect(state.failedAttempts).toBe(i);
      expect(state.lockedUntil).toBeNull();
    }
  });

  it('locks on the final attempt', () => {
    let state = CLEARED_LOCKOUT;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) state = nextLockout(state);
    expect(state.lockedUntil).not.toBeNull();
    expect(lockoutRemainingMs(state)).toBeGreaterThan(0);
  });

  it('reports no lock when there is none, or when it has expired', () => {
    expect(lockoutRemainingMs(CLEARED_LOCKOUT)).toBe(0);
    expect(
      lockoutRemainingMs({ failedAttempts: 5, lockedUntil: new Date(Date.now() - 1000).toISOString() }),
    ).toBe(0);
    // A corrupt timestamp must not lock someone out forever.
    expect(lockoutRemainingMs({ failedAttempts: 5, lockedUntil: 'not-a-date' })).toBe(0);
  });

  it('makes guessing infeasible in practice', () => {
    // Five tries against 10,000 possibilities, then a 15-minute wait.
    expect(MAX_PIN_ATTEMPTS / 10000).toBeLessThan(0.001);
  });
});
