/**
 * Paycrest Configuration
 *
 * Central place for fees and other settings.
 *
 * The fee percentage is REQUIRED, never defaulted. It comes from PAYCREST_FEE_PERCENT, which
 * only the server can read — a default here would silently reinstate a compiled-in rate and
 * let deposits charge something different from withdrawals. Callers pass the effective value:
 *   • server → getProviderFee('paycrest').percent
 *   • client → the value fetched via getProviderFeePercent()
 */

import { baseFromTotal, totalFromBase } from "@/lib/ramp/fees";

/**
 * Calculates the base amount to send to Paycrest so that after adding
 * the platform fee, the total matches the target amount.
 *
 * Paycrest skims the fee itself (configured to the same percentage on their dashboard), so we
 * send the reverse-calculated base and their skim lands the user on exactly what they entered.
 *
 * Formula: target = base * (1 + fee)  =>  base = target / (1 + fee)
 */
export function calculatePaycrestBaseAmount(
  targetTotal: number,
  feePercent: number,
): number {
  return baseFromTotal(targetTotal, feePercent);
}

/**
 * Calculates the final transfer amount including the platform fee.
 */
export function calculatePaycrestTotalAmount(
  baseAmount: number,
  feePercent: number,
): number {
  return totalFromBase(baseAmount, feePercent);
}
