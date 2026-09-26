import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A user with no PIN must never be left retyping one at the point of paying.
 *
 * What happened in production: the setup gate on the dashboard did not appear, so people
 * reached a payment with no PIN set. The authorize endpoint refused them — correctly — and
 * the confirmation sheet rendered that refusal the same way it renders a wrong PIN: an error
 * under four empty boxes. There was no route from there to the screen that would have fixed
 * it, so the only way out was to give up.
 *
 * Both halves of the contract are asserted here, because either one alone restores the dead
 * end. The server has to say WHICH kind of refusal this is in a form code can branch on, and
 * the client has to branch on it.
 *
 * Read as source rather than executed: the server half lives in a route module that pulls in
 * Supabase and Privy, and the client half is a React provider. Both are cheap to assert as
 * text and expensive to stand up, and what is being protected here is a contract between two
 * files rather than the behaviour of either one.
 */
const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

describe('a missing PIN is recoverable at the point of payment', () => {
  const route = read('app/api/2fa/pin/route.ts');
  const provider = read('components/security/PinAuthorizationProvider.tsx');

  it('the server distinguishes "no PIN" from "wrong PIN" with a code', () => {
    // Not the sentence. A caller matching on wording breaks the moment the wording improves.
    expect(route).toMatch(/code:\s*["']no_pin["']/);
  });

  it('the confirmation sheet branches on that code', () => {
    expect(provider).toMatch(/data\.code\s*===\s*["']no_pin["']/);
  });

  it('and offers setup rather than an error', () => {
    // PinSetup rendered inside the sheet is what makes the pending payment survivable: the
    // authorization promise stays open across setup, so approving continues the payment
    // instead of restarting it.
    expect(provider).toContain('PinSetup');
    expect(provider).toMatch(/setNeedsSetup\(true\)/);
  });

  it('does not show the generic rejection for this case', () => {
    // The no_pin branch must come BEFORE the catch-all, or the catch-all swallows it and we
    // are back to "That PIN was not accepted" for a PIN that does not exist.
    const noPin = provider.indexOf('no_pin');
    const generic = provider.indexOf('!res.ok || !data.authorization');
    expect(noPin).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(-1);
    expect(noPin).toBeLessThan(generic);
  });

  it('the dashboard check retries rather than giving up for the session', () => {
    // A single failed status check used to leave hasPin null, which keeps the gate shut —
    // so one bad response at the wrong moment cost that user the setup prompt entirely.
    const gate = read('components/security/PinRequiredGate.tsx');
    expect(gate).toMatch(/attempt\s*>=\s*3/);
    expect(gate).toMatch(/setTimeout\(check/);
  });
});
