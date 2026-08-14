'use client';

import { useEffect, useState } from 'react';

import { getProviderFeePercent } from '@/lib/actions/ramp';
import type { RampProviderName } from '@/lib/ramp';

/**
 * The fee percentage the server will actually charge.
 *
 * The rate lives in `PAYCREST_FEE_PERCENT` / `BITNOB_FEE_PERCENT`, which only the server can
 * read. There is deliberately no client-side default: seeding one would show a number the
 * server may not charge, and a fee display that can be wrong is worse than one that's briefly
 * absent. Returns null until the server answers — render a placeholder for that moment.
 */
export function usePlatformFee(provider: RampProviderName = 'paycrest'): number | null {
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getProviderFeePercent(provider)
      .then((p) => {
        if (active && typeof p === 'number' && Number.isFinite(p)) setPercent(p);
      })
      .catch(() => {
        /* leave null — the UI shows a placeholder rather than a guess */
      });
    return () => {
      active = false;
    };
  }, [provider]);

  return percent;
}
