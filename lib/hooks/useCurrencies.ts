'use client';

import { useQuery } from '@tanstack/react-query';
import { getCurrencies } from '@/lib/actions/ramp';
import { FiatCurrency, getCurrencyFlag } from '@/lib/currency-config';

export function useCurrencies() {
  return useQuery({
    queryKey: ['currencies'],
    queryFn: async () => {
      const res = await getCurrencies();
      
      const formatted: FiatCurrency[] = res.data.map((c) => ({
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        flag: getCurrencyFlag(c.code),
      }));

      return formatted;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
