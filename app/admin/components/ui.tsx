'use client';

/**
 * The admin's building blocks, in the landing page's language: two-line display headings, white
 * panels on cream, pill controls, mono labels. Every admin page is assembled from these so the
 * section reads as one product rather than six pages styled one at a time.
 */

import { motion } from 'framer-motion';
import { useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronLeft, ChevronRight, Link2, RefreshCw, Search } from 'lucide-react';
import { EASE } from '@/components/landing/motion';
import { cn } from '@/lib/utils';

export const usd = (n: number, digits = 2) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** A white panel on the cream page. */
export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-[28px] bg-white shadow-[0_0_0_1px_rgb(17_26_19/0.06)] sm:rounded-[32px]', className)}>
      {children}
    </section>
  );
}

/** A placeholder in the shape of what is coming. `onDark` for forest panels. */
export function Shimmer({ className, onDark }: { className: string; onDark?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('block animate-pulse rounded-full', onDark ? 'bg-[rgba(246,242,233,0.1)]' : 'bg-[rgba(17,26,19,0.07)]', className)}
    />
  );
}

/** The page's title: a mono label, then a bold line and an italic one, with actions beside. */
export function PageHeader({
  eyebrow,
  title,
  italic,
  aside,
  actions,
}: {
  eyebrow: string;
  title: string;
  italic: string;
  aside?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
      className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"
    >
      <div className="min-w-0">
        <p className="lp-mono text-[11px] uppercase text-[var(--lp-muted)] sm:text-[12px]">Admin · {eyebrow}</p>
        <h1 className="lp-display mt-2 text-[clamp(34px,8.4vw,72px)] leading-[0.92] tracking-[-0.05em]">
          <span className="block">{title}</span>
          <span className="lp-serif block pb-[0.08em] tracking-[-0.02em]">{italic}</span>
        </h1>
        {aside && <p className="mt-3 max-w-[520px] text-[15px] leading-normal text-[var(--lp-body)] sm:text-[16px]">{aside}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

export function PrimaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--lp-ink)] px-5 text-[15px] font-semibold text-[var(--lp-cream)] transition-[scale,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-[rgba(17,26,19,0.15)] bg-white px-5 text-[15px] font-semibold transition-[scale,border-color,opacity] duration-150 hover:border-[var(--lp-ink)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function RefreshButton({ onClick, spinning, disabled }: { onClick: () => void; spinning: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Refresh"
      className="grid size-12 shrink-0 place-items-center rounded-full bg-white shadow-[0_0_0_1px_rgb(17_26_19/0.06)] transition-[scale] duration-150 active:scale-[0.95] disabled:opacity-60"
    >
      <RefreshCw className={cn('size-4', spinning && 'animate-spin')} />
    </button>
  );
}

/** One row of pill choices. Scrolls sideways on a narrow screen rather than wrapping. */
export function Pills<T extends string | null>({
  options,
  value,
  onChange,
  label,
  tone = 'ink',
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  tone?: 'ink' | 'green';
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-full bg-white p-1 shadow-[0_0_0_1px_rgb(17_26_19/0.06)]" role="group" aria-label={label}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.label}
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={cn(
                'whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium transition-colors duration-150',
                active
                  ? tone === 'green'
                    ? 'bg-[var(--lp-green)] text-[var(--lp-ink)]'
                    : 'bg-[var(--lp-ink)] text-[var(--lp-cream)]'
                  : 'text-[var(--lp-body)] hover:text-[#00a857]',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex h-12 items-center gap-3 rounded-full bg-white px-4 shadow-[0_0_0_1px_rgb(17_26_19/0.06)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)]',
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-[var(--lp-muted)]" />
      <span className="sr-only">{placeholder}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[rgba(91,100,93,0.8)] sm:text-[15px]"
      />
    </label>
  );
}

/** A labelled figure. `tone` colours the value only; the label stays muted ink. */
export function StatTile({
  label,
  value,
  loading,
  tone,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
  tone?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-[22px] bg-white p-4 shadow-[0_0_0_1px_rgb(17_26_19/0.06)] sm:rounded-[24px] sm:p-5', className)}>
      <p className="lp-mono truncate text-[11px] uppercase text-[var(--lp-muted)] sm:text-[12px]">{label}</p>
      <p className={cn('lp-display mt-2 truncate text-[clamp(22px,5.6vw,32px)] leading-none tracking-[-0.03em] tabular-nums', tone)}>
        {loading ? <Shimmer className="h-[0.8em] w-[4em]" /> : value}
      </p>
      {hint && <p className="mt-1.5 truncate text-[13px] text-[var(--lp-muted)]">{hint}</p>}
    </div>
  );
}

/** Statuses in four families. The word is always shown, so state never rests on colour alone. */
export function statusTone(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'claimed':
    case 'confirmed':
    case 'complete':
    case 'approved':
    case 'settled':
    case 'processed':
      return 'bg-[#00e87a]/15 text-[#0e7a45]';
    case 'pending':
    case 'pending_claim':
    case 'awaiting_verification':
    case 'processing':
    case 'in_review':
      return 'bg-[#f5c451]/30 text-[#8a5a00]';
    case 'failed':
    case 'cancelled':
    case 'declined':
    case 'refunded':
    case 'expired':
    case 'refunding':
      return 'bg-[#a1462c]/10 text-[#a1462c]';
    case 'reversed':
    case 'validated':
      return 'bg-[#2a78d6]/10 text-[#1d5fb4]';
    case 'deposited':
      return 'bg-[#6250d6]/10 text-[#4b3bb3]';
    default:
      return 'bg-[var(--lp-cream)] text-[var(--lp-body)]';
  }
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? (status || 'unknown').replace(/_/g, ' ');
  return (
    <span className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize', statusTone(status))}>
      {text}
    </span>
  );
}

const TX_TYPES: Record<string, { Icon: typeof ArrowDownLeft; badge: string; label: string }> = {
  deposit: { Icon: ArrowDownLeft, badge: 'bg-[#00e87a]/15 text-[#0e7a45]', label: 'Deposit' },
  withdrawal: { Icon: ArrowUpRight, badge: 'bg-[#a1462c]/10 text-[#a1462c]', label: 'Withdrawal' },
  transfer: { Icon: ArrowLeftRight, badge: 'bg-[#2a78d6]/10 text-[#1d5fb4]', label: 'Transfer' },
  bridge: { Icon: Link2, badge: 'bg-[#6250d6]/10 text-[#4b3bb3]', label: 'Bridge' },
};

export function txTypeLook(type: string) {
  return TX_TYPES[type] ?? { Icon: ArrowLeftRight, badge: 'bg-[var(--lp-cream)] text-[var(--lp-body)]', label: type };
}

export function TxTypeBadge({ type }: { type: string }) {
  const { Icon, badge } = txTypeLook(type);
  return (
    <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', badge)}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
  summary,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  summary: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-[#e3dcce] px-5 py-4 sm:flex-row sm:px-6">
      <p className="text-[14px] text-[var(--lp-muted)]">{summary}</p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="grid size-10 place-items-center rounded-full border border-[rgba(17,26,19,0.15)] transition-colors hover:border-[var(--lp-ink)] disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="lp-mono min-w-[84px] text-center text-[12px] uppercase text-[var(--lp-body)]">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="grid size-10 place-items-center rounded-full border border-[rgba(17,26,19,0.15)] transition-colors hover:border-[var(--lp-ink)] disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ title, italic, body, icon }: { title: string; italic: string; body?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center sm:py-20">
      {icon && <div className="mb-2 grid size-12 place-items-center rounded-full bg-[var(--lp-cream)] text-[var(--lp-muted)]">{icon}</div>}
      <p className="lp-display text-[22px] font-semibold tracking-[-0.02em] sm:text-[24px]">
        {title} <span className="lp-serif font-normal">{italic}</span>
      </p>
      {body && <p className="max-w-[340px] text-[14px] leading-[1.5] text-[var(--lp-muted)]">{body}</p>}
    </div>
  );
}

/** Placeholder cards for a page of cards that is loading. */
export function CardsShimmer({ cards = 2 }: { cards?: number }) {
  return (
    <div className="space-y-4" aria-label="Loading">
      {Array.from({ length: cards }, (_, i) => (
        <Panel key={i} className="space-y-4 p-5 sm:p-8">
          <Shimmer className="h-5 w-1/3" />
          <Shimmer className="h-8 w-1/2" />
          <Shimmer className="h-24 w-full rounded-[22px]" />
        </Panel>
      ))}
    </div>
  );
}

/** A small figure on a forest panel. */
export function ForestStat({
  label,
  value,
  hint,
  loading,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-[18px] bg-[rgba(245,244,238,0.08)] px-4 py-3 sm:rounded-[20px]', className)}>
      <dt className="lp-mono truncate text-[11px] uppercase text-[#a9c2b5]">{label}</dt>
      <dd className="lp-display mt-1 truncate text-[clamp(20px,5.4vw,30px)] leading-none tracking-[-0.03em] tabular-nums">
        {loading ? <Shimmer onDark className="h-[0.8em] w-[3em]" /> : value}
      </dd>
      {hint && <dd className="mt-1.5 truncate text-[13px] text-[#a9c2b5]">{loading ? '' : hint}</dd>}
    </div>
  );
}

/** Copy to the clipboard, with a flag that reads true for a moment afterwards. */
export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    (text) => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    },
  ];
}

/** Rows of placeholder for a list that is loading. */
export function RowsShimmer({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-[#ece6da]" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-4 sm:px-6">
          <Shimmer className="size-10 shrink-0" />
          <span className="flex-1 space-y-2">
            <Shimmer className="h-3.5 w-2/5" />
            <Shimmer className="h-3 w-1/4" />
          </span>
          <Shimmer className="h-4 w-20" />
        </li>
      ))}
    </ul>
  );
}

/** A person, as the first letter of their email on an ink circle. */
export function Avatar({ email, size = 'md' }: { email: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-[var(--lp-ink)] font-semibold text-[var(--lp-green)]',
        size === 'lg' ? 'size-14 text-[22px] sm:size-16' : 'size-10 text-[15px]',
      )}
    >
      {email.charAt(0).toUpperCase()}
    </span>
  );
}
