/**
 * `verificationGasLimit` correction for sponsored user operations.
 *
 * The case that motivated these: a bridge claim onto a chain the wallet had never
 * transacted on. That userOperation carries `factory`/`factoryData`, so its verification
 * gas has to cover *deploying* the smart account as well as checking the signature. It
 * was being seeded with a number measured for an already-deployed account, the bundler
 * answered `AA13 initCode failed or OOG`, and AA13 was not in the retry set — so all four
 * attempts sent the identical too-small limit. The failure came out of gas estimation,
 * before signing, so the user was never even prompted; the USDC was already burned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@circle-fin/modular-wallets-core', () => ({ modularWalletActions: () => ({}) }));
vi.mock('sonner', () => ({ toast: { info: () => {}, success: () => {}, error: () => {} } }));

const HASH = '0xabc' as const;

const AA13 = 'Details: validation reverted: [reason]: AA13 initCode failed or OOG';
const AA26 = 'UserOperation reverted: AA26 over verificationGasLimit';
const efficiencyTooLow = (actual: number) =>
  `verificationGasLimit efficiency too low. Required: 0.4 Actual: ${actual}`;

let sendWithAdaptiveVerificationGas: typeof import('./bridge-actions')['sendWithAdaptiveVerificationGas'];

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  ({ sendWithAdaptiveVerificationGas } = await import('./bridge-actions'));
});

/** Records every limit tried, and fails with `errors[i]` on attempt i. */
function recorder(errors: (string | null)[]) {
  const tried: (bigint | undefined)[] = [];
  const send = async (limit: bigint | undefined) => {
    const err = errors[tried.length];
    tried.push(limit);
    if (err) throw new Error(err);
    return HASH;
  };
  return { tried, send };
}

describe('sendWithAdaptiveVerificationGas', () => {
  it('retries an AA13 instead of giving up', async () => {
    // Before: AA13 hit the bare `throw` and the claim died on attempt one.
    const { tried, send } = recorder([AA13, null]);

    await expect(sendWithAdaptiveVerificationGas('polygon', send, false)).resolves.toBe(HASH);
    expect(tried).toHaveLength(2);
  });

  it('escalates an AA13 to a deployment-sized limit, not a validation-sized one', async () => {
    // Deploying the account costs several times what validating it does, so tripling the
    // validation seed (265k → 795k) lands short again and burns another round trip.
    const { tried, send } = recorder([AA13, null]);

    await sendWithAdaptiveVerificationGas('polygon', send, true);

    expect(tried[1]).toBeGreaterThanOrEqual(1_000_000n);
  });

  it('does not seed a validation-sized limit onto an undeployed account', async () => {
    // Polygon has a seed, but it was measured against an existing account. Passing it for
    // an op that must also deploy is precisely what produced the AA13.
    const { tried, send } = recorder([null]);

    await sendWithAdaptiveVerificationGas('polygon', send, false);

    expect(tried[0]).toBeUndefined();
  });

  it('still seeds a deployed account on a chain known to need it', async () => {
    const { tried, send } = recorder([null]);

    await sendWithAdaptiveVerificationGas('polygon', send, true);

    expect(tried[0]).toBe(265_000n);
  });

  it('lets the bundler estimate on chains with no seed', async () => {
    const { tried, send } = recorder([null]);

    await sendWithAdaptiveVerificationGas('base', send, true);

    expect(tried[0]).toBeUndefined();
  });

  it('converges from a too-high limit using the reported efficiency', async () => {
    // Actual 0.1329 of 1,000,000 pins validation at ~132,900 → retry at ~265,800,
    // which is efficiency 0.5: clear of the 0.4 floor from both directions.
    const { tried, send } = recorder([AA13, efficiencyTooLow(0.1329), null]);

    await sendWithAdaptiveVerificationGas('polygon', send, false);

    expect(tried[2]).toBeGreaterThan(250_000n);
    expect(tried[2]).toBeLessThan(300_000n);
  });

  it('raises the limit on AA26', async () => {
    const { tried, send } = recorder([AA26, null]);

    await sendWithAdaptiveVerificationGas('polygon', send, true);

    expect(tried[1]).toBeGreaterThan(tried[0]!);
  });

  it('rethrows an unrelated failure without retrying', async () => {
    // Retrying a rejected signature or a reverted call just multiplies the damage.
    const { tried, send } = recorder(['User rejected the request', null]);

    await expect(sendWithAdaptiveVerificationGas('polygon', send, true)).rejects.toThrow(
      /User rejected/,
    );
    expect(tried).toHaveLength(1);
  });

  it('gives up after four attempts rather than looping', async () => {
    const { tried, send } = recorder([AA13, AA13, AA13, AA13, AA13]);

    await expect(sendWithAdaptiveVerificationGas('polygon', send, false)).rejects.toThrow(/AA13/);
    expect(tried).toHaveLength(4);
  });
});
