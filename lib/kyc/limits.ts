/**
 * KYC Transaction Limits — Central Configuration
 *
 * All amounts are in USD (1 USDC = 1 USD for enforcement purposes).
 *
 * To update a limit, change the value here. No other files need to change.
 *
 * Tiers:
 *   - UNVERIFIED: users who have NOT completed KYC can transact up to these limits.
 *     Once they hit the limit, they must complete KYC to continue.
 *   - VERIFIED: users who HAVE completed KYC can transact up to these higher limits.
 *     (Phase 2 feature — currently same enforcement, but structure is in place.)
 */

export const KYC_LIMITS = {
  /**
   * Maximum cumulative outgoing transaction volume per user
   * within each rolling time window, in USD.
   *
   * These limits apply to ALL users who have NOT completed KYC.
   * KYC-verified users are exempt from these limits (blocked only at VERIFIED limits).
   */
  UNVERIFIED: {
    daily: 500,       // USD per rolling 24-hour window
    weekly: 2500,     // USD per rolling 7-day window
    monthly: 10000,   // USD per rolling 30-day window
  },

  /**
   * Post-KYC limits. Transactions that would exceed these limits
   * are blocked even for verified users (compliance ceiling).
   * Set to Infinity to disable.
   */
  VERIFIED: {
    daily: Infinity,
    weekly: Infinity,
    monthly: Infinity,
  },
} as const;

export type KycLimitPeriod = "daily" | "weekly" | "monthly";

/** Returns which limit period is the most restrictive for a given transaction. */
export function getBindingPeriod(
  transactionAmount: number,
  totals: { daily: number; weekly: number; monthly: number },
  limits: { daily: number; weekly: number; monthly: number },
): KycLimitPeriod | null {
  if (totals.daily + transactionAmount > limits.daily) return "daily";
  if (totals.weekly + transactionAmount > limits.weekly) return "weekly";
  if (totals.monthly + transactionAmount > limits.monthly) return "monthly";
  return null;
}
