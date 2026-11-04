'use client';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { PublicStats } from '@/types/public';
import { formatMoney } from '@/lib/format-usdc';

interface StatsHeroProps {
  stats: PublicStats | null;
  loading: boolean;
}

/** The two all-time figures, side by side on the forest, the way the dashboard shows money. */
export function StatsHero({ stats, loading }: StatsHeroProps) {
  const figures = [
    { label: 'Total volume', value: `$${formatMoney(stats?.total_volume ?? 0)}`, note: 'Settled USDC, all time', accent: true },
    { label: 'Transactions', value: (stats?.tx_count_total ?? 0).toLocaleString(), note: 'Every one on record', accent: false },
  ];
  return (
    <section aria-labelledby="stats-heading" className="lp-on-forest grid grid-cols-1 overflow-hidden rounded-[32px] text-[var(--lp-cream)] sm:grid-cols-2">
      <h2 id="stats-heading" className="sr-only">
        Platform statistics
      </h2>
      {figures.map((f, i) => (
        <div key={f.label} className={cn('min-w-0 p-6 sm:p-8', i > 0 && 'border-t border-[rgba(246,242,233,0.12)] sm:border-l sm:border-t-0')}>
          <p className="lp-mono text-[12px] uppercase text-[#a9c2b5]">{f.label}</p>
          <p
            className={cn('lp-display mt-3 truncate text-[clamp(36px,6vw,64px)] leading-none tracking-[-0.045em] tabular-nums', f.accent && 'text-[var(--lp-green)]')}
            aria-live="polite"
          >
            {loading ? <Skeleton tone="forest" className="inline-block h-12 w-40 rounded-[12px]" /> : f.value}
          </p>
          <p className="mt-2 text-[14px] text-[#cfe0d6]">{f.note}</p>
        </div>
      ))}
    </section>
  );
}
