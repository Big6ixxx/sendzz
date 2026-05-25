'use client';

import { getAdminTransactions } from '@/lib/supabase/admin';
import { cn } from '@/lib/utils';
import { AdminTransaction } from '@/types/admin';
import { exportTransactionsPDF } from '@/lib/receipt/exportPdf';
import { getTxHash, getSecondaryHash, getChainInfo } from '@/lib/receipt/txHelpers';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Link,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';

type DateRange = '7d' | '30d' | '6m' | '1y' | 'all';

const ITEMS_PER_PAGE = 20;

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '7d': '7 Days',
  '30d': '1 Month',
  '6m': '6 Months',
  '1y': '1 Year',
  all: 'All Time',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminTransactions() {
  const { user } = usePrivy();
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-transactions', filterType, dateRange, user?.email?.address],
    queryFn: async () => {
      if (!user?.email?.address) return [];
      return getAdminTransactions(user.email.address, filterType || undefined, dateRange);
    },
    enabled: !!user?.email?.address,
  });

  const filteredTransactions = useMemo(() => {
    return ((data || []) as AdminTransaction[]).filter((tx) => {
      if (!search) return true;
      const s = search.toLowerCase();
      const hash = getTxHash(tx).toLowerCase();
      return (
        hash.includes(s) ||
        tx.id.toLowerCase().includes(s) ||
        tx.tx_type.includes(s) ||
        tx.status.toLowerCase().includes(s) ||
        getChainInfo(tx).toLowerCase().includes(s)
      );
    });
  }, [data, search]);

  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const currentItems = filteredTransactions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'claimed':
      case 'confirmed':
      case 'complete':
        return 'bg-[#00e87a]/10 text-[#00e87a]';
      case 'pending':
      case 'pending_claim':
      case 'awaiting_verification':
      case 'processing':
        return 'bg-amber-400/10 text-amber-400';
      case 'failed':
      case 'cancelled':
        return 'bg-red-400/10 text-red-400';
      default:
        return 'bg-white/5 text-white/50';
    }
  };

  const getTxIcon = (type: string) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownLeft className="w-4 h-4 text-accent" />;
      case 'withdrawal':
        return <ArrowUpRight className="w-4 h-4 text-red-400" />;
      case 'transfer':
        return <ArrowLeftRight className="w-4 h-4 text-blue-400" />;
      case 'bridge':
        return <Link className="w-4 h-4 text-purple-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight">
            Transactions
          </h1>
          <p className="text-white/40 mt-1 font-medium">
            {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''} · {DATE_RANGE_LABELS[dateRange]}
          </p>
        </div>
        <button
          onClick={async () => {
            setExporting(true);
            try {
              await exportTransactionsPDF(filteredTransactions, dateRange);
            } finally {
              setExporting(false);
            }
          }}
          disabled={filteredTransactions.length === 0 || exporting}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all text-xs font-bold uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Download className={cn('w-4 h-4', exporting && 'animate-bounce')} />
          {exporting ? 'Generating PDF…' : `Export PDF (${filteredTransactions.length})`}
        </button>
      </div>

      {/* Date Range + Type Filters */}
      <div className="space-y-3">
        {/* Date range */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((range) => (
            <button
              key={range}
              onClick={() => { setDateRange(range); setCurrentPage(1); }}
              className={cn(
                'px-4 h-9 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap',
                dateRange === range
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-white/3 border-white/8 text-white/30 hover:border-white/15 hover:text-white/60',
              )}
            >
              {DATE_RANGE_LABELS[range]}
            </button>
          ))}
        </div>

        {/* Search + type filters */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              placeholder="Search by tx hash, type, status..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-accent/50 transition-all"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
            {[
              { label: 'All', value: null },
              { label: 'Deposits', value: 'deposit' },
              { label: 'Withdrawals', value: 'withdrawal' },
              { label: 'Transfers', value: 'transfer' },
              { label: 'Bridges', value: 'bridge' },
            ].map((type) => (
              <button
                key={type.label}
                onClick={() => { setFilterType(type.value); setCurrentPage(1); }}
                className={cn(
                  'px-5 h-12 rounded-2xl text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap',
                  filterType === type.value
                    ? 'bg-accent/10 border-accent/30 text-accent'
                    : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20 hover:text-white',
                )}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="card-glass p-0 overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Type</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">TX Hash</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Chain / Route</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Date (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-6 py-8">
                      <div className="h-4 bg-white/5 rounded-full w-full" />
                    </td>
                  </tr>
                ))
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <p className="text-white/20 font-medium">No transactions found.</p>
                  </td>
                </tr>
              ) : (
                (currentItems as AdminTransaction[]).map((tx, i) => {
                  const hash = getTxHash(tx);
                  const secondaryHash = getSecondaryHash(tx);
                  return (
                    <motion.tr
                      key={tx.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="hover:bg-white/2 transition-colors group"
                    >
                      {/* Type */}
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-white/5">
                            {getTxIcon(tx.tx_type)}
                          </div>
                          <span className="text-xs font-bold text-white/80 uppercase tracking-wider">
                            {tx.tx_type}
                          </span>
                        </div>
                      </td>

                      {/* TX Hash */}
                      <td className="px-6 py-5">
                        <div className="space-y-1.5">
                          {hash !== '—' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-white/60 bg-white/5 px-2 py-1 rounded-lg border border-white/8 tracking-tight">
                                {hash.slice(0, 10)}…{hash.slice(-8)}
                              </span>
                              <button
                                onClick={() => navigator.clipboard.writeText(hash)}
                                title="Copy full hash"
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-accent"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] font-mono text-white/15">—</span>
                          )}
                          {/* Bridge: show mint hash too */}
                          {tx.tx_type === 'bridge' && secondaryHash !== '—' && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-purple-400/50">mint</span>
                              <span className="text-[10px] font-mono text-white/30 tracking-tight">
                                {secondaryHash.slice(0, 8)}…{secondaryHash.slice(-6)}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Chain / Route */}
                      <td className="px-6 py-5">
                        <span className="text-xs font-medium text-white/50">
                          {getChainInfo(tx)}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="px-6 py-5">
                        <div className="flex items-baseline gap-1">
                          <span className="text-sm font-bold text-white">
                            ${Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] font-bold text-white/20 tracking-tighter uppercase">USDC</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-5">
                        <span className={cn(
                          'px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap',
                          getStatusColor(tx.status),
                        )}>
                          {tx.status.replace(/_/g, ' ')}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="px-6 py-5 text-xs font-medium text-white/40 whitespace-nowrap">
                        {format(new Date(tx.created_at), 'MMM dd yyyy, HH:mm')}
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-6 py-4 bg-white/2 border-t border-white/5 flex items-center justify-between">
          <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredTransactions.length)} of {filteredTransactions.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-white/5 text-white/20 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 text-[10px] font-bold text-white/40 uppercase tracking-widest">
              Page {currentPage} of {totalPages || 1}
            </div>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="p-2 rounded-lg bg-white/5 text-white/20 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
