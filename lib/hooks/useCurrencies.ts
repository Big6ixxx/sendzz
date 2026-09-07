'use client';

import { useQuery } from '@tanstack/react-query';
import { getCurrencies, getOnRampCurrencies } from '@/lib/actions/ramp';
import { FiatCurrency, getCurrencyFlag } from '@/lib/currency-config';

/**
 * `'all'` is every corridor we quote. `'onramp'` is the shorter list a deposit can actually be
 * fulfilled in — see Ramp.getOnRampCurrencies.
 */
export type CurrencyScope = 'all' | 'onramp';

export function useCurrencies(scope: CurrencyScope = 'all') {
  return useQuery({
    queryKey: ['currencies', scope],
    queryFn: async () => {
      const res = scope === 'onramp' ? await getOnRampCurrencies() : await getCurrencies();
      
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
