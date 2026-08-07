/**
 * Withdrawals must not reach a live payout provider while the app is on testnet.
 *
 * The danger is specific: the chains are testnet but BITNOB_API_KEY is a `live_` key and
 * Paycrest points at api.paycrest.io, so an off-ramp order would settle real fiat into a
 * real bank account against testnet USDC that is worth nothing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

async function load(simulation: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', simulation);
  return import('./testnet-guard');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('on testnet', () => {
  it('reports withdrawals disabled', async () => {
    const { WITHDRAWALS_ENABLED } = await load('true');
    expect(WITHDRAWALS_ENABLED).toBe(false);
  });

  it('throws a typed error the API can turn into a 403', async () => {
    const { assertWithdrawalsAllowed, TestnetWithdrawalBlockedError } = await load('true');

    expect(() => assertWithdrawalsAllowed()).toThrow(TestnetWithdrawalBlockedError);
    try {
      assertWithdrawalsAllowed();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as { code: string }).code).toBe('TESTNET_WITHDRAWALS_BLOCKED');
    }
  });

  it('says plainly that the user is on testnet', async () => {
    const { TESTNET_WITHDRAWAL_MESSAGE } = await load('true');
    expect(TESTNET_WITHDRAWAL_MESSAGE).toMatch(/testnet/i);
    expect(TESTNET_WITHDRAWAL_MESSAGE).toMatch(/real money|real bank/i);
  });

  it('reports deposits disabled too', async () => {
    const { DEPOSITS_ENABLED, assertDepositsAllowed, TestnetDepositBlockedError } =
      await load('true');

    expect(DEPOSITS_ENABLED).toBe(false);
    expect(() => assertDepositsAllowed()).toThrow(TestnetDepositBlockedError);
  });

  it('blocks every ramp entry point on the Ramp facade', async () => {
    // Guarding only some of these would leave the rest reaching a live provider.
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', 'true');
    const { Ramp } = await import('./index');

    const params = {
      amountUsdc: 10,
      bank: { accountNumber: '0000000000', bankCode: '000', accountName: 'Test' },
      userRefundAddress: '0x0000000000000000000000000000000000000000',
      userEmail: 'test@example.com',
      fiatCurrency: 'NGN',
      network: 'base',
    } as unknown as Parameters<typeof Ramp.createOffRampOrder>[0];

    await expect(Ramp.createOffRampOrder(params)).rejects.toThrow(/testnet/i);
    await expect(Ramp.createOffRampOrderFor('bitnob', params)).rejects.toThrow(/testnet/i);
    await expect(
      Ramp.createOnRampOrder(params as unknown as Parameters<typeof Ramp.createOnRampOrder>[0]),
    ).rejects.toThrow(/testnet/i);
  });
});

describe('on mainnet', () => {
  it('allows both ramps, so production is unaffected', async () => {
    const {
      WITHDRAWALS_ENABLED,
      DEPOSITS_ENABLED,
      assertWithdrawalsAllowed,
      assertDepositsAllowed,
    } = await load('false');

    expect(WITHDRAWALS_ENABLED).toBe(true);
    expect(DEPOSITS_ENABLED).toBe(true);
    expect(() => assertWithdrawalsAllowed()).not.toThrow();
    expect(() => assertDepositsAllowed()).not.toThrow();
  });
});
