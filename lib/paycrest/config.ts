/**
 * Paycrest Configuration
 * 
 * Central place for fees and other settings.
 */

// The partner fee percentage set in your Paycrest dashboard.
// This is used to reverse-calculate the base amount so that the 
// final bank transfer amount matches exactly what the user entered.
export const PAYCREST_PARTNER_FEE_PERCENT = 0.3; // 0.3%

/**
 * Calculates the base amount to send to Paycrest so that after adding 
 * the partner fee, the total matches the target amount.
 * 
 * Formula: target = base * (1 + fee)  =>  base = target / (1 + fee)
 */
export function calculatePaycrestBaseAmount(targetTotal: number): number {
  const feeRate = PAYCREST_PARTNER_FEE_PERCENT / 100;
  return targetTotal / (1 + feeRate);
}

/**
 * Calculates the final transfer amount including the partner fee.
 */
export function calculatePaycrestTotalAmount(baseAmount: number): number {
  const feeRate = PAYCREST_PARTNER_FEE_PERCENT / 100;
  return baseAmount * (1 + feeRate);
}
