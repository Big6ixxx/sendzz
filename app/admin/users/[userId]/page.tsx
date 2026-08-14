'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check, 
  Copy,
  Download,
  ExternalLink,
  Link as LinkIcon,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import { exportTransactionsPDF } from '@/lib/receipt/exportPdf';
import { getChainInfo, getTxHash } from '@/lib/receipt/txHelpers';
import { getAdminUserDetail } from '@/lib/supabase/admin';
import { cn } from '@/lib/utils';
import {
  ADMIN_DATE_RANGE_LABELS,
  type AdminDateRange,
  type AdminTransaction,
} from '@/types/admin';

const ITEMS_PER_PAGE = 20;

// ─── Shared bits ─────────────────────────────────────────────────────────────

const usd = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Reuses the status palette from the transactions view so states read the same everywhere. */
function statusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'completed':
    case 'claimed':
    case 'confirmed':
    case 'complete':
    case 'approved':
      return 'bg-[#00e87a]/10 text-[#00e87a]';
    case 'pending':
    case 'pending_claim':
    case 'awaiting_verification':
    case 'processing':
    case 'in_review':
      return 'bg-amber-400/10 text-amber-400';
    case 'failed':
    case 'cancelled':
    case 'declined':
      return 'bg-red-400/10 text-red-400';
    case 'reversed':
      return 'bg-sky-400/10 text-sky-400';
    default:
      return 'bg-white/5 text-white/50';
  }
}

function txIcon(type: string) {
  switch (type) {
    case 'deposit':
      return <ArrowDownLeft className="w-4 h-4 text-accent" />;
    case 'withdrawal':
      return <ArrowUpRight className="w-4 h-4 text-red-400" />;
    case 'transfer':
      return <ArrowLeftRight className="w-4 h-4 text-blue-400" />;
    case 'bridge':
      return <LinkIcon className="w-4 h-4 text-purple-400" />;
    default:
      return null;
  }
}

function kycVisual(status: string) {
  switch (status) {
    case 'approved':
      return { Icon: ShieldCheck, tone: 'text-[#00e87a]', label: 'Approved' };
    case 'declined':
      return { Icon: ShieldAlert, tone: 'text-red-400', label: 'Declined' };
    case 'in_review':
      return { Icon: ShieldQuestion, tone: 'text-amber-400', label: 'In Review' };
    case 'pending':
      return { Icon: ShieldQuestion, tone: 'text-amber-400', label: 'Pending' };
    default:
      return { Icon: ShieldQuestion, tone: 'text-white/30', label: 'Not Started' };
  }
}

/**
 * One wallet address as a click-to-copy tile.
 *
 * Truncated rather than shown in full: these are 42–56 characters, and at full length one of
 * them dictates the width of everything beside it. Admins copy them into explorers far more
 * often than they read them, so the full value lives on the hover title and the clipboard.
 */
function WalletTile({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!value}
      title={value ?? undefined}
      className={cn(
        'card-glass p-4 border-white/5 text-left w-full group transition-colors',
        value ? 'hover:border-white/15' : 'cursor-default opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
          {label}
        </span>
        {value &&
          (copied ? (
            <Check className="w-3 h-3 text-[#00e87a] shrink-0" />
          ) : (
            <Copy className="w-3 h-3 text-white/15 group-hover:text-white/50 transition-colors shrink-0" />
          ))}
      </div>
      <code
        className={cn(
          'block mt-2 text-[11px] tabular-nums truncate transition-colors',
          value ? 'text-white/60 group-hover:text-white' : 'text-white/20',
        )}
      >
        {value ? `${value.slice(0, 10)}…${value.slice(-8)}` : 'Not provisioned'}
      </code>
    </button>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

// `useSearchParams` needs a Suspense boundary to prerender, so the view lives in a child.
export default function AdminUserDetailPage() {
  return (
    <Suspense fallback={<div className="h-96 rounded-3xl bg-white/2 animate-pulse" />}>
      <AdminUserDetail />
    </Suspense>
  );
}

function AdminUserDetail() {
  const { user: adminUser, getAccessToken } = usePrivy();
  const params = useParams<{ userId: string }>();
  const searchParams = useSearchParams();
  const userId = params?.userId;

  /**
   * Back to the directory *as it was* — the page and search the admin came from ride along in
   * the query string. Without this, reviewing user 7 on page 4 dumps you back on page 1 and
   * you have to re-find your place for every single account you check.
   */
  const backHref = useMemo(() => {
    const p = new URLSearchParams();
    const q = searchParams.get('q');
    const page = searchParams.get('page');
    if (q) p.set('q', q);
    if (page) p.set('page', page);
    const qs = p.toString();
    return `/admin/users${qs ? `?${qs}` : ''}`;
  }, [searchParams]);

  const [dateRange, setDateRange] = useState<AdminDateRange>('30d');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-user-detail', userId, dateRange, adminUser?.email?.address],
    queryFn: async () => {
      if (!adminUser?.email?.address || !userId) return null;
      return getAdminUserDetail(userId, dateRange, (await getAccessToken()) ?? undefined);
    },
    enabled: !!adminUser?.email?.address && !!userId,
  });

  // Type and text filtering happen client-side; the date window is applied by the query, so
  // changing it refetches rather than hiding rows that were never loaded.
  const filtered = useMemo(() => {
    const rows = (data?.transactions ?? []) as AdminTransaction[];
    return rows.filter((tx) => {
      if (filterType && tx.tx_type !== filterType) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        getTxHash(tx).toLowerCase().includes(s) ||
        tx.id.toLowerCase().includes(s) ||
        tx.tx_type.includes(s) ||
        (tx.status ?? '').toLowerCase().includes(s) ||
        getChainInfo(tx).toLowerCase().includes(s)
      );
    });
  }, [data, filterType, search]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const pageItems = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const user = data?.user;
  const kyc = data?.kyc;
  const totals = data?.totals;
  const { Icon: KycIcon, tone: kycTone, label: kycLabel } = kycVisual(kyc?.status ?? 'not_started');

  if (error) {
    return (
      <div className="card-glass p-16 text-center border-white/5">
        <p className="text-white/40 font-medium">
          {error instanceof Error ? error.message : 'Could not load this account.'}
        </p>
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 mt-6 text-xs font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300"
        >
          <ArrowLeft className="w-4 h-4" /> Back to directory
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> User Directory
        </Link>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-5 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-lg font-bold text-white/60 shrink-0">
              {(user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-display font-bold text-white tracking-tight truncate">
                {user?.email ?? (isLoading ? 'Loading…' : 'Unknown user')}
              </h1>
              <p className="text-white/40 mt-1 font-medium text-xs tabular-nums">
                ID {userId?.slice(0, 8)}
                {user?.created_at && (
                  <> · Joined {format(new Date(user.created_at), 'd MMM yyyy')}</>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={async () => {
              if (!user) return;
              setExporting(true);
              try {
                await exportTransactionsPDF(filtered, dateRange, {
                  label: user.email,
                  slug: user.email.split('@')[0],
                });
              } finally {
                setExporting(false);
              }
            }}
            disabled={filtered.length === 0 || exporting || !user}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all text-xs font-bold uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <Download className={cn('w-4 h-4', exporting && 'animate-bounce')} />
            {exporting ? 'Generating PDF…' : `Export Record (${filtered.length})`}
          </button>
        </div>
      </div>

      {/* ── Lifetime totals ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <h2 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
            Lifetime Activity
          </h2>
          <span className="text-[10px] text-white/15">· settled only, ignores the filter below</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {[
            { label: 'Deposits', value: totals?.deposits, tone: 'text-accent' },
            { label: 'Sent', value: totals?.sent, tone: 'text-blue-400' },
            { label: 'Received', value: totals?.received, tone: 'text-purple-400' },
            { label: 'Withdrawals', value: totals?.withdrawals, tone: 'text-red-400' },
            { label: 'Bridged', value: totals?.bridged, tone: 'text-purple-500' },
            { label: 'Total Volume', value: totals?.volume, tone: 'text-white' },
          ].map((stat) => (
            <div key={stat.label} className="card-glass p-5 border-white/5">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
                {stat.label}
              </p>
              <p className={cn('text-lg font-black tabular-nums mt-2', stat.tone)}>
                {isLoading ? (
                  <span className="inline-block h-5 w-20 bg-white/5 rounded animate-pulse" />
                ) : (
                  usd(stat.value ?? 0)
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── KYC + wallets ──────────────────────────────────────────────── */}
      {/* Verification and wallets are both short, so they run full-width and stacked rather
          than side by side — a one-row card next to a three-row one left a ragged edge. The
          wallet tiles reuse the stat grid's rhythm so the two sections read as one system. */}
      <div className="space-y-4">
        <div className="card-glass p-5 border-white/5">
          <div className="flex items-center gap-4">
            <KycIcon className={cn('w-8 h-8 shrink-0', kycTone)} />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-sm font-bold text-white">Identity Verification</h2>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest',
                    statusColor(kyc?.status ?? ''),
                  )}
                >
                  {kycLabel}
                </span>
              </div>
              <p className="text-[10px] text-white/25 mt-1 tabular-nums">
                {kyc?.updatedAt
                  ? `Updated ${format(new Date(kyc.updatedAt), 'd MMM yyyy, HH:mm')}`
                  : 'No Didit session yet'}
              </p>
            </div>

            {kyc?.consoleUrl && (
              <a
                href={kyc.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-xl bg-blue-400/10 border border-blue-400/20 text-blue-400 hover:bg-blue-400/20 transition-all text-[10px] font-bold uppercase tracking-widest"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open in Didit
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-1 pt-1">
          <Wallet className="w-3.5 h-3.5 text-white/25" />
          <h2 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
            Wallets
          </h2>
          <span className="text-[10px] text-white/15">· click to copy</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <WalletTile label="EVM" value={user?.smart_account_address ?? null} />
          <WalletTile label="Solana" value={user?.solana_address ?? null} />
          <WalletTile label="Stellar" value={user?.stellar_address ?? null} />
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(Object.keys(ADMIN_DATE_RANGE_LABELS) as AdminDateRange[]).map((range) => (
            <button
              key={range}
              onClick={() => {
                setDateRange(range);
                setCurrentPage(1);
              }}
              className={cn(
                'px-4 h-9 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap',
                dateRange === range
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-white/3 border-white/8 text-white/30 hover:border-white/15 hover:text-white/60',
              )}
            >
              {ADMIN_DATE_RANGE_LABELS[range]}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              placeholder="Search by tx hash, type, status..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
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
                onClick={() => {
                  setFilterType(type.value);
                  setCurrentPage(1);
                }}
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

      {/* ── Transactions ───────────────────────────────────────────────── */}
      <div className="card-glass p-0 overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                {['Type', 'Tx Hash', 'Chain / Route', 'Status', 'Amount', 'Date'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'px-6 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]',
                        i >= 4 && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-6 py-7">
                      <div className="h-3 bg-white/5 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : pageItems.length > 0 ? (
                pageItems.map((tx, i) => (
                  <motion.tr
                    key={`${tx.tx_type}-${tx.id}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="group hover:bg-white/2 transition-colors"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        {txIcon(tx.tx_type)}
                        <span className="text-xs font-bold text-white capitalize">
                          {tx.tx_type}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <code className="text-[10px] text-white/40 group-hover:text-white/70 transition-colors tabular-nums">
                        {getTxHash(tx) === '—'
                          ? '—'
                          : `${getTxHash(tx).slice(0, 10)}…${getTxHash(tx).slice(-6)}`}
                      </code>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[11px] text-white/50">{getChainInfo(tx)}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest',
                          statusColor(tx.status ?? ''),
                        )}
                      >
                        {tx.status ?? 'unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className="text-xs font-bold text-white tabular-nums">
                        {usd(Number(tx.amount))}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[10px] font-bold text-white/40">
                          {format(new Date(tx.created_at), 'd MMM yyyy')}
                        </span>
                        <span className="text-[9px] text-white/15 tabular-nums">
                          {format(new Date(tx.created_at), 'HH:mm')}
                        </span>
                      </div>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-4 text-white/20">
                      <Search className="w-12 h-12" />
                      <p className="font-medium">
                        No transactions in this period.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-5 border-t border-white/5 bg-white/1 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs font-medium text-white/30">
              Showing <span className="text-white/60 font-bold">{pageItems.length}</span> of{' '}
              <span className="text-white/60 font-bold">{filtered.length}</span> transactions
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 h-9 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white disabled:opacity-40 transition-all text-[10px] font-bold uppercase tracking-widest"
              >
                Prev
              </button>
              <span className="text-xs font-bold text-white/60 px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 h-9 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white disabled:opacity-40 transition-all text-[10px] font-bold uppercase tracking-widest"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
