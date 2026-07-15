'use client';

import { cn } from '@/lib/utils';
import type { PublicFeedTotals, TxType } from '@/types/public';
import { formatUsdc, TYPE_META } from '../shared';

interface TotalsBarProps {
  totals: PublicFeedTotals | null;
}

export function TotalsBar({ totals }: TotalsBarProps) {
  return (
    <section
      aria-label="Totals for current filters"
      className="card-glass flex flex-wrap items-center gap-x-10 gap-y-4 py-5!"
    >
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
          Matching transactions
        </p>
        <p className="text-2xl font-display font-bold text-white" aria-live="polite">
          {(totals?.total_count ?? 0).toLocaleString()}
        </p>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Settled volume</p>
        <p className="text-2xl font-display font-bold text-accent" aria-live="polite">
          ${formatUsdc(totals?.total_volume ?? 0)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        {(Object.keys(TYPE_META) as TxType[]).map((t) => {
          const count = totals?.by_type?.[t] ?? 0;
          if (!count) return null;
          return (
            <span
              key={t}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest',
                TYPE_META[t].bg,
                TYPE_META[t].color,
              )}
            >
              {TYPE_META[t].label}s · {count.toLocaleString()}
            </span>
          );
        })}
      </div>
    </section>
  );
}
