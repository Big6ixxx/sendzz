import { describe, it, expect, vi } from 'vitest';
import { sendWithAdaptiveVerificationGas } from './bridge-actions';

/**
 * The retry loop that decides how much gas a userOperation gets for validation.
 *
 * It is load-bearing for fund access: when it gives up, a user cannot bridge or withdraw
 * from that chain at all. A real user had 19 USDC visible and unreachable on Polygon for
 * days because AA13 — the bundler's way of saying "deploying the account ran out of gas" —
 * matched none of the retry conditions and was rethrown on the first attempt.
 */

/** The message viem actually surfaced, captured from a failed Polygon bridge. */
const AA13 =
  'Failed to simulate deployment for Smart Account.\n\n' +
  'This could arise when:\n' +
  '- Invalid `factory`/`factoryData` or `initCode` properties are present\n' +
  '- Smart Account deployment execution ran out of gas (low `verificationGasLimit` value)\n\n' +
  'Details: validation reverted: [reason]: AA13 initCode failed or OOG\n' +
  'Version: viem@2.47.10';

const AA26 = 'UserOperation reverted: AA26 over verificationGasLimit';
const EFFICIENCY =
  'verificationGasLimit efficiency too low. Expected: 0.4, Actual: 0.1329';

const HASH = '0xdeadbeef' as `0x${string}`;

describe('sendWithAdaptiveVerificationGas', () => {
  it('escalates past AA13 instead of giving up on the first attempt', async () => {
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      if (limits.length === 1) throw new Error(AA13);
      return HASH;
    });

    await expect(sendWithAdaptiveVerificationGas('polygon', send)).resolves.toBe(HASH);

    // The bug was that this only ever ran once.
    expect(send).toHaveBeenCalledTimes(2);
    expect(limits[0]).toBe(265_000n); // polygon seed, measured on a deployed account
    expect(limits[1]).toBe(795_000n); // 3x — enough to also deploy the account
  });

  it('keeps escalating while AA13 persists, using its whole budget', async () => {
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      if (limits.length < 4) throw new Error(AA13);
      return HASH;
    });

    await expect(sendWithAdaptiveVerificationGas('polygon', send)).resolves.toBe(HASH);
    expect(limits).toEqual([265_000n, 795_000n, 2_385_000n, 7_155_000n]);
  });

  it('works on a chain with no seed, so every chain is covered', async () => {
    // Base, Arbitrum, Optimism and Arc have no seed — they start at the SDK default.
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      if (limits.length === 1) throw new Error(AA13);
      return HASH;
    });

    await expect(sendWithAdaptiveVerificationGas('arc', send)).resolves.toBe(HASH);
    expect(limits[0]).toBeUndefined(); // let the SDK choose
    expect(limits[1]).toBe(300_000n); // 3x the SDK's 100k default
  });

  it('still escalates on AA26, the case that already worked', async () => {
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      if (limits.length === 1) throw new Error(AA26);
      return HASH;
    });

    await expect(sendWithAdaptiveVerificationGas('polygon', send)).resolves.toBe(HASH);
    expect(limits[1]).toBe(795_000n);
  });

  it('corrects DOWNWARD when the limit was too generous', async () => {
    // The two branches converge from both sides: escalating past AA13 can overshoot, and
    // Circle rejects a limit more than 2.5x what validation used. This is what pulls it back.
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      if (limits.length === 1) throw new Error(EFFICIENCY);
      return HASH;
    });

    await expect(sendWithAdaptiveVerificationGas('polygon', send)).resolves.toBe(HASH);
    // 265000 * 0.1329 = ~35,219 used → 2x = ~70,438, comfortably inside the 0.4 floor.
    expect(limits[1]).toBe(70_438n);
  });

  it('rethrows anything that is not about verification gas', async () => {
    // The negative control. Retrying a genuine failure just delays the truth.
    const send = vi.fn(async () => {
      throw new Error('AA21 didn\'t pay prefund');
    });

    await expect(sendWithAdaptiveVerificationGas('polygon', send)).rejects.toThrow('AA21');
    expect(send).toHaveBeenCalledTimes(1);
  });

  /**
   * The bundler's own quote beats the measured table.
   *
   * Circle returns `deployed: 100000, notDeployed: 1500000` on every gas-price call. The table
   * holds 265,000 for Polygon — a deployed-account measurement — so a first transaction started
   * roughly 6x under and failed AA13. Seeding from the quote starts it in the right place.
   */
  it('prefers a supplied seed over the measured table', async () => {
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      return HASH;
    });

    // 1_500_000n is Circle's real `notDeployed` figure, from a live Polygon response.
    await sendWithAdaptiveVerificationGas('polygon', send, 1_500_000n);
    expect(limits[0]).toBe(1_500_000n);
    expect(limits[0]).not.toBe(265_000n); // the table value it replaces
    expect(send).toHaveBeenCalledTimes(1); // no wasted round trip
  });

  it('falls back to the table when the bundler does not quote', async () => {
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      return HASH;
    });

    await sendWithAdaptiveVerificationGas('polygon', send, undefined);
    expect(limits[0]).toBe(265_000n);
  });

  it('still escalates from a seeded start if even that is short', async () => {
    const limits: (bigint | undefined)[] = [];
    const send = vi.fn(async (limit: bigint | undefined) => {
      limits.push(limit);
      if (limits.length === 1) throw new Error(AA13);
      return HASH;
    });

    await sendWithAdaptiveVerificationGas('polygon', send, 1_500_000n);
    expect(limits).toEqual([1_500_000n, 4_500_000n]);
  });

  it('gives up after its budget rather than retrying forever', async () => {
    const send = vi.fn(async () => {
      throw new Error(AA13);
    });

    await expect(sendWithAdaptiveVerificationGas('polygon', send)).rejects.toThrow(/AA13/);
    expect(send).toHaveBeenCalledTimes(4);
  });
});
