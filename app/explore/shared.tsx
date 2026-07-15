'use client';

/** Small presentational helpers shared by the explorer table, cards, and modal. */

import { cn } from '@/lib/utils';
import type { TxType } from '@/types/public';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Link2 } from 'lucide-react';
import type { ComponentType } from 'react';

export type TimeMode = 'absolute' | 'relative';

export const TYPE_META: Record<
  TxType,
  { label: string; Icon: ComponentType<{ className?: string }>; color: string; bg: string }
> = {
  deposit: { label: 'Deposit', Icon: ArrowDownLeft, color: 'text-[#00e87a]', bg: 'bg-[#00e87a]/10' },
  withdrawal: { label: 'Withdrawal', Icon: ArrowUpRight, color: 'text-red-400', bg: 'bg-red-400/10' },
  transfer: { label: 'Transfer', Icon: ArrowLeftRight, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  bridge: { label: 'Bridge', Icon: Link2, color: 'text-purple-400', bg: 'bg-purple-400/10' },
};

/** Status → chip classes. AA-contrast on the #0a0a0b background. */
export function statusClasses(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'claimed':
    case 'confirmed':
    case 'complete':
      return 'bg-[#00e87a]/15 text-[#00e87a]';
    case 'pending':
    case 'pending_claim':
    case 'awaiting_verification':
    case 'processing':
      return 'bg-amber-400/15 text-amber-300';
    case 'failed':
    case 'cancelled':
      return 'bg-red-400/15 text-red-300';
    case 'reversed':
    case 'refunded':
      return 'bg-sky-400/15 text-sky-300';
    default:
      return 'bg-white/10 text-white/60';
  }
}

export function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

export function formatUsdc(amount: number): string {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function shortHash(hash: string, head = 8, tail = 6): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

// ─── Timezone-aware date formatting ──────────────────────────────────────────
// All feed timestamps are rendered in a caller-chosen IANA timezone via Intl (no extra
// dependency). Callers pass the user's selected timezone; see ExploreClient.

function formatInTimeZone(iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(new Date(iso));
  } catch {
    // Invalid timezone → fall back to the runtime default.
    return new Intl.DateTimeFormat('en-US', opts).format(new Date(iso));
  }
}

const LONG_OPTS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

const SHORT_OPTS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/** e.g. "Jul 15, 2026, 14:34" in the given timezone. */
export function formatDateLong(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, LONG_OPTS);
}

/** e.g. "Jul 15, 14:34" in the given timezone. */
export function formatDateShort(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, SHORT_OPTS);
}

/** Relative-to-now label, e.g. "Just now", "5 seconds ago", "2 hours ago". Timezone-agnostic. */
export function formatRelative(iso: string): string {
  const date = new Date(iso);
  const absSec = Math.abs(Date.now() - date.getTime()) / 1000;
  if (absSec < 5) return 'Just now';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** Format a feed timestamp per the active display mode. */
export function formatFeedDate(
  iso: string,
  timeZone: string,
  mode: TimeMode,
  variant: 'long' | 'short',
): string {
  if (mode === 'relative') return formatRelative(iso);
  return variant === 'long' ? formatDateLong(iso, timeZone) : formatDateShort(iso, timeZone);
}

/** Short abbreviation for a timezone right now, e.g. "GMT+1" / "WAT" / "UTC". */
export function timeZoneAbbrev(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(
      new Date(),
    );
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function TypeBadge({ type }: { type: TxType }) {
  const meta = TYPE_META[type];
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={cn('grid place-items-center w-8 h-8 rounded-lg shrink-0', meta.bg)}>
        <Icon className={cn('w-4 h-4', meta.color)} />
      </span>
      <span className="text-xs font-bold text-white/80 uppercase tracking-wider">{meta.label}</span>
    </span>
  );
}
