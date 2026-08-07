/**
 * Blocks fiat on- and off-ramps while the app is pointed at testnet.
 *
 * The chains are testnet, but the payment providers are not: BITNOB_API_KEY is a `live_`
 * key and PAYCREST_API_URL points at api.paycrest.io. Nothing about running on Arc
 * Testnet makes those calls fake.
 *
 *   Withdrawals — an off-ramp order settles real fiat into a real bank account. The
 *     on-chain leg being worthless testnet USDC makes it worse, not better: money would
 *     leave against funds that never existed.
 *   Deposits    — an on-ramp order creates a real payment request, and any fiat actually
 *     sent to satisfy it would be real money paid for testnet USDC.
 *
 * So this is not a UX nicety. It is enforced in `lib/ramp` where orders are created —
 * the one place every provider passes through — and mirrored in the UI so the buttons
 * are visibly disabled rather than failing on submit.
 *
 * To use the real rails, set NEXT_PUBLIC_SIMULATION_MODE="false". To exercise these
 * flows without moving money, point the providers at their sandboxes and relax this
 * guard deliberately — do not remove it.
 */

import { IS_TESTNET } from '@/lib/web3/network';

/** Whether fiat withdrawals (off-ramp) may be created in the current mode. */
export const WITHDRAWALS_ENABLED = !IS_TESTNET;

/** Whether fiat deposits (on-ramp) may be created in the current mode. */
export const DEPOSITS_ENABLED = !IS_TESTNET;

/** Shown in the UI and returned by the server. Kept in one place so they agree. */
export const TESTNET_WITHDRAWAL_MESSAGE =
  "You're on testnet — withdrawals are disabled. The payout providers are live, so a " +
  'withdrawal here would send real money to a real bank account.';

export const TESTNET_DEPOSIT_MESSAGE =
  "You're on testnet — deposits are disabled. The payment providers are live, so this " +
  'would create a real payment request for testnet USDC.';

export class TestnetWithdrawalBlockedError extends Error {
  /** Lets API routes answer 403 without string-matching the message. */
  readonly code = 'TESTNET_WITHDRAWALS_BLOCKED';

  constructor() {
    super(TESTNET_WITHDRAWAL_MESSAGE);
    this.name = 'TestnetWithdrawalBlockedError';
  }
}

export class TestnetDepositBlockedError extends Error {
  readonly code = 'TESTNET_DEPOSITS_BLOCKED';

  constructor() {
    super(TESTNET_DEPOSIT_MESSAGE);
    this.name = 'TestnetDepositBlockedError';
  }
}

/** Throws when withdrawals are not permitted. Call before any provider order is created. */
export function assertWithdrawalsAllowed(): void {
  if (!WITHDRAWALS_ENABLED) throw new TestnetWithdrawalBlockedError();
}

/** Throws when deposits are not permitted. Call before any provider order is created. */
export function assertDepositsAllowed(): void {
  if (!DEPOSITS_ENABLED) throw new TestnetDepositBlockedError();
}
