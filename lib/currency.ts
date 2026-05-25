/**
 * Currency Utilities
 *
 * Helper functions for currency conversion and formatting.
 * Uses live exchange rates from Paycrest API when available.
 */

import { getOnRampRate } from './actions/ramp';
import { type FiatCurrencyCode } from './currency-config';

// Rate cache for client-side usage
const cachedRates: Map<string, { rate: number; timestamp: number }> = new Map();
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export type CurrencyCode = 'USD' | 'USDC' | FiatCurrencyCode;

/**
 * Get the current exchange rate (with caching for client-side)
 */
export async function fetchExchangeRate(
  fiatCurrency: CurrencyCode,
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

  // Fallback to 1 if we can't get a rate, though ideally we should handle this in UI
  return 1;
}

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

  return formatter.format(amount);
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
