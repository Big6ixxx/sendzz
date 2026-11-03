'use client';

import { getAdminTransactions } from '@/lib/supabase/admin';
import { AdminTransaction, ADMIN_DATE_RANGE_LABELS, type AdminDateRange } from '@/types/admin';
import { exportTransactionsPDF } from '@/lib/receipt/exportPdf';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { matchesTxSearch, TransactionFilters, TransactionList } from '../components/TransactionList';
import { PageHeader, Pagination, Panel, PrimaryButton, StatTile } from '../components/ui';
import { formatUsd } from '@/lib/format-usdc';

const ITEMS_PER_PAGE = 20;

const SETTLED = ['completed', 'claimed', 'confirmed', 'complete'];
const WAITING = ['pending', 'pending_claim', 'awaiting_verification', 'processing'];

export default function AdminTransactions() {
  const { user, getAccessToken } = usePrivy();
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<AdminDateRange>('30d');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ['admin-transactions', filterType, dateRange, user?.email?.address],
    queryFn: async () => {
      if (!user?.email?.address) return [];
      return getAdminTransactions(filterType || undefined, dateRange, (await getAccessToken()) ?? undefined);
    },
    enabled: !!user?.email?.address,
  });

  const filteredTransactions = useMemo(
    () => ((data || []) as AdminTransaction[]).filter((tx) => matchesTxSearch(tx, search)),
    [data, search],
  );

  const summary = useMemo(() => {
    let volume = 0;
    let settled = 0;
    let waiting = 0;
    for (const tx of filteredTransactions) {
      volume += Number(tx.amount) || 0;
      const s = (tx.status ?? '').toLowerCase();
      if (SETTLED.includes(s)) settled++;
      else if (WAITING.includes(s)) waiting++;
    }
    return { volume, settled, waiting };
  }, [filteredTransactions]);

  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const currentItems = filteredTransactions.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const count = filteredTransactions.length;

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        eyebrow="Transactions"
        title="Every transaction,"
        italic="in one place."
        actions={
          <PrimaryButton
            onClick={async () => {
              setExporting(true);
              try {
                await exportTransactionsPDF(filteredTransactions, dateRange);
              } finally {
                setExporting(false);
              }
            }}
            disabled={count === 0 || exporting}
          >
            <Download className={cn('size-4', exporting && 'animate-bounce')} />
            {exporting ? 'Generating PDF…' : `Export PDF (${count})`}
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <StatTile label="Transactions" value={count.toLocaleString('en-US')} loading={isPending} hint={ADMIN_DATE_RANGE_LABELS[dateRange]} />
        <StatTile label="Volume" value={formatUsd(summary.volume, 0)} loading={isPending} hint="Matching the filters" />
        <StatTile label="Settled" value={summary.settled.toLocaleString('en-US')} loading={isPending} tone="text-[#0e7a45]" hint={count ? `${Math.round((summary.settled / count) * 100)}% of these` : '—'} />
        <StatTile
          label="Needs attention"
          value={summary.waiting.toLocaleString('en-US')}
          loading={isPending}
          tone={summary.waiting > 0 ? 'text-[#8a5a00]' : undefined}
          hint="Still pending or processing"
        />
      </div>

      <TransactionFilters
        dateRange={dateRange}
        onDateRange={(r) => {
          setDateRange(r);
          setCurrentPage(1);
        }}
        type={filterType}
        onType={(t) => {
          setFilterType(t);
          setCurrentPage(1);
        }}
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setCurrentPage(1);
        }}
      />

      <Panel className="overflow-hidden">
        <TransactionList
          items={currentItems}
          loading={isPending}
          emptyTitle="Nothing matches"
          emptyItalic="these filters."
          emptyBody="Try a longer date range, another type, or a different search."
        />
        {!isPending && count > 0 && (
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onChange={(p) => setCurrentPage(Math.min(Math.max(p, 1), Math.max(totalPages, 1)))}
            summary={
              <>
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, count)} of {count.toLocaleString('en-US')}
              </>
            }
          />
        )}
      </Panel>
    </div>
  );
}
