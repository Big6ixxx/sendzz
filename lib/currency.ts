/**
 * Currency Utilities
 *
 * Helper functions for currency conversion and formatting.
 * Uses live exchange rates from Paycrest API when available.
 */

// Default fallback rate (used when API is unavailable)
export const DEFAULT_EXCHANGE_RATE_USD_NGN = 1500;

// Rate cache for client-side usage
let cachedRate: { rate: number; timestamp: number } | null = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export type CurrencyCode = "USD" | "NGN" | "KES" | "GHS" | "USDC";

/**
 * Get the current exchange rate (with caching for client-side)
 * TODO: This should be called from components that need live rates
 */
export async function fetchExchangeRate(
  fiatCurrency: CurrencyCode = "NGN",
): Promise<number> {
  // Check cache
  if (cachedRate && Date.now() - cachedRate.timestamp < CACHE_DURATION_MS) {
    return cachedRate.rate;
  }

  try {
    const res = await fetch(`/api/paycrest/rates/USDC/NGN`);
    const data = await res.json();
    if (data.success && data.data?.marketRate) {
      cachedRate = { rate: data.data.marketRate, timestamp: Date.now() };
      return data.data.marketRate;
    }
  } catch {
    console.warn("Failed to fetch exchange rate, using default");
  }

  return DEFAULT_EXCHANGE_RATE_USD_NGN;
}

/**
 * Format amount as currency
 */
export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const currencyMap: Record<string, string> = {
    USD: "USD",
    USDC: "USD",
    NGN: "NGN",
    KES: "KES",
    GHS: "GHS",
  };

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyMap[currency] || "USD",
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
  direction: "toFiat" | "toUsd",
): number {
  return direction === "toFiat" ? amount * rate : amount / rate;
}
