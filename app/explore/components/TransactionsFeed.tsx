'use client';

import type { PublicFeedRow } from '@/types/public';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { PAGE_SIZE } from '../constants';
import type { TimeMode } from '../shared';
import { RowActionsMenu } from './RowActionsMenu';
import { TxCard, TxCardSkeleton, TxTableRow, TxTableRowSkeleton } from './TransactionRows';

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

  const th = 'px-5 py-3 lp-mono text-[11.5px] font-normal uppercase text-[var(--lp-muted)]';
  const empty = <p className="py-16 text-center text-[15px] text-[var(--lp-muted)]">No transactions match these filters.</p>;
  const pageButton =
    'inline-flex h-10 items-center gap-1 rounded-full bg-[var(--lp-surface)] px-4 text-[14px] font-semibold shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.12)] transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.4)] disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <section aria-labelledby="feed-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="feed-heading" className="lp-display text-[clamp(26px,4vw,34px)] tracking-[-0.03em]">
            Transactions
          </h2>
          <p className="mt-1 text-[14px] text-[var(--lp-muted)]">
            {timeMode === 'relative'
              ? 'Times shown relative to now'
              : `Times in ${timeZone.replace(/_/g, ' ')}${abbrev ? ` · ${abbrev}` : ''}`}
          </p>
        </div>
        <p className="text-[14px] text-[var(--lp-muted)]" aria-live="polite">
          {fetching ? 'Updating…' : `Showing ${showingFrom}–${showingTo} of ${total.toLocaleString()}`}
        </p>
      </div>

      {/* Desktop table */}
      <div className="lp-card hidden overflow-hidden rounded-[28px] md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Public transaction feed</caption>
            <thead>
              <tr className="border-b border-[var(--lp-line)]">
                <th scope="col" className={th}>Type</th>
                <th scope="col" className={th}>Transaction</th>
                <th scope="col" className={th}>Network</th>
                <th scope="col" className={th}>Amount</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>{dateHeader}</th>
                <th scope="col" className="px-5 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--lp-line)]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <TxTableRowSkeleton key={i} />)
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>{empty}</td>
                </tr>
              ) : (
                rows.map((row) => <TxTableRow key={row.id} row={row} timeZone={timeZone} timeMode={timeMode} onOpenActions={openActions} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phone rows */}
      <div className="lp-card rounded-[28px] px-4 md:hidden">
        {loading ? (
          <ul className="divide-y divide-[var(--lp-line)]">{Array.from({ length: 5 }).map((_, i) => <TxCardSkeleton key={i} />)}</ul>
        ) : rows.length === 0 ? (
          empty
        ) : (
          <ul className="divide-y divide-[var(--lp-line)]">
            {rows.map((row) => (
              <TxCard key={row.id} row={row} timeZone={timeZone} timeMode={timeMode} onOpenActions={openActions} />
            ))}
          </ul>
        )}
      </div>

      <nav aria-label="Pagination" className="flex items-center justify-between pt-2">
        <p className="text-[14px] text-[var(--lp-muted)]">
          Page {page} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page" className={pageButton}>
            <ChevronLeft className="size-4" /> Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
            className={pageButton}
          >
            Next <ChevronRight className="size-4" />
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
      />
    </section>
  );
}
