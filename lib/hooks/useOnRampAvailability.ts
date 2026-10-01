'use client';

import { useQuery } from '@tanstack/react-query';
import { isOnRampAvailable } from '@/lib/actions/ramp';

/**
 * Whether a deposit can actually be filled right now, at this size.
 *
 * Being a supported corridor is not the same as being a liquid one at every amount: Paycrest
 * quotes each size independently, so NGN answers at 20 USDC, goes quiet at 30, and is open for
 * business the whole time. Asking about a fixed size and reporting the answer as "this currency
 * is paused" blocked people from a corridor that would have taken their money.
 *
 * So the amount the user actually typed is what gets checked. Before they type anything there is
 * no size to ask about, and the question collapses to "is this corridor alive at all" — which
 * the small default probe answers.
 *
 * Defaults to available while loading, so the form does not flash a warning at someone who has
 * only just opened it.
 */
export function useOnRampAvailability(currency: string | undefined, amountUsdc?: number) {
  // Rounded up to whole USDC so typing "12.3456" is one question, not six. Rounding UP keeps the
  // probe at least as large as the real deposit, so a pass here is never optimistic.
  const probe =
    amountUsdc && Number.isFinite(amountUsdc) && amountUsdc > 0
      ? Math.ceil(amountUsdc)
      : undefined;

  const query = useQuery({
    queryKey: ['onramp-availability', currency, probe ?? 'corridor'],
    queryFn: () => isOnRampAvailable(currency as string, probe),
    enabled: !!currency,
    staleTime: 1000 * 60 * 2,
  });

  return {
    isChecking: query.isLoading,
    unavailable: query.data === false,
    /**
     * True when a specific amount was checked. Lets the caller say "no one is quoting this size"
     * rather than "this currency is closed" — only one of which the user can act on.
     */
    checkedAmount: probe !== undefined,
  };
}
