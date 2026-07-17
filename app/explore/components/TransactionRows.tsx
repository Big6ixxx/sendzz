'use client';

import { explorerUrlFor, routeLabel, secondaryExplorerUrlFor } from '@/lib/chains';
import { cn } from '@/lib/utils';
import type { PublicFeedRow } from '@/types/public';
import { ExternalLink, MoreVertical } from 'lucide-react';
import {
  formatFeedDate,
  formatStatus,
  formatUsdc,
  shortHash,
  statusClasses,
  type TimeMode,
  TypeBadge,
} from '../shared';

interface RowProps {
  row: PublicFeedRow;
  timeZone: string;
  timeMode: TimeMode;
  /** Open the shared actions menu, anchored to the clicked kebab button. */
  onOpenActions: (row: PublicFeedRow, anchor: HTMLElement) => void;
}

function ConsolidatedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block px-2 py-0.5 rounded-md bg-amber-400/15 text-amber-300 text-[9px] font-bold uppercase tracking-widest',
        className,
      )}
    >
      Consolidated
    </span>
  );
}

function ActionsButton({ row, onOpenActions }: Pick<RowProps, 'row' | 'onOpenActions'>) {
  return (
    <button
      type="button"
      onClick={(e) => onOpenActions(row, e.currentTarget)}
      aria-haspopup="menu"
      aria-label={`Actions for ${row.tx_type} of ${formatUsdc(row.amount)} USDC`}
      className="grid place-items-center w-9 h-9 rounded-lg text-white/40 hover:text-white hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none transition-colors"
    >
      <MoreVertical className="w-4 h-4" />
    </button>
  );
}

function MintLine({ row }: { row: PublicFeedRow }) {
  const mintUrl = secondaryExplorerUrlFor(row);
  return (
    <div className="flex items-center gap-1.5 pl-0.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-purple-300/70">Mint</span>
      {mintUrl ? (
        <a
          href={mintUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[10px] text-white/40 hover:text-accent transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none rounded"
        >
          {shortHash(row.secondary_tx_hash!, 8, 6)}
          <ExternalLink className="w-2.5 h-2.5" aria-hidden />
        </a>
      ) : (
        <span className="font-mono text-[10px] text-white/40">{shortHash(row.secondary_tx_hash!, 8, 6)}</span>
      )}
    </div>
  );
}

/** Column-aware skeleton row mirroring the desktop table layout. */
export function TxTableRowSkeleton() {
  return (
    <tr className="animate-pulse">
      <td className="px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/5" />
          <div className="h-3 w-16 rounded bg-white/5" />
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="h-6 w-32 rounded-lg bg-white/5" />
      </td>
      <td className="px-6 py-4">
        <div className="h-3 w-24 rounded bg-white/5" />
      </td>
      <td className="px-6 py-4">
        <div className="h-3 w-16 rounded bg-white/5" />
      </td>
      <td className="px-6 py-4">
        <div className="h-5 w-20 rounded-full bg-white/5" />
      </td>
      <td className="px-6 py-4">
        <div className="h-3 w-28 rounded bg-white/5" />
      </td>
      <td className="px-6 py-4">
        <div className="ml-auto w-9 h-9 rounded-lg bg-white/5" />
      </td>
    </tr>
  );
}

/** Skeleton mirroring the mobile card layout. */
export function TxCardSkeleton() {
  return (
    <div className="card-glass p-4! space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/5" />
          <div className="h-3 w-16 rounded bg-white/5" />
        </div>
        <div className="h-5 w-16 rounded-full bg-white/5" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-5 w-24 rounded bg-white/5" />
        <div className="h-3 w-20 rounded bg-white/5" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded bg-white/5" />
        <div className="h-3 w-16 rounded bg-white/5" />
      </div>
    </div>
  );
}

/** Desktop table row. Actions live in the trailing kebab menu, not a whole-row click. */
export function TxTableRow({ row, timeZone, timeMode, onOpenActions }: RowProps) {
  const explorerUrl = explorerUrlFor(row);
  const showMint = row.tx_type === 'bridge' && !!row.secondary_tx_hash;
  return (
    <tr className="hover:bg-white/2 transition-colors">
      <td className="px-6 py-4">
        <TypeBadge type={row.tx_type} />
      </td>
      <td className="px-6 py-4">
        <div className="space-y-1.5">
          {row.tx_hash ? (
            explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-white/70 hover:text-accent bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/8 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
              >
                {shortHash(row.tx_hash, 10, 8)}
                <ExternalLink className="w-3 h-3" aria-hidden />
              </a>
            ) : (
              <span className="font-mono text-[11px] text-white/70">{shortHash(row.tx_hash, 10, 8)}</span>
            )
          ) : (
            <span className="font-mono text-[11px] text-white/25">—</span>
          )}
          {showMint && <MintLine row={row} />}
        </div>
      </td>
      <td className="px-6 py-4">
        <span className="text-xs font-medium text-white/70">{routeLabel(row)}</span>
        {row.consolidated && <ConsolidatedBadge className="ml-2" />}
      </td>
      <td className="px-6 py-4">
        <span className="text-sm font-bold text-white">${formatUsdc(row.amount)}</span>
        <span className="ml-1 text-[10px] font-bold text-white/30 uppercase">{row.asset}</span>
      </td>
      <td className="px-6 py-4">
        <span
          className={cn(
            'px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap',
            statusClasses(row.status),
          )}
        >
          {formatStatus(row.status)}
        </span>
      </td>
      <td className="px-6 py-4 text-xs font-medium text-white/50 whitespace-nowrap">
        {formatFeedDate(row.created_at, timeZone, timeMode, 'long')}
      </td>
      <td className="px-6 py-4 text-right">
        <ActionsButton row={row} onOpenActions={onOpenActions} />
      </td>
    </tr>
  );
}

/** Mobile card. Actions live in the header kebab menu. */
export function TxCard({ row, timeZone, timeMode, onOpenActions }: RowProps) {
  return (
    <div className="card-glass p-4! space-y-3">
      <div className="flex items-center justify-between gap-3">
        <TypeBadge type={row.tx_type} />
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest',
              statusClasses(row.status),
            )}
          >
            {formatStatus(row.status)}
          </span>
          <ActionsButton row={row} onOpenActions={onOpenActions} />
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-display font-bold text-white">
          ${formatUsdc(row.amount)}{' '}
          <span className="text-[10px] font-bold text-white/30 uppercase">{row.asset}</span>
        </span>
        <span className="text-[11px] font-medium text-white/50">{routeLabel(row)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-white/40">
        <span className="font-mono">{row.tx_hash ? shortHash(row.tx_hash, 8, 6) : '—'}</span>
        <span>{formatFeedDate(row.created_at, timeZone, timeMode, 'short')}</span>
      </div>
      {row.tx_type === 'bridge' && row.secondary_tx_hash && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="text-[9px] font-bold uppercase tracking-widest text-purple-300/70">Mint</span>
          <span className="font-mono text-white/40">{shortHash(row.secondary_tx_hash, 8, 6)}</span>
        </div>
      )}
      {row.consolidated && <ConsolidatedBadge />}
    </div>
  );
}
