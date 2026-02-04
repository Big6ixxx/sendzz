/**
 * Currency Utilities
 *
 * Helper functions for currency conversion and formatting.
 *
 * NOTE: Using a fixed exchange rate for MVP.
 */

export const EXCHANGE_RATE_USD_NGN = 1500;

export type CurrencyCode = 'USD' | 'NGN' | 'USDC';

/**
 * Format amount as currency
 */
export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency === 'USDC' ? 'USD' : currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return formatter.format(amount).replace('USDC', 'USD');
}

/**
 * Convert USD/USDC to NGN
 */
export function convertUsdToNgn(amountUsd: number): number {
  return amountUsd * EXCHANGE_RATE_USD_NGN;
}

/**
 * Convert NGN to USD/USDC
 */
export function convertNgnToUsd(amountNgn: number): number {
  return amountNgn / EXCHANGE_RATE_USD_NGN;
}
