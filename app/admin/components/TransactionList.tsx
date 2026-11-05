'use client';

/**
 * A page of transactions: a table where there is room for one, a list of cards where there is
 * not. Shared by the transactions view and a user's own page, so a row reads the same in both.
 */

import { format } from 'date-fns';
import { Check, Copy } from 'lucide-react';
import { getChainInfo, getSecondaryHash, getTxHash } from '@/lib/receipt/txHelpers';
import { ADMIN_DATE_RANGE_LABELS, type AdminDateRange, type AdminTransaction } from '@/types/admin';
import { cn } from '@/lib/utils';
import { EmptyState, Pills, RowsShimmer, SearchField, StatusBadge, TxTypeBadge, txTypeLook, useCopied } from './ui';
import { formatUsd } from '@/lib/format-usdc';

const TYPE_OPTIONS: { label: string; value: string | null }[] = [
  { label: 'All', value: null },
  { label: 'Deposits', value: 'deposit' },
  { label: 'Withdrawals', value: 'withdrawal' },
  { label: 'Transfers', value: 'transfer' },
  { label: 'Bridges', value: 'bridge' },
];

const DATE_OPTIONS = (Object.keys(ADMIN_DATE_RANGE_LABELS) as AdminDateRange[]).map((r) => ({ label: ADMIN_DATE_RANGE_LABELS[r], value: r }));

/** Does a transaction match a free-text search, by hash, ID, type, status or network? */
export function matchesTxSearch(tx: AdminTransaction, search: string): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  return (
    getTxHash(tx).toLowerCase().includes(s) ||
    tx.id.toLowerCase().includes(s) ||
    tx.tx_type.includes(s) ||
    (tx.status ?? '').toLowerCase().includes(s) ||
    getChainInfo(tx).toLowerCase().includes(s)
  );
}

/** The date window, the type and a search, over a list of transactions. */
export function TransactionFilters({
  dateRange,
  onDateRange,
  type,
  onType,
  search,
  onSearch,
}: {
  dateRange: AdminDateRange;
  onDateRange: (range: AdminDateRange) => void;
  type: string | null;
  onType: (type: string | null) => void;
  search: string;
  onSearch: (search: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Pills label="Date range" options={DATE_OPTIONS} value={dateRange} onChange={onDateRange} />
        <Pills label="Type" tone="green" options={TYPE_OPTIONS} value={type} onChange={onType} />
      </div>
      <SearchField value={search} onChange={onSearch} placeholder="Search hash, ID, status or network" />
    </div>
  );
}

const short = (hash: string, head = 10, tail = 6) => (hash.length > head + tail + 1 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : hash);

function CopyHash({ hash, className }: { hash: string; className?: string }) {
  const [copied, copy] = useCopied();
  if (hash === '—') return <span className={cn('lp-mono text-[12px] text-[var(--lp-muted)]', className)}>—</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy(hash);
      }}
      title={`Copy ${hash}`}
      className={cn(
        'lp-mono inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--lp-cream)] px-2.5 py-1 text-[12px] text-[var(--lp-body)] transition-colors hover:bg-[var(--lp-soft-2)] hover:text-[var(--lp-ink)]',
        className,
      )}
    >
      <span className="truncate">{short(hash)}</span>
      {copied ? <Check className="size-3 shrink-0 text-[var(--lp-good)]" /> : <Copy className="size-3 shrink-0 opacity-50" />}
    </button>
  );
}

export function TransactionList({
  items,
  loading,
  emptyTitle = 'No transactions',
  emptyItalic = 'here.',
  emptyBody,
}: {
  items: AdminTransaction[];
  loading: boolean;
  emptyTitle?: string;
  emptyItalic?: string;
  emptyBody?: string;
}) {
  if (loading) return <RowsShimmer rows={8} />;
  if (items.length === 0) return <EmptyState title={emptyTitle} italic={emptyItalic} body={emptyBody} />;

  return (
    <>
      {/* Phones: one card per transaction. */}
      <ul className="divide-y divide-[var(--lp-soft-2)] md:hidden">
        {items.map((tx) => {
          const hash = getTxHash(tx);
          return (
            <li key={`${tx.tx_type}-${tx.id}`} className="space-y-3 px-5 py-4">
              <div className="flex items-start gap-3">
                <TxTypeBadge type={tx.tx_type} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[15px] font-semibold">{txTypeLook(tx.tx_type).label}</p>
                    <p className="lp-display shrink-0 text-[18px] leading-tight tracking-[-0.02em] tabular-nums">{formatUsd(Number(tx.amount))}</p>
                  </div>
                  <p className="truncate text-[13px] text-[var(--lp-muted)]">{getChainInfo(tx)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pl-[52px]">
                <StatusBadge status={tx.status ?? ''} />
                <span className="text-[13px] text-[var(--lp-muted)] tabular-nums">{format(new Date(tx.created_at), 'd MMM, HH:mm')}</span>
              </div>
              {hash !== '—' && (
                <div className="pl-[52px]">
                  <CopyHash hash={hash} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Tablets and up: a table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="lp-mono border-b border-[var(--lp-rule)] text-[11px] uppercase text-[var(--lp-muted)] sm:text-[12px]">
              <th className="px-6 py-4 font-normal">Activity</th>
              <th className="px-4 py-4 font-normal">Transaction</th>
              <th className="px-4 py-4 font-normal">Status</th>
              <th className="px-4 py-4 text-right font-normal">Amount</th>
              <th className="px-6 py-4 text-right font-normal">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--lp-soft-2)]">
            {items.map((tx) => {
              const hash = getTxHash(tx);
              const mint = tx.tx_type === 'bridge' ? getSecondaryHash(tx) : '—';
              return (
                <tr key={`${tx.tx_type}-${tx.id}`} className="transition-colors hover:bg-[var(--lp-raised)]">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <TxTypeBadge type={tx.tx_type} />
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold">{txTypeLook(tx.tx_type).label}</p>
                        <p className="max-w-[220px] truncate text-[13px] text-[var(--lp-muted)]">{getChainInfo(tx)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col items-start gap-1.5">
                      <CopyHash hash={hash} />
                      {mint !== '—' && (
                        <span className="flex items-center gap-1.5">
                          <span className="lp-mono text-[11px] uppercase text-[var(--lp-violet)]">Mint</span>
                          <CopyHash hash={mint} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={tx.status ?? ''} />
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="lp-display text-[18px] tracking-[-0.02em] tabular-nums">{formatUsd(Number(tx.amount))}</span>
                    <span className="lp-mono ml-1.5 text-[11px] text-[var(--lp-muted)]">USDC</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <p className="text-[14px]">{format(new Date(tx.created_at), 'd MMM yyyy')}</p>
                    <p className="text-[12px] text-[var(--lp-muted)] tabular-nums">{format(new Date(tx.created_at), 'HH:mm')}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
