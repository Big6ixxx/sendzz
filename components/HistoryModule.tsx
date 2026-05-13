'use client';

import { getUserActivities } from '@/lib/supabase/actions';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Loader2,
  RefreshCw,
  Wallet
} from 'lucide-react';

export type ActivityType = 'sent' | 'received' | 'deposit' | 'withdrawal';

export interface Activity {
  id: string;
  type: ActivityType;
  amount: number;
  status: string;
  timestamp: string;
  details: string;
  asset: string;
  txHash?: string;
  senderEmail?: string;
  note?: string;
}

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  sent: 'Transfer Sent',
  received: 'Funds Received',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
};

export function HistoryModule({
  userId,
  userEmail,
  limit,
  hideHeader = false,
  onTxClick,
}: {
  userId: string;
  userEmail: string;
  limit?: number;
  hideHeader?: boolean;
  onTxClick?: (activity: Activity) => void;
}) {
  const {
    data: activities,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['history', userEmail],
    queryFn: async () => {
      const data = await getUserActivities(userEmail);

      const unified: Activity[] = [
        ...(data.sent || []).map((t) => ({
          id: t.id,
          type: 'sent' as ActivityType,
          amount: t.amount,
          status: t.status,
          timestamp: t.created_at,
          details: `To: ${t.recipient_email}`,
          asset: t.asset,
          txHash: t.tx_hash || (t.note?.startsWith('0x') ? t.note : undefined),
          senderEmail: t.sender_email,
          note: t.note && !t.note.startsWith('0x') ? t.note : undefined,
        })),
        ...(data.received || [])
          .filter((t) => t.sender_id !== userId)
          .map((t) => ({
            id: t.id,
            type: 'received' as ActivityType,
            amount: t.amount,
            status: t.status,
            timestamp: t.created_at,
            details: `From: ${t.sender_email}`,
            asset: t.asset,
            txHash:
              t.tx_hash || (t.note?.startsWith('0x') ? t.note : undefined),
            senderEmail: t.sender_email,
            note: t.note && !t.note.startsWith('0x') ? t.note : undefined,
          })),
        ...(data.deposits || []).map((d) => ({
          id: d.id,
          type: 'deposit' as ActivityType,
          amount: d.amount_usdc || 0,
          status: d.status,
          timestamp: d.created_at,
          details: `Via: ${d.currency_fiat} Gateway`,
          asset: 'USDC',
          txHash: d.paycrest_tx_id?.startsWith('0x')
            ? d.paycrest_tx_id
            : undefined,
        })),
        ...(data.withdrawals || []).map((w) => ({
          id: w.id,
          type: 'withdrawal' as ActivityType,
          amount: w.amount_usdc,
          status: w.status,
          timestamp: w.created_at,
          details: `To: ${w.fiat_currency} Bank`,
          asset: 'USDC',
          txHash: w.paycrest_order_id?.startsWith('0x')
            ? w.paycrest_order_id
            : undefined,
        })),
      ];

      const sorted = unified.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      return limit ? sorted.slice(0, limit) : sorted;
    },
    enabled: !!userEmail,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center gap-6">
        <Loader2 className="w-10 h-10 animate-spin text-brand-secondary/20" />
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand-secondary/20 animate-pulse">
          Syncing History
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="flex justify-between items-end px-2">
          <div className="space-y-1">
            <h2 className="text-2xl font-display font-bold tracking-tight text-brand-secondary">
              Activity
            </h2>
            <p className="text-[10px] font-bold text-brand-secondary/30 uppercase tracking-[0.2em]">
              Recent Transactions
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="p-3 bg-white/5 border border-white/8 rounded-xl transition-all hover:bg-white/10 group"
          >
            <RefreshCw
              className={cn(
                'w-4 h-4 text-brand-secondary/40 group-hover:text-accent',
                isRefetching && 'animate-spin',
              )}
            />
          </button>
        </div>
      )}

      <div
        className={cn(
          'overflow-hidden divide-y divide-white/4',
          !hideHeader && 'card-glass p-0',
        )}
      >
        {!activities || activities.length === 0 ? (
          <div className="p-16 text-center">
            <p
              className="text-xs font-bold uppercase tracking-[0.2em]"
              style={{ color: 'rgba(248,248,246,0.2)' }}
            >
              No transactions found
            </p>
          </div>
        ) : (
          activities.map((a) => (
            <button
              key={a.id}
              onClick={() => onTxClick?.(a)}
              className="w-full p-4 md:p-6 flex items-center gap-5 hover:bg-white/2 transition-all text-left group relative"
            >
              <div
                className={cn(
                  'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all group-hover:scale-110 group-hover:rotate-3',
                )}
                style={{
                  background:
                    a.type === 'sent'
                      ? 'rgba(248, 113, 113, 0.08)'
                      : a.type === 'received'
                        ? 'rgba(0, 232, 122, 0.08)'
                        : a.type === 'deposit'
                          ? 'rgba(59, 130, 246, 0.08)'
                          : 'rgba(251, 146, 60, 0.08)',
                  color:
                    a.type === 'sent'
                      ? '#f87171'
                      : a.type === 'received'
                        ? '#00e87a'
                        : a.type === 'deposit'
                          ? '#3b82f6'
                          : '#fb923c',
                  border: `1px solid ${
                    a.type === 'sent'
                      ? 'rgba(248, 113, 113, 0.15)'
                      : a.type === 'received'
                        ? 'rgba(0, 232, 122, 0.15)'
                        : a.type === 'deposit'
                          ? 'rgba(59, 130, 246, 0.15)'
                          : 'rgba(251, 146, 60, 0.15)'
                  }`,
                }}
              >
                {a.type === 'sent' && <ArrowUpRight className="w-5 h-5" />}
                {a.type === 'received' && <ArrowDownLeft className="w-5 h-5" />}
                {a.type === 'deposit' && <Wallet className="w-5 h-5" />}
                {a.type === 'withdrawal' && <Landmark className="w-5 h-5" />}
              </div>

              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex justify-between items-center gap-2">
                  <p className="font-bold text-sm tracking-tight text-brand-secondary">
                    {ACTIVITY_LABELS[a.type]}
                  </p>
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{
                      color:
                        a.type === 'sent' || a.type === 'withdrawal'
                          ? '#f8f8f6'
                          : '#00e87a',
                    }}
                  >
                    {a.type === 'sent' || a.type === 'withdrawal' ? '-' : '+'}
                    {a.amount.toLocaleString()}{' '}
                    <span className="text-[10px] opacity-30 font-bold">
                      {a.asset}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-[10px] font-bold uppercase truncate tracking-widest text-brand-secondary/30">
                    {a.details}
                  </p>
                  <span className="text-[10px] font-bold uppercase text-brand-secondary/20">
                    {format(new Date(a.timestamp), 'MMM dd')}
                  </span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
