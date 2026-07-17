'use client';

import type { PublicFeedRow } from '@/types/public';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PAGE_SIZE } from '../constants';
import type { TimeMode } from '../shared';
import { RowActionsMenu } from './RowActionsMenu';
import { TxCard, TxCardSkeleton, TxTableRow, TxTableRowSkeleton } from './TransactionRows';

/** Share a transaction via the Web Share API, falling back to copying its deep link. */
async function shareTransaction(row: PublicFeedRow) {
  const url = `${window.location.origin}/explore?tx=${row.id}`;
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: 'Sendzz transaction', url });
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    }
  } catch {
    // User dismissed the share sheet — nothing to do.
  }
}

interface TransactionsFeedProps {
  rows: PublicFeedRow[];
  loading: boolean;
  fetching: boolean;
  total: number;
  page: number;
  totalPages: number;
  setPage: (updater: (p: number) => number) => void;
  timeZone: string;
  timeMode: TimeMode;
  abbrev: string;
  onOpenTx: (id: string) => void;
}

export function TransactionsFeed({
  rows,
  loading,
  fetching,
  total,
  page,
  totalPages,
  setPage,
  timeZone,
  timeMode,
  abbrev,
  onOpenTx,
}: TransactionsFeedProps) {
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);
  const dateHeader = `Date${timeMode === 'absolute' && abbrev ? ` (${abbrev})` : ''}`;

  // A single actions menu shared by every row — tracks which row/kebab it currently targets.
  const [actions, setActions] = useState<{ row: PublicFeedRow; anchor: HTMLElement } | null>(null);
  const openActions = (row: PublicFeedRow, anchor: HTMLElement) => setActions({ row, anchor });

  return (
    <section aria-labelledby="feed-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="feed-heading" className="font-display text-xl font-bold text-white tracking-tight">
            Transactions
          </h2>
          <p className="text-[11px] font-medium text-white/40 mt-0.5">
            {timeMode === 'relative'
              ? 'Times shown relative to now'
              : `Times in ${timeZone.replace(/_/g, ' ')}${abbrev ? ` · ${abbrev}` : ''}`}
          </p>
        </div>
        <p className="text-xs font-medium text-white/50 whitespace-nowrap" aria-live="polite">
          {fetching ? 'Updating…' : `Showing ${showingFrom}–${showingTo} of ${total.toLocaleString()}`}
        </p>
      </div>

      {/* Desktop table */}
      <div className="card-glass p-0! overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Public transaction feed</caption>
            <thead>
              <tr className="border-b border-white/8 bg-white/2">
                <th scope="col" className="px-6 py-4 text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">Type</th>
                <th scope="col" className="px-6 py-4 text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">Tx Hash</th>
                <th scope="col" className="px-6 py-4 text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">Chain / Route</th>
                <th scope="col" className="px-6 py-4 text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">Amount</th>
                <th scope="col" className="px-6 py-4 text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">Status</th>
                <th scope="col" className="px-6 py-4 text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">{dateHeader}</th>
                <th scope="col" className="px-6 py-4 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <TxTableRowSkeleton key={i} />)
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-white/40 font-medium">
                    No transactions match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <TxTableRow
                    key={row.id}
                    row={row}
                    timeZone={timeZone}
                    timeMode={timeMode}
                    onOpenActions={openActions}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <TxCardSkeleton key={i} />)
        ) : rows.length === 0 ? (
          <div className="card-glass py-16 text-center text-white/40 font-medium">
            No transactions match these filters.
          </div>
        ) : (
          rows.map((row) => (
            <TxCard
              key={row.id}
              row={row}
              timeZone={timeZone}
              timeMode={timeMode}
              onOpenActions={openActions}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      <nav aria-label="Pagination" className="flex items-center justify-between pt-2">
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
          Page {page} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="inline-flex items-center gap-1 px-4 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs font-bold uppercase tracking-widest"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="inline-flex items-center gap-1 px-4 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs font-bold uppercase tracking-widest"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </nav>

      <RowActionsMenu
        row={actions?.row ?? null}
        anchorEl={actions?.anchor ?? null}
        onOpenChange={(open) => {
          if (!open) setActions(null);
        }}
        onView={(row) => {
          setActions(null);
          onOpenTx(row.id);
        }}
        onShare={(row) => {
          setActions(null);
          void shareTransaction(row);
        }}
      />
    </section>
  );
}
