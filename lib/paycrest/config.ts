/**
 * Paycrest Configuration
 *
 * Central place for fees and other settings.
 *
 * The fee percentage itself lives in `@/lib/ramp/fees` as PLATFORM_FEE_PERCENT — one number
 * for every provider and both directions. Import it from there; this module only does the
 * Paycrest-specific arithmetic around it.
 */

import { baseFromTotal, PLATFORM_FEE_PERCENT, totalFromBase } from "@/lib/ramp/fees";

/**
 * Calculates the base amount to send to Paycrest so that after adding
 * the platform fee, the total matches the target amount.
 *
 * Paycrest skims the fee itself (configured to the same percentage on their dashboard), so we
 * send the reverse-calculated base and their skim lands the user on exactly what they entered.
 *
 * Formula: target = base * (1 + fee)  =>  base = target / (1 + fee)
 */
export function calculatePaycrestBaseAmount(targetTotal: number): number {
  return baseFromTotal(targetTotal, PLATFORM_FEE_PERCENT);
}

/**
 * Calculates the final transfer amount including the platform fee.
 */
export function calculatePaycrestTotalAmount(baseAmount: number): number {
  return totalFromBase(baseAmount, PLATFORM_FEE_PERCENT);
}
