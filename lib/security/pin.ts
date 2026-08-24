import crypto from "node:crypto";

/**
 * Storing a 4-digit PIN so that nobody — including us — can read it back.
 *
 * Be honest about what a 4-digit PIN is: 10,000 possibilities. Anything reversible, and anything
 * fast to compute, is broken the moment the database is copied. So three things have to be true
 * at once, and all three are needed:
 *
 *   1. It is HASHED, never encrypted. Encryption implies a key that can undo it; we never want
 *      to be able to undo it, and an admin holding the key would be able to.
 *
 *   2. The hash is SLOW and SALTED per user. scrypt with these parameters costs ~100ms and 64MB
 *      per guess, so all 10,000 candidates for one user cost real time and memory rather than
 *      microseconds. A unique salt means cracking one user teaches you nothing about the next.
 *
 *   3. A PEPPER lives outside the database, in the environment. Someone holding a database dump
 *      alone — a leaked backup, a curious admin with read access — cannot even begin, because
 *      the input they would be hashing is missing a secret they do not have.
 *
 * What this does NOT survive: someone holding the database AND the server environment could
 * grind 10,000 candidates. Four digits cannot be made strong enough for that on their own,
 * which is why the PIN is a second factor rather than the only one, and why the attempt limit
 * below matters as much as the hashing.
 */

/** Deliberately expensive. Raising this is safe; existing hashes carry their own parameters. */
const SCRYPT_COST = 1 << 15; // N — CPU/memory cost
const SCRYPT_BLOCK = 8; // r
const SCRYPT_PARALLEL = 1; // p
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * 1024 * 1024; // headroom for N=32768, r=8

/** Attempts before the PIN locks. Low, because 10,000 candidates is not many. */
export const MAX_PIN_ATTEMPTS = 5;
/** How long a locked PIN stays locked. Internal — callers read the remaining time instead. */
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * PINs that are guessed first.
 *
 * An attacker limited to five tries does not try randomly — they try these. Refusing them
 * removes the handful of values that a limited number of guesses would actually reach.
 */
const BANNED_PINS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "0123", "3210", "1212", "2121", "1122", "6969", "1004", "2000",
  "1010", "0101", "1313", "2580", "0852", "1379", "9731", "1230", "0987",
]);

export interface PinPolicyResult {
  ok: boolean;
  /** Safe to show the user; never echoes the PIN itself. */
  reason?: string;
}

/** Is this PIN acceptable to set? Shape first, then the values everyone tries. */
export function checkPinPolicy(pin: string): PinPolicyResult {
  if (!/^\d{4}$/.test(pin ?? "")) {
    return { ok: false, reason: "Your PIN must be exactly 4 digits." };
  }
  if (BANNED_PINS.has(pin)) {
    return {
      ok: false,
      reason: "That PIN is one of the first anyone would try. Pick a less obvious one.",
    };
  }
  // Runs of consecutive digits, ascending or descending: 2345, 8765.
  const digits = pin.split("").map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) {
    return { ok: false, reason: "Avoid PINs in a straight run, like 2345." };
  }
  return { ok: true };
}

/**
 * The secret that never leaves the environment. Without it a stolen database is not enough
 * to start guessing, so a missing pepper is a hard failure rather than a silent downgrade.
 */
function pepper(): string {
  const value = process.env.PIN_PEPPER;
  if (!value || value.length < 16) {
    throw new Error(
      "PIN_PEPPER is not configured (needs at least 16 characters). Refusing to hash a PIN without it.",
    );
  }
  return value;
}

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      `${pin}${pepper()}`,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK, p: SCRYPT_PARALLEL, maxmem: MAX_MEMORY },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export interface HashedPin {
  /** `scrypt$N$r$p$salt$hash`, all base64 — self-describing so parameters can change later. */
  hash: string;
}

export async function hashPin(pin: string): Promise<HashedPin> {
  const policy = checkPinPolicy(pin);
  if (!policy.ok) throw new Error(policy.reason);

  const salt = crypto.randomBytes(32);
  const key = await derive(pin, salt);
  return {
    hash: [
      "scrypt",
      SCRYPT_COST,
      SCRYPT_BLOCK,
      SCRYPT_PARALLEL,
      salt.toString("base64"),
      key.toString("base64"),
    ].join("$"),
  };
}

/**
 * Check a PIN against a stored hash.
 *
 * Compared in constant time: a comparison that returns early leaks how much of the hash matched,
 * which over enough attempts is enough to reconstruct it.
 *
 * Returns false for anything malformed rather than throwing, so a corrupt row denies access
 * instead of crashing a verification endpoint into an error the caller might treat as a pass.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  try {
    if (!pin || !stored) return false;
    const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");

    const key = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(
        `${pin}${pepper()}`,
        salt,
        expected.length,
        { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEMORY },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
    });

    if (key.length !== expected.length) return false;
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: string | null;
}

/** Is this PIN locked right now, and for how much longer? */
export function lockoutRemainingMs(state: LockoutState, now = Date.now()): number {
  if (!state.lockedUntil) return 0;
  const until = Date.parse(state.lockedUntil);
  if (Number.isNaN(until)) return 0;
  return Math.max(0, until - now);
}

/**
 * What the stored lockout becomes after one more wrong PIN.
 *
 * The counter is what makes a 4-digit secret defensible at all: five tries against 10,000
 * possibilities is a 0.05% chance, and the lock resets the moment a correct PIN is entered.
 */
export function nextLockout(state: LockoutState, now = Date.now()): LockoutState {
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts < MAX_PIN_ATTEMPTS) {
    return { failedAttempts, lockedUntil: state.lockedUntil };
  }
  return {
    failedAttempts: 0,
    lockedUntil: new Date(now + PIN_LOCKOUT_MS).toISOString(),
  };
}

/** Cleared on success, so a user who mistypes twice and then succeeds starts fresh. */
export const CLEARED_LOCKOUT: LockoutState = { failedAttempts: 0, lockedUntil: null };
