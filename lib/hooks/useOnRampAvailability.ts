'use client';

import { useQuery } from '@tanstack/react-query';
import { isOnRampAvailable } from '@/lib/actions/ramp';

/**
 * Whether a deposit in this currency can actually be filled right now.
 *
 * Being a supported corridor is not the same as being a liquid one: Paycrest quotes each
 * direction independently, so a currency can accept withdrawals all day while nobody is selling
 * USDC into it. Checked live rather than from a static list, because it moves with liquidity.
 *
 * Defaults to available while loading — the form should not flash "unavailable" at someone who
 * simply opened it.
 */
export function useOnRampAvailability(currency: string | undefined) {
  const query = useQuery({
    queryKey: ['onramp-availability', currency],
    queryFn: () => isOnRampAvailable(currency as string),
    enabled: !!currency,
    staleTime: 1000 * 60 * 2,
  });

  return {
    isChecking: query.isLoading,
    unavailable: query.data === false,
  };
}
