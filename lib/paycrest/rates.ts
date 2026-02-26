/**
 * Paycrest Rates API
 *
 * Fetch live exchange rates from Paycrest API.
 * Endpoint: GET /provider/rates/{token}/{fiat}
 */

import { getPaycrestClient } from './client';

// Cache for rates (refresh every 5 minutes)
const ratesCache = new Map<
  string,
  {
    rate: RateInfo;
    timestamp: number;
  }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface RateInfo {
  marketRate: number;
  minimumRate: number;
  maximumRate: number;
}

/**
 * Get exchange rate for token to fiat conversion.
 *
 * @param token - Token symbol (e.g., 'USDC')
 * @param fiat - Fiat currency code (e.g., 'NGN')
 */
export async function getExchangeRate(
  token: string,
  fiat: string,
): Promise<RateInfo> {
  const cacheKey = `${token}-${fiat}`;

  // Check cache first
  const cached = ratesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.rate;
  }

  // Production mode: call Paycrest API
  try {
    const client = getPaycrestClient();
    const rate = await client.get<RateInfo>(
      `/provider/rates/${token.toUpperCase()}/${fiat.toUpperCase()}`,
    );

    // Cache the result
    ratesCache.set(cacheKey, { rate, timestamp: Date.now() });
    return rate;
  } catch (error) {
    console.error('[Paycrest] Failed to fetch rate:', error);

    // Fall back to cached value if available (even if stale)
    if (cached) {
      return cached.rate;
    }

    throw error;
  }
}

/**
 * Clear the rates cache (useful for testing).
 */
export function clearRatesCache(): void {
  ratesCache.clear();
}
