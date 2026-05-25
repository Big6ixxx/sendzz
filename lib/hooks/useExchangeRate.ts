'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchExchangeRate, type CurrencyCode } from '@/lib/currency';

/**
 * React Query hook for fetching and caching the live fiat/USDC exchange rate.
 * Supports multiple fiat currencies via the currency parameter.
 */
export function useExchangeRate(currency: CurrencyCode) {
  return useQuery({
    queryKey: ['exchangeRate', currency],
    queryFn: () => fetchExchangeRate(currency),
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!currency,
  });
}
