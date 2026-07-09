'use client';

import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Landmark,
  RefreshCw,
  Undo2,
  Wallet,
} from 'lucide-react';
import type { Activity, ActivityType } from './HistoryModule';
import { useBalanceVisibility } from '@/components/providers/BalanceVisibilityProvider';
import { CHAIN_META } from '@/components/deposit-withdraw/deposit-shared';

const chainLabel = (chain: string) =>
  (CHAIN_META[chain.toLowerCase()]?.name ?? chain).toUpperCase();

/** Short network descriptor for a row, e.g. "BASE", "ARBITRUM → BASE", "VIA BASE". */
function networkLabel(a: Activity): string | null {
  if (a.type === 'bridge' && a.sourceChain) {
    return `${chainLabel(a.sourceChain)} → ${chainLabel(a.destChain ?? 'base')}`;
  }
  if (a.type === 'withdrawal' && a.consolidated) {
    return `Networks → ${chainLabel(a.sourceChain ?? 'base')}`;
  }
  if (a.sourceChain) return chainLabel(a.sourceChain);
  return null;
}

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  sent: 'Transfer Sent',
  received: 'Funds Received',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bridge: 'Bridge Transfer',
};

function getActivityIcon(type: ActivityType) {
  switch (type) {
    case 'sent':       return <ArrowUpRight className="w-6 h-6" />;
    case 'received':   return <ArrowDownLeft className="w-6 h-6" />;
    case 'deposit':    return <Wallet className="w-6 h-6" />;
    case 'withdrawal': return <Landmark className="w-6 h-6" />;
    case 'bridge':     return <RefreshCw className="w-6 h-6" />;
  }
}

/** Truncates an email so it fits in tight spaces: "us…@domain.com" */
function truncateEmail(email: string, maxLength = 22): string {
  if (email.length <= maxLength) return email;
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return email.slice(0, maxLength - 1) + '…';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  const keep = Math.max(2, maxLength - domain.length - 3);
  return local.slice(0, keep) + '…' + domain;
}

function formatDetails(details: string): string {
  const match = details.match(/^([^:]+:\s*)(.+)$/);
  if (!match) return details;
  const [, prefix, value] = match;
  if (value.includes('@')) return prefix + truncateEmail(value);
  return details;
}

interface ActivityRowProps {
  activity: Activity;
  reclaimingId: string | null;
  acceptingId: string | null;
  onTxClick?: (activity: Activity) => void;
  onReclaim: (id: string) => void;
  onAccept: (id: string) => void;
}

export function ActivityRow({
  activity: a,
  reclaimingId,
  acceptingId,
  onTxClick,
  onReclaim,
  onAccept,
}: ActivityRowProps) {
  const { hideBalance } = useBalanceVisibility();
  
  const statusLower = a.status.toLowerCase();
  const isSettled =
    statusLower === 'settled' ||
    statusLower === 'completed' ||
    statusLower === 'confirmed' ||
    statusLower === 'success' ||
    statusLower === 'complete';
  const isPending = statusLower === 'pending' || statusLower === 'processing';
  const isPendingClaim = statusLower === 'pending_claim';
  const isExpiredOrReclaimed = statusLower === 'expired';

  const canReclaim =
    a.type === 'sent' &&
    isPendingClaim &&
    !!a.expiresAt &&
    new Date(a.expiresAt) < new Date();

  const expiryLabel =
    isPendingClaim && a.expiresAt
      ? canReclaim
        ? 'Expired — reclaim available'
        : `Expires ${formatDistanceToNow(new Date(a.expiresAt), { addSuffix: true })}`
      : null;

  const iconBg =
    isSettled ? 'rgba(0, 232, 122, 0.08)' :
    a.type === 'sent' ? 'rgba(248, 113, 113, 0.08)' :
    a.type === 'received' ? 'rgba(0, 232, 122, 0.08)' :
    a.type === 'deposit' ? 'rgba(59, 130, 246, 0.08)' :
    a.type === 'bridge' ? 'rgba(96, 165, 250, 0.08)' :
    'rgba(251, 146, 60, 0.08)';

  const iconColor =
    isSettled ? '#00e87a' :
    isPending ? '#3b82f6' :
    a.type === 'sent' ? '#f87171' :
    a.type === 'received' ? '#00e87a' :
    a.type === 'deposit' ? '#3b82f6' :
    a.type === 'bridge' ? '#60a5fa' :
    '#fb923c';

  const iconBorder =
    isSettled ? 'rgba(0, 232, 122, 0.15)' :
    a.type === 'sent' ? 'rgba(248, 113, 113, 0.15)' :
    a.type === 'received' ? 'rgba(0, 232, 122, 0.15)' :
    a.type === 'deposit' ? 'rgba(59, 130, 246, 0.15)' :
    a.type === 'bridge' ? 'rgba(96, 165, 250, 0.15)' :
    'rgba(251, 146, 60, 0.15)';

  return (
    <div
      role={onTxClick ? 'button' : undefined}
      tabIndex={onTxClick ? 0 : undefined}
      onClick={() => onTxClick?.(a)}
      onKeyDown={(e) => e.key === 'Enter' && onTxClick?.(a)}
      className={cn(
        'w-full p-4 sm:p-5 md:p-7 flex items-center gap-3 sm:gap-5 md:gap-6 transition-all text-left group relative',
        onTxClick && 'cursor-pointer hover:bg-white/3',
      )}
    >
      {/* Type icon */}
      <div
        className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-500 group-hover:scale-110 group-hover:rotate-6"
        style={{ background: iconBg, color: iconColor, border: `1px solid ${iconBorder}` }}
      >
        {getActivityIcon(a.type)}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Top row: label + amount */}
        <div className="flex justify-between items-start sm:items-center gap-2 sm:gap-4">
          <p className="font-bold text-sm sm:text-base tracking-tight text-brand-secondary truncate pr-2">
            {ACTIVITY_LABELS[a.type]}
          </p>
          <span
            className="text-sm sm:text-base font-bold tabular-nums whitespace-nowrap shrink-0"
            style={{ color: a.type === 'sent' || a.type === 'withdrawal' ? '#f8f8f6' : '#00e87a' }}
          >
            {a.type === 'sent' || a.type === 'withdrawal' ? '-' : '+'}
            {hideBalance ? '••••' : a.amount.toLocaleString()}{' '}
            <span className="text-[10px] opacity-30 font-bold uppercase">{a.asset}</span>
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {/* Details + meta cluster. Details truncates; the cluster keeps its place and
              wraps internally (capped width) so nothing overlaps on narrow widths. */}
          <div className="flex items-start justify-between gap-2">
            {/* For bridges the route chip ("X → BASE") already states the source, so the
                redundant "From: X" detail is dropped to avoid saying the same thing twice. */}
            {a.type !== 'bridge' && (
              <p className="text-[10px] sm:text-[11px] font-bold uppercase truncate tracking-[0.15em] text-brand-secondary/30 min-w-0 flex-1 self-center">
                {formatDetails(a.details)}
              </p>
            )}
            <div
              className={cn(
                'flex items-center gap-x-2 gap-y-1 flex-wrap justify-end shrink-0 ml-auto',
                a.type === 'bridge' ? 'max-w-full' : 'max-w-[70%]',
              )}
            >
              {networkLabel(a) && (
                <span className="inline-flex items-center shrink-0 text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-widest bg-white/5 text-brand-secondary/35 border border-white/8 whitespace-nowrap">
                  {networkLabel(a)}
                </span>
              )}
              <span
                className={cn(
                  'text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-widest flex items-center gap-1.5',
                  isSettled
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : isPending
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : isPendingClaim
                        ? canReclaim
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                        : isExpiredOrReclaimed
                          ? 'bg-white/5 text-brand-secondary/20 border border-white/8'
                          : 'bg-white/5 text-brand-secondary/30 border border-white/10',
                )}
              >
                {isPending && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                {isPendingClaim && <Clock className="w-2.5 h-2.5" />}
                {isPending
                  ? 'Processing'
                  : isPendingClaim
                    ? canReclaim ? 'Reclaim Available' : 'Awaiting Claim'
                    : a.status}
              </span>
              <span className="text-[10px] font-bold uppercase text-brand-secondary/20 whitespace-nowrap">
                {format(new Date(a.timestamp), 'MMM dd')}
              </span>
            </div>
          </div>

          {/* Expiry + Reclaim row */}
          {(expiryLabel || canReclaim) && (
            <div className="flex items-center justify-between gap-2">
              {expiryLabel && (
                <p
                  className="text-[10px] font-semibold"
                  style={{ color: canReclaim ? '#f59e0b' : 'rgba(248,248,246,0.25)' }}
                >
                  {expiryLabel}
                </p>
              )}
              {canReclaim && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReclaim(a.id); }}
                  disabled={reclaimingId === a.id}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                  style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}
                >
                  {reclaimingId === a.id
                    ? <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    : <Undo2 className="w-2.5 h-2.5" />}
                  {reclaimingId === a.id ? 'Reclaiming…' : 'Reclaim Funds'}
                </button>
              )}
            </div>
          )}

          {/* Accept Payment row — received pending_claim */}
          {a.type === 'received' && isPendingClaim && (
            <div className="flex items-center justify-between gap-2 mt-1">
              <p className="text-[10px] font-semibold" style={{ color: 'rgba(0,232,122,0.6)' }}>
                Waiting for your acceptance
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); onAccept(a.id); }}
                disabled={acceptingId === a.id}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                style={{ background: 'rgba(0,232,122,0.1)', color: '#00e87a', border: '1px solid rgba(0,232,122,0.2)' }}
              >
                {acceptingId === a.id
                  ? <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  : <CheckCircle2 className="w-2.5 h-2.5" />}
                {acceptingId === a.id ? 'Accepting…' : 'Accept Payment'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
