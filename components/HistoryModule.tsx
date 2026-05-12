'use client';

import { getUserActivities } from '@/lib/supabase/actions';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  Landmark,
  Loader2,
  RefreshCw,
  Wallet
} from 'lucide-react';
import { useState } from 'react';

type ActivityType = 'sent' | 'received' | 'deposit' | 'withdrawal';

interface Activity {
  id: string;
  type: ActivityType;
  amount: number;
  status: string;
  timestamp: string;
  details: string;
  asset: string;
  txHash?: string;
  senderEmail?: string;
}

const EXPLORER_BASE_URL = 'https://basescan.org/tx/';

export function HistoryModule({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(
    null,
  );

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
          txHash: t.note?.startsWith('0x') ? t.note : undefined,
          senderEmail: t.sender_email
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
            txHash: t.note?.startsWith('0x') ? t.note : undefined,
            senderEmail: t.sender_email
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

      return unified.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    },
    enabled: !!userEmail,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="card-elegant p-12 flex flex-col items-center justify-center gap-6 bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-muted-foreground opacity-20" />
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground animate-pulse">
          Syncing History
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end px-2">
        <div className="space-y-1">
          <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-2">
            Activity
          </h2>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Recent Transactions
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-2 hover:bg-muted rounded-full transition-colors group"
        >
          <RefreshCw
            className={cn(
              'w-4 h-4 text-muted-foreground group-hover:text-foreground',
              isRefetching && 'animate-spin',
            )}
          />
        </button>
      </div>

      <div className="card-elegant p-0 overflow-hidden divide-y divide-border/50">
        {!activities || activities.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest opacity-40">
              No activity yet
            </p>
          </div>
        ) : (
          activities.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedActivity(a)}
              className="w-full p-5 flex items-center gap-4 hover:bg-muted/30 transition-all text-left group"
            >
              <div
                className={cn(
                  'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105',
                  a.type === 'sent'
                    ? 'bg-red-50 text-red-600'
                    : a.type === 'received'
                      ? 'bg-green-50 text-green-600'
                      : a.type === 'deposit'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-orange-50 text-orange-600',
                )}
              >
                {a.type === 'sent' && <ArrowUpRight className="w-5 h-5" />}
                {a.type === 'received' && <ArrowDownLeft className="w-5 h-5" />}
                {a.type === 'deposit' && <Wallet className="w-5 h-5" />}
                {a.type === 'withdrawal' && <Landmark className="w-5 h-5" />}
              </div>

              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex justify-between items-start">
                  <p className="font-bold text-sm uppercase tracking-tight truncate">
                    {a.type}
                  </p>
                  <span className="text-sm font-black tabular-nums">
                    {a.type === 'sent' || a.type === 'withdrawal' ? '-' : '+'}
                    {a.amount.toLocaleString()}{' '}
                    <span className="text-[10px] opacity-40">{a.asset}</span>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase truncate tracking-wide">
                    {a.details}
                  </p>
                  <span className="text-[10px] font-medium text-muted-foreground/60 uppercase">
                    {format(new Date(a.timestamp), 'MMM dd')}
                  </span>
                </div>
              </div>

              <ChevronRight className="w-4 h-4 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors" />
            </button>
          ))
        )}
      </div>

      {/* Activity Detail Modal */}
      {selectedActivity && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="card-elegant w-full max-w-sm bg-background p-0 border-none shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center space-y-6">
              <div className="flex justify-center">
                <div
                  className={cn(
                    'w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg',
                    selectedActivity.type === 'sent'
                      ? 'bg-red-50 text-red-600'
                      : selectedActivity.type === 'received'
                        ? 'bg-green-50 text-green-600'
                        : selectedActivity.type === 'deposit'
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-orange-50 text-orange-600',
                  )}
                >
                  {selectedActivity.type === 'sent' && (
                    <ArrowUpRight className="w-10 h-10" />
                  )}
                  {selectedActivity.type === 'received' && (
                    <ArrowDownLeft className="w-10 h-10" />
                  )}
                  {selectedActivity.type === 'deposit' && (
                    <Wallet className="w-10 h-10" />
                  )}
                  {selectedActivity.type === 'withdrawal' && (
                    <Landmark className="w-10 h-10" />
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
                  {selectedActivity.type}
                </p>
                <h3 className="text-4xl font-black tracking-tighter">
                  {selectedActivity.amount.toLocaleString()}{' '}
                  <span className="text-lg opacity-40">
                    {selectedActivity.asset}
                  </span>
                </h3>
                <span
                  className={cn(
                    'inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest mt-2',
                    selectedActivity.status === 'completed' ||
                      selectedActivity.status === 'confirmed' ||
                      selectedActivity.status === 'claimed'
                      ? 'bg-green-100 text-green-700'
                      : selectedActivity.status === 'failed'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {selectedActivity.status}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 text-left">
                <div className="p-4 bg-muted/30 rounded-2xl border border-border/50">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-2">
                    <Clock className="w-3 h-3" /> Timestamp
                  </p>
                  <p className="text-xs font-semibold uppercase">
                    {format(
                      new Date(selectedActivity.timestamp),
                      'MMMM dd, yyyy @ HH:mm',
                    )}
                  </p>
                </div>

                <div className="p-4 bg-muted/30 rounded-2xl border border-border/50">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-2">
                    <History className="w-3 h-3" /> Details
                  </p>
                  <p className="text-xs font-semibold uppercase truncate">
                    {selectedActivity.details}
                  </p>
                  {selectedActivity.type === 'received' && selectedActivity.senderEmail && (
                    <p className="text-[10px] text-muted-foreground mt-1 truncate">
                      Source: {selectedActivity.senderEmail}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                {selectedActivity.txHash && (
                  <a
                    href={`${EXPLORER_BASE_URL}${selectedActivity.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary flex-1 h-12 text-xs gap-2"
                  >
                    <ExternalLink className="w-4 h-4" /> Explorer
                  </a>
                )}
                <button
                  onClick={() => setSelectedActivity(null)}
                  className="btn-primary flex-1 h-12 text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
