'use client';

/** Small presentational helpers shared by the explorer table, cards, and modal. */

import { cn } from '@/lib/utils';
import type { TxType } from '@/types/public';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowLeftRight } from 'lucide-react';
import { ACTIVITY_LOOK, SETTLED_TONE, activityStatus } from '@/components/dashboard/activity-look';
import type { ComponentType } from 'react';

export type TimeMode = 'absolute' | 'relative';

/**
 * Each kind of public record, marked as the dashboard marks it (ACTIVITY_LOOK), so a deposit
 * looks like a deposit everywhere. Only the words differ: the public record names a transfer
 * without saying which side of it you are on.
 */
export const TYPE_META: Record<TxType, { label: string; Icon: ComponentType<{ className?: string }>; badge: string }> = {
  deposit: { label: 'Deposit', Icon: ACTIVITY_LOOK.deposit.icon, badge: ACTIVITY_LOOK.deposit.badge },
  withdrawal: { label: 'Withdrawal', Icon: ACTIVITY_LOOK.withdrawal.icon, badge: ACTIVITY_LOOK.withdrawal.badge },
  transfer: { label: 'Transfer', Icon: ArrowLeftRight, badge: ACTIVITY_LOOK.sent.badge },
  bridge: { label: 'Move', Icon: ACTIVITY_LOOK.bridge.icon, badge: ACTIVITY_LOOK.bridge.badge },
};

/** A record's status chip: the dashboard's badge, or a green one naming the settled state. */
export function statusBadge(status: string): { text: string; tone: string } {
  const words = status.replace(/_/g, ' ');
  return activityStatus(status) ?? { text: words.charAt(0).toUpperCase() + words.slice(1), tone: SETTLED_TONE };
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
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', meta.badge)}>
        <Icon className="size-4" />
      </span>
      <span className="text-[15px] font-semibold">{meta.label}</span>
    </span>
  );
}
