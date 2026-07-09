'use client';

import { useActivities } from '@/hooks/useActivities';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { History, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { ActivityRow } from './ActivityRow';

export type ActivityType =
  | 'sent'
  | 'received'
  | 'deposit'
  | 'withdrawal'
  | 'bridge';
export type SortType = 'date' | 'amount';

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
  fiatAmount?: number;
  fiatCurrency?: string;
  exchangeRate?: number;
  /** ISO timestamp — present on outgoing pending_claim transfers */
  expiresAt?: string;
  sourceChain?: string;
  /** Bridges: the destination chain funds were minted on. */
  destChain?: string;
  mintTxHash?: string;
  /** Withdrawals: true when funds were bridged/consolidated onto sourceChain first. */
  consolidated?: boolean;
}

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  sent: 'Transfer Sent',
  received: 'Funds Received',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bridge: 'Bridge Transfer',
};

const PAGE_SIZE = 10;

export function HistoryModule({
  userId,
  userEmail,
  limit,
  hideHeader = false,
  onTxClick,
  showControls = false,
  hideLoadMore = false,
}: {
  userId: string;
  userEmail: string;
  limit?: number;
  hideHeader?: boolean;
  onTxClick?: (activity: Activity) => void;
  showControls?: boolean;
  hideLoadMore?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<ActivityType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortType>('date');
  const [visibleCount, setVisibleCount] = useState(limit || PAGE_SIZE);
  const [reclaimingId, setReclaimingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function handleAccept(transferId: string) {
    setAcceptingId(transferId);
    try {
      const res = await fetch('/api/transfer/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not accept payment');
      } else {
        toast.success('Payment accepted! Funds added to your balance');
        queryClient.invalidateQueries({ queryKey: ['history', userEmail] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['pending-incoming', userEmail] });
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleReclaim(transferId: string) {
    setReclaimingId(transferId);
    try {
      const res = await fetch('/api/transfer/reclaim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not reclaim transfer');
      } else {
        toast.success('Funds returned to your balance');
        // Invalidate both history and balance queries
        queryClient.invalidateQueries({ queryKey: ['history', userEmail] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setReclaimingId(null);
    }
  }

  const {
    data: allActivities,
    isLoading,
    refetch,
    isRefetching,
  } = useActivities(userEmail, userId);

  const filteredAndSorted = useMemo(() => {
    if (!allActivities) return [];

    let result = [...allActivities];

    // Filter by type
    if (filterType !== 'all') {
      result = result.filter((a) => a.type === filterType);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.details.toLowerCase().includes(q) ||
          ACTIVITY_LABELS[a.type].toLowerCase().includes(q) ||
          a.amount.toString().includes(q) ||
          a.note?.toLowerCase().includes(q),
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'date') {
        return (
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      } else {
        return b.amount - a.amount;
      }
    });

    return result;
  }, [allActivities, filterType, searchQuery, sortBy]);

  const displayedActivities = useMemo(() => {
    return filteredAndSorted.slice(0, limit || visibleCount);
  }, [filteredAndSorted, limit, visibleCount]);


  if (isLoading) {
    return (
      <div className="space-y-6">
        {!hideHeader && (
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
            <div className="space-y-1">
              <h2 className="text-3xl font-display font-bold tracking-tight text-brand-secondary">
                Activity
              </h2>
              <p className="text-[10px] font-bold text-brand-secondary/30 uppercase tracking-[0.2em]">
                Your global transaction history
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-24 bg-white/5 rounded-xl animate-pulse" />
            </div>
          </div>
        )}
        
        {showControls && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 px-2">
            <div className="md:col-span-6 h-12 bg-white/5 rounded-2xl animate-pulse" />
            <div className="md:col-span-3 h-12 bg-white/5 rounded-2xl animate-pulse" />
            <div className="md:col-span-3 h-12 bg-white/5 rounded-2xl animate-pulse" />
          </div>
        )}

        <div className="card-glass p-0 overflow-hidden relative">
          <div className="divide-y divide-white/4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-white/5 rounded-2xl animate-pulse" />
                  <div className="space-y-2">
                    <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
                    <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="h-4 w-20 bg-white/10 rounded animate-pulse" />
                  <div className="h-3 w-16 bg-white/10 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
          <div className="space-y-1">
            <h2 className="text-3xl font-display font-bold tracking-tight text-brand-secondary">
              Activity
            </h2>
            <p className="text-[10px] font-bold text-brand-secondary/30 uppercase tracking-[0.2em]">
              Your global transaction history
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="h-10 px-4 bg-white/5 border border-white/8 rounded-xl transition-all hover:bg-white/10 group flex items-center gap-2"
            >
              <RefreshCw
                className={cn(
                  'w-3.5 h-3.5 text-brand-secondary/40 group-hover:text-accent',
                  isRefetching && 'animate-spin',
                )}
              />
              <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40">
                Refresh
              </span>
            </button>
          </div>
        </div>
      )}

      {showControls && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 px-2">
          <div className="md:col-span-6 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-secondary/20" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-12 pl-12 pr-4 rounded-2xl bg-white/3 border border-white/5 text-sm font-medium focus:outline-none focus:border-accent/30 transition-all"
            />
          </div>
          <div className="md:col-span-3">
            <Select
              value={filterType}
              onValueChange={(v) => setFilterType(v as ActivityType)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Transactions</SelectItem>
                <SelectItem value="sent">Transfers Sent</SelectItem>
                <SelectItem value="received">Funds Received</SelectItem>
                <SelectItem value="deposit">Deposits</SelectItem>
                <SelectItem value="withdrawal">Withdrawals</SelectItem>
                <SelectItem value="bridge">Bridge Transfers</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <Select
              value={sortBy}
              onValueChange={(v) => setSortBy(v as SortType)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Latest First</SelectItem>
                <SelectItem value="amount">Highest Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div
        className={cn(
          'overflow-hidden divide-y divide-white/4 transition-all duration-500',
          !hideHeader && 'card-glass p-0',
        )}
      >
        {!displayedActivities || displayedActivities.length === 0 ? (
          <div className="p-20 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/3 border border-white/5 flex items-center justify-center mx-auto opacity-20">
              <History className="w-8 h-8" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-secondary/20">
              No transactions match your criteria
            </p>
          </div>
        ) : (
          displayedActivities.map((a) => (
            <ActivityRow
              key={a.id}
              activity={a}
              reclaimingId={reclaimingId}
              acceptingId={acceptingId}
              onTxClick={onTxClick}
              onReclaim={handleReclaim}
              onAccept={handleAccept}
            />
          ))
        )}
      </div>

      {!hideLoadMore && !limit && filteredAndSorted.length > visibleCount && (
        <div className="pt-8 pb-4 flex justify-center">
          <button
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            className="group relative px-10 h-14 rounded-2xl overflow-hidden transition-all hover:scale-105 active:scale-95"
          >
            <div className="absolute inset-0 bg-white/5 group-hover:bg-white/8 border border-white/10 transition-colors" />
            <span className="relative z-10 text-[10px] font-bold uppercase tracking-[0.3em] text-brand-secondary/60 group-hover:text-brand-secondary transition-colors">
              Load More Transactions
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
