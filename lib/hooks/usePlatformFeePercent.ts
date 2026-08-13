'use client';

import { useEffect, useState } from 'react';

import { feePercentFor } from '@/lib/actions/fees';
import type { PlatformFeeKind } from '@/lib/fees/platform-fees';

/**
 * The bridge or transfer fee rate, fetched from the server.
 *
 * `BRIDGE_FEE_PERCENT` / `TRANSFER_FEE_PERCENT` are server-only, and there is deliberately no
 * client-side default: a displayed rate that the server might not charge is worse than one
 * that's briefly absent. Null until it arrives — render a placeholder, and don't show a fee
 * summary built on a guess.
 */
export function usePlatformFeePercent(kind: PlatformFeeKind): number | null {
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    feePercentFor(kind)
      .then((p) => {
        if (active && typeof p === 'number' && Number.isFinite(p)) setPercent(p);
      })
      .catch(() => {
        /* leave null — no fee line rather than a wrong one */
      });
    return () => {
      active = false;
    };
  }, [kind]);

  return percent;
}
