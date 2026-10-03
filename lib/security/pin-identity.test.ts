import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A PIN must be found by whoever stored it, and "I don't know" must never read as "no PIN".
 *
 * Both halves failed at once. The PIN was written keyed on `id` and read keyed on `email`, so a
 * profile row whose address differed by capitalisation stored the PIN in one row and looked for
 * it in another. And the status endpoint caught every error — including an unverified token,
 * which is the normal state in the instant a page loads — and answered `{ enabled: false }` with
 * a 200. The client only retries on a non-OK status, so it took that as truth and showed the
 * first-time setup screen to people who had held a PIN for months.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const route = read('app/api/2fa/pin/route.ts');
const gate = read('components/security/PinRequiredGate.tsx');

describe('every PIN lookup is keyed the way the PIN is stored', () => {
  it('never reads or writes user_profiles by email', () => {
    // The write has always used `id`. Anything keyed on email is looking in a different row.
    expect(route).not.toMatch(/eq\("email", email\)/);
  });

  it('keys the status endpoint on id', () => {
    const get = route.slice(route.indexOf('export async function GET'));
    expect(get).toMatch(/eq\("id", userId\)/);
  });

  it('upserts on reset rather than updating', () => {
    // An UPDATE matching no row is a successful statement that changes nothing, so a reset
    // reported success and left the old PIN in place.
    const reset = route.slice(route.indexOf('action === "reset"'));
    const body = reset.slice(0, reset.indexOf('action === "remove"'));
    expect(body).toMatch(/\.upsert\(/);
    expect(body).not.toMatch(/\.update\(\{[\s\S]{0,400}pin_hash: hash/);
  });
});

describe('the status endpoint never guesses', () => {
  it('answers 401 when it cannot tell who is asking', () => {
    const get = route.slice(route.indexOf('export async function GET'));
    expect(get).toMatch(/status: 401/);
  });

  it('does not report enabled:false from a catch', () => {
    // The whole defect in one line: a thrown auth error became a confident "no PIN".
    const get = route.slice(route.indexOf('export async function GET'));
    expect(get).not.toMatch(/catch[\s\S]{0,120}enabled: false/);
  });

  it('surfaces a failed lookup as an error, not as no-PIN', () => {
    const get = route.slice(route.indexOf('export async function GET'));
    expect(get).toMatch(/if \(error\)[\s\S]{0,200}status: 500/);
  });
});

describe('an already-set PIN is not reported as a wrong PIN', () => {
  it('answers 409 with a code when no current PIN was offered', () => {
    // Telling someone mid-setup that their PIN is "not your current PIN" is the most confusing
    // reply available — they were never asked for one.
    expect(route).toMatch(/code: "pin_already_set"/);
    expect(route).toMatch(/status: 409/);
  });
});

describe('the client rides out a token that has not refreshed yet', () => {
  it('keeps the gate shut until a real answer arrives', () => {
    // null means unknown, and unknown must not open the setup prompt.
    expect(gate).toMatch(/useState<boolean \| null>\(null\)/);
  });

  it('retries rather than accepting the first failure', () => {
    expect(gate).toMatch(/attempt >= 5/);
  });
});
