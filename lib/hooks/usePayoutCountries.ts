'use client';

import { useQuery } from '@tanstack/react-query';
import { getPayoutCountries } from '@/lib/actions/ramp';

/**
 * Countries a payout can be sent to.
 *
 * Separate from `useCurrencies`, which is deduped by currency and therefore cannot tell Senegal
 * from Benin — both are XOF. Picking a destination is a country question; pricing is a currency
 * one, and they are not the same list.
 */
export function usePayoutCountries() {
  return useQuery({
    queryKey: ['payout-countries'],
    queryFn: async () => (await getPayoutCountries()).data,
    staleTime: 1000 * 60 * 60,
  });
}
