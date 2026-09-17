/**
 * KYC Transaction Limits — Central Configuration
 *
 * All amounts are in USD (1 USDC = 1 USD for enforcement purposes).
 *
 * There is exactly one rule, and it is the whole file: an unverified user may withdraw
 * UNVERIFIED_WITHDRAWAL_ALLOWANCE in total, once, and then must verify their identity.
 * Verified users have no limit.
 *
 * Nothing else is rationed. Deposits are not capped, and sending — on-chain, by email, or in a
 * batch — never reaches this code at all. A limit belongs on the way out, where the compliance
 * obligation actually sits; anywhere else it only stops people using the product.
 *
 * This deliberately replaced a daily/weekly/monthly ceiling system. Those windows were set to
 * Infinity for both tiers, so they refused nothing, while still costing a database read on every
 * movement and describing a second rule that did not exist. A rolling window is also the wrong
 * shape for the promise here: it forgives, so it could never mean "100 before you verify".
 */

/**
 * What an unverified user may withdraw in total, in USD, before verifying.
 *
 * Cumulative and one-off, not a rolling window. Five withdrawals of 20 and a single 100 are
 * the same thing to this rule, and neither leaves anything behind: once the total reaches 100
 * the next withdrawal needs identity verification, however long the user waits.
 *
 * A window was the wrong shape for the promise the app makes. It forgives — wait a day and the
 * allowance returns — so it could never mean "100 before you verify". It also never bound in
 * practice: a first-ever withdrawal of 400 fitted inside a 500 daily allowance and went through.
 */
export const UNVERIFIED_WITHDRAWAL_ALLOWANCE = 100;

/**
 * When the allowance starts counting.
 *
 * The rule applies going forward. Without a cutoff, every existing user would wake up over
 * their limit on the day it shipped — some of them by thousands, our heaviest two at more than
 * $17,000 each — and be locked out of an app they had been using legitimately for months.
 *
 * Set to just after the release goes out, so nobody arrives with part of an allowance already
 * spent on withdrawals they made before the rule existed. It is deliberately a moment in the
 * near future rather than "now": a cutoff written at the time of the commit is already in the
 * past by the time the code is live, and everything withdrawn in between would count.
 *
 * A fixed timestamp on purpose, never `Date.now()` minus something: a sliding cutoff would keep
 * forgiving old withdrawals, which is exactly the rolling-window behaviour this replaces.
 *
 * Safe to move while the release is still going out. Once real users have started spending
 * against it, moving it forward silently refunds allowance they have already used.
 */
export const UNVERIFIED_ALLOWANCE_START = "2026-09-01T15:00:00Z";

/**
 * How much of the allowance is left, given what has already been withdrawn.
 *
 * Never negative: a user already past the cap has nothing left, not a debt.
 */
export function remainingUnverifiedAllowance(withdrawnSoFar: number): number {
  return Math.max(0, UNVERIFIED_WITHDRAWAL_ALLOWANCE - withdrawnSoFar);
}

/**
 * Would this withdrawal take the user past the allowance?
 *
 * Tested against the total, not the single amount, so it is the eleventh withdrawal of 10 that
 * is refused rather than any one of them being too large on its own.
 */
export function exceedsUnverifiedAllowance(
  withdrawnSoFar: number,
  amountUsd: number,
): boolean {
  return withdrawnSoFar + amountUsd > UNVERIFIED_WITHDRAWAL_ALLOWANCE;
}
