'use client';

import { explorerUrlFor, routeLabel, secondaryExplorerUrlFor } from '@/lib/chains';
import { cn } from '@/lib/utils';
import type { PublicFeedRow } from '@/types/public';
import { ExternalLink, MoreVertical } from 'lucide-react';
import {
  formatFeedDate,
  shortHash,
  statusBadge,
  type TimeMode,
  TypeBadge,
} from '../shared';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@/lib/format-usdc';

interface RowProps {
  row: PublicFeedRow;
  timeZone: string;
  timeMode: TimeMode;
  /** Open the shared actions menu, anchored to the clicked kebab button. */
  onOpenActions: (row: PublicFeedRow, anchor: HTMLElement) => void;
}

function ConsolidatedBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-block rounded-full bg-[#fbedcc] px-2 py-px text-[11px] font-semibold text-[#8a5a00]', className)}>
      Combined
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const badge = statusBadge(status);
  return <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold', badge.tone)}>{badge.text}</span>;
}

function ActionsButton({ row, onOpenActions }: Pick<RowProps, 'row' | 'onOpenActions'>) {
  return (
    <button
      type="button"
      onClick={(e) => onOpenActions(row, e.currentTarget)}
      aria-haspopup="menu"
      aria-label={`Actions for ${row.tx_type} of ${formatMoney(row.amount)} USDC`}
      className="grid size-9 place-items-center rounded-full text-[var(--lp-muted)] outline-none transition-colors hover:bg-[var(--lp-cream)] hover:text-[var(--lp-ink)] focus-visible:ring-2 focus-visible:ring-[var(--lp-ink)]"
    >
      <MoreVertical className="size-4" />
    </button>
  );
}

/** A hash, linked to its explorer when there is one. */
function HashLink({ hash, url, head = 10, tail = 8 }: { hash: string; url: string | null; head?: number; tail?: number }) {
  const text = <span className="lp-mono text-[13px]">{shortHash(hash, head, tail)}</span>;
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lp-cream)] px-3 py-1 outline-none transition-colors hover:bg-[var(--lp-sand)] focus-visible:ring-2 focus-visible:ring-[var(--lp-ink)]"
    >
      {text}
      <ExternalLink className="size-3 text-[var(--lp-muted)]" aria-hidden />
    </a>
  ) : (
    text
  );
}

function MintLine({ row }: { row: PublicFeedRow }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-[var(--lp-muted)]">
      Arrived
      <HashLink hash={row.secondary_tx_hash!} url={secondaryExplorerUrlFor(row)} head={8} tail={6} />
    </p>
  );
}

const bar = (w: string) => <Skeleton className={cn('h-3.5', w)} />;

/** Column-aware skeleton row mirroring the desktop table layout. */
export function TxTableRowSkeleton() {
  return (
    <tr>
      <td className="px-5 py-4">
        <span className="flex items-center gap-2.5">
          <Skeleton className="size-9" />
          {bar('w-16')}
        </span>
      </td>
      <td className="px-5 py-4">{bar('w-36')}</td>
      <td className="px-5 py-4">{bar('w-24')}</td>
      <td className="px-5 py-4">{bar('w-16')}</td>
      <td className="px-5 py-4">{bar('w-20')}</td>
      <td className="px-5 py-4">{bar('w-28')}</td>
      <td className="px-5 py-4" />
    </tr>
  );
}

/** Skeleton mirroring the phone row. */
export function TxCardSkeleton() {
  return (
    <li className="flex items-center gap-3 py-4">
      <Skeleton className="size-9" />
      <span className="flex-1 space-y-2">
        {bar('w-1/3')}
        {bar('w-1/2')}
      </span>
      {bar('w-16')}
    </li>
  );
}

/** Desktop table row. Actions live in the trailing menu, not a whole-row click. */
export function TxTableRow({ row, timeZone, timeMode, onOpenActions }: RowProps) {
  const showMint = row.tx_type === 'bridge' && !!row.secondary_tx_hash;
  return (
    <tr className="transition-colors hover:bg-[#fbf9f4]">
      <td className="px-5 py-4">
        <TypeBadge type={row.tx_type} />
      </td>
      <td className="px-5 py-4">
        <div className="space-y-1.5">
          {row.tx_hash ? <HashLink hash={row.tx_hash} url={explorerUrlFor(row)} /> : <span className="text-[var(--lp-muted)]">—</span>}
          {showMint && <MintLine row={row} />}
        </div>
      </td>
      <td className="px-5 py-4 text-[14px] text-[var(--lp-body)]">
        {routeLabel(row)}
        {row.consolidated && <ConsolidatedBadge className="ml-2" />}
      </td>
      <td className="whitespace-nowrap px-5 py-4">
        <span className="lp-display text-[17px] tracking-[-0.02em] tabular-nums">${formatMoney(row.amount)}</span>
        <span className="ml-1 text-[12px] text-[var(--lp-muted)]">{row.asset}</span>
      </td>
      <td className="px-5 py-4">
        <StatusChip status={row.status} />
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-[14px] text-[var(--lp-muted)]">{formatFeedDate(row.created_at, timeZone, timeMode, 'long')}</td>
      <td className="px-5 py-4 text-right">
        <ActionsButton row={row} onOpenActions={onOpenActions} />
      </td>
    </tr>
  );
}

/** Phone row: the dashboard's activity row shape, with the hash and route underneath. */
export function TxCard({ row, timeZone, timeMode, onOpenActions }: RowProps) {
  return (
    <li className="space-y-2 py-4">
      <div className="flex items-center gap-3">
        <TypeBadge type={row.tx_type} />
        <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
          <span className="lp-display text-[17px] tracking-[-0.02em] tabular-nums">${formatMoney(row.amount)}</span>
          <StatusChip status={row.status} />
        </span>
        <ActionsButton row={row} onOpenActions={onOpenActions} />
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-12 text-[13px] text-[var(--lp-muted)]">
        <span>{routeLabel(row)}</span>
        <span aria-hidden>·</span>
        <span>{formatFeedDate(row.created_at, timeZone, timeMode, 'short')}</span>
        {row.tx_hash && (
          <>
            <span aria-hidden>·</span>
            <span className="lp-mono">{shortHash(row.tx_hash, 6, 4)}</span>
          </>
        )}
        {row.consolidated && <ConsolidatedBadge />}
      </p>
    </li>
  );
}
