'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchExchangeRate, DEFAULT_EXCHANGE_RATE_USD_NGN, type CurrencyCode } from '@/lib/currency';

/**
 * React Query hook for fetching and caching the live fiat/USDC exchange rate.
 * Supports multiple fiat currencies via the currency parameter.
 */
export function useExchangeRate(currency: CurrencyCode = 'NGN') {
  return useQuery({
    queryKey: ['exchangeRate', currency],
    queryFn: () => fetchExchangeRate(currency),
    staleTime: 10 * 60 * 1000, // 10 minutes
    initialData: currency === 'NGN' ? DEFAULT_EXCHANGE_RATE_USD_NGN : undefined,
  });
}
