'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Copy, Download, ExternalLink, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import { EASE } from '@/components/landing/motion';
import { exportTransactionsPDF } from '@/lib/receipt/exportPdf';
import { getAdminUserDetail } from '@/lib/supabase/admin';
import { cn } from '@/lib/utils';
import type { AdminDateRange, AdminTransaction } from '@/types/admin';
import { matchesTxSearch, TransactionFilters, TransactionList } from '../../components/TransactionList';
import { Avatar, ForestStat, Pagination, Panel, PrimaryButton, Shimmer, statusTone, useCopied } from '../../components/ui';
import { formatUsd } from '@/lib/format-usdc';
import { FlowLabel } from '@/components/flow/ui';

const ITEMS_PER_PAGE = 20;

const KYC_LABELS: Record<string, string> = { approved: 'Approved', declined: 'Declined', in_review: 'In review', pending: 'Pending' };

function kycVisual(status: string) {
  const Icon = status === 'approved' ? ShieldCheck : status === 'declined' ? ShieldAlert : ShieldQuestion;
  return { Icon, label: KYC_LABELS[status] ?? 'Not started', badge: statusTone(status) };
}

/**
 * One wallet address as a click-to-copy row.
 *
 * Truncated rather than shown in full: these are 42–56 characters. Admins copy them into
 * explorers far more often than they read them, so the full value lives on the hover title and
 * the clipboard.
 */
function WalletRow({ label, value }: { label: string; value: string | null }) {
  const [copied, copy] = useCopied();

  return (
    <li>
      <button
        type="button"
        onClick={() => value && copy(value)}
        disabled={!value}
        title={value ?? undefined}
        className="group flex w-full items-center justify-between gap-4 py-4 text-left disabled:cursor-default"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">{label}</span>
          <span className={cn('lp-mono block truncate text-[13px]', value ? 'text-[var(--lp-body)]' : 'text-[var(--lp-muted)]')}>
            {value ? `${value.slice(0, 10)}…${value.slice(-8)}` : 'Not set up'}
          </span>
        </span>
        {value && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--lp-cream)] px-3 py-1.5 text-[13px] font-semibold transition-colors group-hover:bg-[var(--lp-soft-2)]">
            {copied ? <Check className="size-3.5 text-[var(--lp-good)]" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </span>
        )}
      </button>
    </li>
  );
}

// `useSearchParams` needs a Suspense boundary to prerender, so the view lives in a child.
export default function AdminUserDetailPage() {
  return (
    <Suspense fallback={<Shimmer className="h-96 w-full rounded-[32px]" />}>
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

  const { data, isPending, error } = useQuery({
    queryKey: ['admin-user-detail', userId, dateRange, adminUser?.email?.address],
    queryFn: async () => {
      if (!adminUser?.email?.address || !userId) return null;
      return getAdminUserDetail(userId, dateRange, (await getAccessToken()) ?? undefined);
    },
    enabled: !!adminUser?.email?.address && !!userId,
  });

  // Type and text filtering happen client-side; the date window is applied by the query, so
  // changing it refetches rather than hiding rows that were never loaded.
  const filtered = useMemo(
    () =>
      ((data?.transactions ?? []) as AdminTransaction[]).filter(
        (tx) => (!filterType || tx.tx_type === filterType) && matchesTxSearch(tx, search),
      ),
    [data, filterType, search],
  );

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const pageItems = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const user = data?.user;
  const kyc = data?.kyc;
  const totals = data?.totals;
  const kycLook = kycVisual(kyc?.status ?? 'not_started');

  const backLink = (
    <Link
      href={backHref}
      className="lp-card inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors hover:text-[var(--lp-link)]"
    >
      <ArrowLeft className="size-4" /> All users
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-5">
        {backLink}
        <Panel className="px-6 py-16 text-center">
          <p className="lp-display text-[24px] font-semibold tracking-[-0.02em]">
            Couldn’t load <span className="lp-serif font-normal">this account.</span>
          </p>
          <p className="mt-2 text-[15px] text-[var(--lp-muted)]">{error instanceof Error ? error.message : 'Please try again.'}</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5 md:space-y-8">
      {backLink}

      {/* ── Who ───────────────────────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE }}
        className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="flex min-w-0 items-center gap-4">
          {user ? <Avatar email={user.email} size="lg" /> : <Shimmer className="size-14 shrink-0 sm:size-16" />}
          <div className="min-w-0">
            <p className="lp-mono text-[11px] uppercase text-[var(--lp-muted)] sm:text-[12px]">Admin · User</p>
            <h1 className="lp-display mt-1 break-all text-[clamp(24px,5.4vw,44px)] leading-[1] tracking-[-0.04em]">
              {user?.email ?? (isPending ? <Shimmer className="h-[0.85em] w-[9em]" /> : 'Unknown user')}
            </h1>
            <p className="lp-mono mt-2 text-[12px] text-[var(--lp-muted)]">
              {userId?.slice(0, 8)}
              {user?.created_at && <> · Joined {format(new Date(user.created_at), 'd MMM yyyy')}</>}
            </p>
          </div>
        </div>
        <PrimaryButton
          onClick={async () => {
            if (!user) return;
            setExporting(true);
            try {
              await exportTransactionsPDF(filtered, dateRange, { label: user.email, slug: user.email.split('@')[0] });
            } finally {
              setExporting(false);
            }
          }}
          disabled={filtered.length === 0 || exporting || !user}
          className="self-start lg:self-auto"
        >
          <Download className={cn('size-4', exporting && 'animate-bounce')} />
          {exporting ? 'Generating PDF…' : `Export record (${filtered.length})`}
        </PrimaryButton>
      </motion.header>

      {/* ── Lifetime ──────────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.06 }}
        className="lp-on-forest rounded-[28px] p-5 text-[var(--lp-cream)] sm:p-8 md:rounded-[36px] md:p-10"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="lp-mono text-[12px] uppercase text-[var(--lp-green)] sm:text-[13px]">Lifetime volume</span>
          <span className="text-[13px] text-[#a9c2b5]">Settled only · ignores the filters below</span>
        </div>
        <p className="lp-display mt-4 break-words text-[clamp(40px,10vw,88px)] leading-[0.9] tracking-[-0.05em] tabular-nums">
          {isPending ? <Shimmer onDark className="h-[0.85em] w-[4.2em]" /> : formatUsd(totals?.volume ?? 0)}
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-2 sm:mt-8 sm:grid-cols-3 xl:grid-cols-5">
          {[
            { label: 'Deposits', value: totals?.deposits },
            { label: 'Sent', value: totals?.sent },
            { label: 'Received', value: totals?.received },
            { label: 'Withdrawn', value: totals?.withdrawals },
            { label: 'Bridged', value: totals?.bridged },
          ].map((s) => (
            <ForestStat key={s.label} label={s.label} value={formatUsd(s.value ?? 0)} loading={isPending} />
          ))}
        </dl>
      </motion.section>

      {/* ── Verification and wallets ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 md:gap-6 xl:grid-cols-2">
        <Panel className="flex flex-col p-5 sm:p-8">
          <FlowLabel as="span" className="sm:text-[13px]">Identity verification</FlowLabel>
          <div className="mt-5 flex items-center gap-4">
            <span className={cn('grid size-14 shrink-0 place-items-center rounded-full', kycLook.badge)}>
              <kycLook.Icon className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="lp-display text-[clamp(26px,6vw,36px)] font-bold leading-none tracking-[-0.03em]">
                {isPending ? <Shimmer className="h-[0.85em] w-[5em]" /> : kycLook.label}
              </p>
              <p className="mt-1.5 text-[14px] text-[var(--lp-muted)]">
                {kyc?.updatedAt ? `Updated ${format(new Date(kyc.updatedAt), 'd MMM yyyy, HH:mm')}` : isPending ? '' : 'No verification started yet'}
              </p>
            </div>
          </div>
          {kyc?.consoleUrl && (
            <a
              href={kyc.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex h-12 items-center justify-center gap-2 self-start rounded-full border border-[rgb(var(--lp-hair)/0.15)] px-5 text-[15px] font-semibold transition-colors hover:border-[var(--lp-ink)] xl:mt-auto"
            >
              Open in Didit <ExternalLink className="size-4" />
            </a>
          )}
        </Panel>

        <Panel className="p-5 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <FlowLabel as="span" className="sm:text-[13px]">Wallets</FlowLabel>
            <span className="text-[13px] text-[var(--lp-muted)]">Tap one to copy</span>
          </div>
          <ul className="mt-2 divide-y divide-[var(--lp-soft-2)]">
            <WalletRow label="EVM" value={user?.smart_account_address ?? null} />
            <WalletRow label="Solana" value={user?.solana_address ?? null} />
            <WalletRow label="Stellar" value={user?.stellar_address ?? null} />
          </ul>
        </Panel>
      </div>

      {/* ── Their transactions ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="lp-display text-[clamp(28px,6vw,44px)] leading-[0.95] tracking-[-0.04em]">
          Their <span className="lp-serif tracking-[-0.02em]">transactions.</span>
        </h2>
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
            items={pageItems}
            loading={isPending}
            emptyTitle="No transactions"
            emptyItalic="in this period."
            emptyBody="Try a longer date range or another type."
          />
          {!isPending && totalPages > 1 && (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onChange={(p) => setCurrentPage(Math.min(Math.max(p, 1), totalPages))}
              summary={
                <>
                  Showing {pageItems.length} of {filtered.length} transactions
                </>
              }
            />
          )}
        </Panel>
      </div>

    </div>
  );
}
