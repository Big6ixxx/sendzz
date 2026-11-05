import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ActivityType } from '@/components/HistoryModule';
import { ACTIVITY_LOOK } from '@/components/dashboard/activity-look';
import { parseAppError } from '@/lib/errors/appErrors';
import { useActivities } from './useActivities';

export type HistoryFilter = ActivityType | 'all';
export type HistorySort = 'date' | 'amount';

/** The older names, still matched by search so a query typed either way finds the row. */
const LEGACY_LABELS: Record<ActivityType, string> = {
  sent: 'Transfer Sent',
  received: 'Funds Received',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bridge: 'Bridge Transfer',
  security: 'Security Alert',
};

/**
 * Everything a history list does apart from drawing itself: search, type filter, sort, paging,
 * and the two row actions (accept an incoming claim, reclaim an expired outgoing one).
 * Shared by every history list so their behaviour cannot drift apart.
 */
export function useHistoryList({
  userId,
  userEmail,
  pageSize = 10,
  limit,
}: {
  userId: string;
  userEmail: string;
  pageSize?: number;
  /** A fixed number of rows, with no paging. */
  limit?: number;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [sort, setSort] = useState<HistorySort>('date');
  const [visibleCount, setVisibleCount] = useState(limit || pageSize);
  const [reclaimingId, setReclaimingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const query = useActivities(userEmail, userId);
  const all = query.data;

  const filtered = useMemo(() => {
    if (!all) return [];
    let result = filter === 'all' ? [...all] : all.filter((a) => a.type === filter);

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (a) =>
          a.details.toLowerCase().includes(q) ||
          LEGACY_LABELS[a.type].toLowerCase().includes(q) ||
          ACTIVITY_LOOK[a.type].label.toLowerCase().includes(q) ||
          a.amount.toString().includes(q) ||
          a.note?.toLowerCase().includes(q),
      );
    }

    // Already newest first from useActivities; only the size order needs a sort.
    if (sort === 'amount') result.sort((a, b) => b.amount - a.amount);
    return result;
  }, [all, filter, search, sort]);

  const visible = useMemo(() => filtered.slice(0, limit || visibleCount), [filtered, limit, visibleCount]);

  async function postAction(
    path: string,
    transferId: string,
    fallbackError: string,
    onDone: () => void,
  ) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId }),
      });
      const data = await res.json();
      if (!res.ok) toast.error(parseAppError(data.error || fallbackError));
      else onDone();
    } catch (err) {
      toast.error(parseAppError(err));
    }
  }

  async function accept(transferId: string) {
    setAcceptingId(transferId);
    await postAction('/api/transfer/accept', transferId, 'Could not accept payment', () => {
      toast.success('Payment accepted! Funds added to your balance');
      queryClient.invalidateQueries({ queryKey: ['history', userEmail] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['pending-incoming', userEmail] });
    });
    setAcceptingId(null);
  }

  async function reclaim(transferId: string) {
    setReclaimingId(transferId);
    await postAction('/api/transfer/reclaim', transferId, 'Could not reclaim transfer', () => {
      toast.success('Funds returned to your balance');
      queryClient.invalidateQueries({ queryKey: ['history', userEmail] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
    });
    setReclaimingId(null);
  }

  return {
    all,
    filtered,
    visible,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    // A new search, kind or order starts again from the first page.
    search,
    setSearch: (v: string) => {
      setSearch(v);
      setVisibleCount(limit || pageSize);
    },
    filter,
    setFilter: (v: HistoryFilter) => {
      setFilter(v);
      setVisibleCount(limit || pageSize);
    },
    sort,
    setSort: (v: HistorySort) => {
      setSort(v);
      setVisibleCount(limit || pageSize);
    },
    hasMore: !limit && filtered.length > visibleCount,
    showMore: () => setVisibleCount((n) => n + pageSize),
    accept,
    reclaim,
    acceptingId,
    reclaimingId,
  };
}
