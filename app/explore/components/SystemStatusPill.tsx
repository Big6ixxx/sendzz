'use client';

import { cn } from '@/lib/utils';
import type { PublicStats } from '@/types/public';
import { STATUS_META } from '../constants';
import { formatFeedDate, type TimeMode } from '../shared';

interface SystemStatusPillProps {
  stats: PublicStats | null;
  loading: boolean;
  timeZone: string;
  timeMode: TimeMode;
}

export function SystemStatusPill({ stats, loading, timeZone, timeMode }: SystemStatusPillProps) {
  const meta = STATUS_META[stats?.system_status ?? 'operational'];

  return (
    <div className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full px-4 py-2', meta.ring)} role="status" aria-live="polite">
      <span className="relative flex size-2.5">
        <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', meta.dot)} />
        <span className={cn('relative inline-flex size-2.5 rounded-full', meta.dot)} />
      </span>
      <span className={cn('text-[14px] font-semibold', meta.text)}>{loading ? 'Checking status…' : meta.label}</span>
      {stats?.last_tx_at && (
        <span className="text-[13px] text-[var(--lp-body)]">
          · Last activity {formatFeedDate(stats.last_tx_at, timeZone, timeMode, 'short')}
        </span>
      )}
    </div>
  );
}
