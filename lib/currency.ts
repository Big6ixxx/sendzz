/**
 * Currency Utilities
 *
 * Helper functions for currency conversion and formatting.
 * Uses live exchange rates from Paycrest API when available.
 */

import { getOnRampRate } from './actions/ramp';

// Default fallback rate (used when API is unavailable)
export const DEFAULT_EXCHANGE_RATE_USD_NGN = 1300;

// Rate cache for client-side usage
const cachedRates: Map<string, { rate: number; timestamp: number }> = new Map();
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export type CurrencyCode = 'USD' | 'NGN' | 'KES' | 'GHS' | 'USDC';

/**
 * Get the current exchange rate (with caching for client-side)
 */
export async function fetchExchangeRate(
  fiatCurrency: CurrencyCode = 'NGN',
): Promise<number> {
  // If USD/USDC, it's 1:1
  if (fiatCurrency === 'USD' || fiatCurrency === 'USDC') return 1;

  // Check cache
  const cached = cachedRates.get(fiatCurrency);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
    return cached.rate;
  }

  try {
    const rate = await getOnRampRate(fiatCurrency);
    if (rate) {
      cachedRates.set(fiatCurrency, { rate, timestamp: Date.now() });
      return rate;
    }
  } catch (error) {
    console.warn(
      `Failed to fetch exchange rate for ${fiatCurrency} via server action:`,
      error,
    );
  }

  return DEFAULT_EXCHANGE_RATE_USD_NGN;
}

/**
 * Format amount as currency
 */
export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const currencyMap: Record<string, string> = {
    USD: 'USD',
    USDC: 'USD',
    NGN: 'NGN',
    KES: 'KES',
    GHS: 'GHS',
  };

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyMap[currency] || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return formatter.format(amount);
}

/**
 * Convert USD/USDC to NGN (using default rate for sync operations)
 * For live rates, use fetchExchangeRate() instead
 */
export function convertUsdToNgn(amountUsd: number): number {
  return amountUsd * DEFAULT_EXCHANGE_RATE_USD_NGN;
}

/**
 * Convert NGN to USD/USDC (using default rate for sync operations)
 * For live rates, use fetchExchangeRate() instead
 */
export function convertNgnToUsd(amountNgn: number): number {
  return amountNgn / DEFAULT_EXCHANGE_RATE_USD_NGN;
}

/**
 * Convert using a provided rate (for when you have the rate already)
 */
export function convertWithRate(
  amount: number,
  rate: number,
  direction: 'toFiat' | 'toUsd',
): number {
  return direction === 'toFiat' ? amount * rate : amount / rate;
}
