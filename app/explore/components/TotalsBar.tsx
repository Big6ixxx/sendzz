'use client';

import type { PublicFeedTotals, TxType } from '@/types/public';
import { TYPE_META } from '../shared';
import { formatMoney } from '@/lib/format-usdc';

interface TotalsBarProps {
  totals: PublicFeedTotals | null;
}

/** What the current filters match, read as a sentence, then the count per kind. */
export function TotalsBar({ totals }: TotalsBarProps) {
  const kinds = (Object.keys(TYPE_META) as TxType[]).filter((t) => totals?.by_type?.[t]);
  return (
    <section aria-label="Totals for current filters" className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
      <p className="text-[17px] leading-[1.5]" aria-live="polite">
        <span className="lp-display text-[24px] tracking-[-0.03em] tabular-nums">{(totals?.total_count ?? 0).toLocaleString()}</span>{' '}
        <span className="text-[var(--lp-body)]">transactions match, with</span>{' '}
        <span className="lp-display text-[24px] tracking-[-0.03em] text-[var(--lp-good)] tabular-nums">${formatMoney(totals?.total_volume ?? 0)}</span>{' '}
        <span className="text-[var(--lp-body)]">settled.</span>
      </p>
      {kinds.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {kinds.map((t) => (
            <li key={t} className="rounded-full bg-[var(--lp-surface)] px-3 py-1.5 text-[13px] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)]">
              <span className="font-semibold">{TYPE_META[t].label}s</span>{' '}
              <span className="tabular-nums text-[var(--lp-muted)]">{(totals?.by_type?.[t] ?? 0).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
