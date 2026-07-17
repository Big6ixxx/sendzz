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
    <div
      className={cn('inline-flex items-center gap-3 px-4 py-2 rounded-full border', meta.ring)}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span
          className={cn('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', meta.dot)}
        />
        <span className={cn('relative inline-flex rounded-full h-2.5 w-2.5', meta.dot)} />
      </span>
      <span className={cn('text-xs font-bold uppercase tracking-widest', meta.text)}>
        {loading ? 'Checking status…' : meta.label}
      </span>
      {stats?.last_tx_at && (
        <span className="text-[10px] font-medium text-white/40 tracking-wide border-l border-white/15 pl-3">
          Last activity {formatFeedDate(stats.last_tx_at, timeZone, timeMode, 'short')}
        </span>
      )}
    </div>
  );
}
