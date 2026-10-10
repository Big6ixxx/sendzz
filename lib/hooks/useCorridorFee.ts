'use client';

import { useEffect, useState } from 'react';

import {
  getCorridorFeeAction,
  getOffRampProviderOrder,
  getProviderFeePercent,
} from '@/lib/actions/ramp';

export interface CorridorFee {
  /** Percentage of the amount, e.g. 0.5. */
  percent: number;
  /** Flat fee in USDC the paying provider adds for this corridor; 0 when there is none. */
  flat: number;
}

/**
 * What a withdrawal to `currency` actually costs: the corridor's percentage
 * (`WITHDRAWAL_FEE_PERCENT_<CURRENCY>`, else the standard rate) plus any flat fee the provider
 * that would pay it out charges. Asked of the server, which alone can read the rates.
 *
 * Null until the server answers, or when it cannot — show no number rather than a guess.
 */
export function useCorridorFee(currency: string): CorridorFee | null {
  // Tagged with the currency it belongs to, so switching currency shows nothing (rather than
  // the previous corridor's fee) until the new answer arrives.
  const [result, setResult] = useState<{ currency: string; fee: CorridorFee } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [provider] = await getOffRampProviderOrder(currency);
      if (!provider) return;
      const [percent, flat] = await Promise.all([
        getProviderFeePercent(provider, currency),
        getCorridorFeeAction(provider, currency),
      ]);
      if (active && Number.isFinite(percent) && Number.isFinite(flat)) {
        setResult({ currency, fee: { percent, flat } });
      }
    })().catch(() => {
      /* leave it unset — callers show a placeholder rather than a wrong fee */
    });
    return () => {
      active = false;
    };
  }, [currency]);

  return result?.currency === currency ? result.fee : null;
}
