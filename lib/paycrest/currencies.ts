/**
 * Paycrest Currencies API
 *
 * Endpoint for fetching supported currencies.
 */

import { getPaycrestClient } from './client';
import type { CurrenciesResponse, Currency } from './types';

// Cache for currencies (refresh every hour)
let currenciesCache: Currency[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get all supported currencies
 * GET /currencies
 */
export async function getSupportedCurrencies(): Promise<Currency[]> {
  // Return cached if still valid
  if (currenciesCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return currenciesCache;
  }

  const client = getPaycrestClient();
  const response = await client.get<CurrenciesResponse>('/currencies');

  // Update cache
  currenciesCache = response.currencies;
  cacheTimestamp = Date.now();

  return currenciesCache;
}

/**
 * Get a specific currency by code
 */
export async function getCurrencyByCode(
  code: string,
): Promise<Currency | null> {
  const currencies = await getSupportedCurrencies();
  return (
    currencies.find((c) => c.code.toUpperCase() === code.toUpperCase()) || null
  );
}

/**
 * Clear the currencies cache (useful for testing)
 */
export function clearCurrenciesCache(): void {
  currenciesCache = null;
  cacheTimestamp = 0;
}
