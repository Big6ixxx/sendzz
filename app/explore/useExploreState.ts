'use client';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  getPublicFeed,
  getPublicFeedTotals,
  getPublicStats,
  getPublicTransaction,
} from '@/lib/supabase/public-stats';
import type { SortColumn, TimeRange, TxType } from '@/types/public';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { PAGE_SIZE } from './constants';

/**
 * Owns all explorer data concerns: filter state, the three server-side queries (stats, feed,
 * totals — every filter/sort/search/page is resolved on the backend), and the deep-linked
 * (?tx=) detail-modal selection. Presentational components stay dumb; this is the container.
 */
export function useExploreState() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Filters ──
  const [type, setType] = useState<TxType | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>('30d');
  const [sortCol, setSortCol] = useState<SortColumn>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const search = useDebouncedValue(searchInput.trim(), 350);

  const filters = useMemo(
    () => ({ type, chain, range, search, sortCol, sortDir }),
    [type, chain, range, search, sortCol, sortDir],
  );

  // Reset to page 1 whenever a filter (not the page itself) changes — done during render via the
  // "store previous value" pattern rather than an effect, to avoid cascading renders.
  const filtersKey = JSON.stringify(filters);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  const toggleSort = useCallback(
    (col: SortColumn) => {
      if (col === sortCol) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortCol(col);
        setSortDir('desc');
      }
    },
    [sortCol],
  );

  // ── Queries (all work happens server-side) ──
  const statsQuery = useQuery({
    queryKey: ['public-stats'],
    queryFn: getPublicStats,
    refetchInterval: 60_000,
  });

  const feedQuery = useQuery({
    queryKey: ['public-feed', filters, page],
    queryFn: () => getPublicFeed({ ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const totalsQuery = useQuery({
    queryKey: ['public-feed-totals', filters],
    queryFn: () => getPublicFeedTotals(filters),
    placeholderData: keepPreviousData,
  });

  const total = feedQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Deep-linked detail modal via ?tx=<id> ──
  const selectedId = searchParams.get('tx');

  const openTx = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tx', id);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const closeTx = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('tx');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/explore', { scroll: false });
  }, [router, searchParams]);

  const rows = feedQuery.data?.rows ?? [];
  const rowInPage = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;
  const selectedQuery = useQuery({
    queryKey: ['public-tx', selectedId],
    queryFn: () => getPublicTransaction(selectedId!),
    enabled: !!selectedId && !rowInPage,
  });
  const selectedRow = rowInPage ?? selectedQuery.data ?? null;

  return {
    // filter state
    type, setType,
    chain, setChain,
    range, setRange,
    sortCol, sortDir, toggleSort,
    searchInput, setSearchInput,
    page, setPage, totalPages,

    // query results
    stats: statsQuery.data ?? null,
    statsLoading: statsQuery.isLoading,
    rows,
    total,
    feedLoading: feedQuery.isLoading,
    feedFetching: feedQuery.isFetching,
    totals: totalsQuery.data ?? null,

    // modal
    selectedId,
    selectedRow,
    selectedLoading: !!selectedId && !selectedRow && selectedQuery.isLoading,
    openTx,
    closeTx,
  };
}
