'use server';

/**
 * Public (unauthenticated) data access for the `/explore` transparency dashboard.
 *
 * Every query here reads ONLY from the anonymized `public_transaction_feed` view or the
 * get_public_stats / get_public_feed_totals RPCs (migration 031) — never the raw tables —
 * so PII can never leak. All filtering, searching, sorting, and pagination happen SQL-side;
 * the browser only ever receives one page of rows plus aggregate totals.
 */

import { supabaseAdmin } from './adminClient';
import type {
  FeedQuery,
  PublicFeedResult,
  PublicFeedRow,
  PublicFeedTotals,
  PublicStats,
  TimeRange,
} from '@/types/public';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Resolve a time-range preset to an ISO start bound (null = no lower bound). */
function rangeStart(range: TimeRange | undefined): string | null {
  if (!range || range === 'all') return null;
  const now = new Date();
  switch (range) {
    case '24h':
      now.setHours(now.getHours() - 24);
      break;
    case '7d':
      now.setDate(now.getDate() - 7);
      break;
    case '30d':
      now.setDate(now.getDate() - 30);
      break;
    case '6m':
      now.setMonth(now.getMonth() - 6);
      break;
    case '1y':
      now.setFullYear(now.getFullYear() - 1);
      break;
  }
  return now.toISOString();
}

/** Escape PostgREST `.or()` reserved chars in user search input. */
function sanitizeSearch(search: string | undefined): string {
  // Strip anything that isn't a hex/base58 tx-hash character to keep the ILIKE safe.
  return (search || '').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 128);
}

/** Headline platform metrics + system status. */
export async function getPublicStats(): Promise<PublicStats | null> {
  const { data, error } = await supabaseAdmin.rpc('get_public_stats');
  if (error) {
    console.error('[public-stats] getPublicStats failed:', error.message);
    return null;
  }
  return data as unknown as PublicStats;
}

/** One page of anonymized transactions matching the given filters. */
export async function getPublicFeed(query: FeedQuery): Promise<PublicFeedResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const sortCol = query.sortCol ?? 'created_at';
  const ascending = query.sortDir === 'asc';
  const start = rangeStart(query.range);
  const search = sanitizeSearch(query.search);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabaseAdmin
    .from('public_transaction_feed')
    .select('*', { count: 'exact' })
    .order(sortCol, { ascending })
    // Stable secondary sort so rows with equal primary keys paginate deterministically.
    .order('id', { ascending });

  if (query.type) q = q.eq('tx_type', query.type);
  if (query.chain) q = q.or(`source_chain.eq.${query.chain},dest_chain.eq.${query.chain}`);
  if (start) q = q.gte('created_at', start);
  if (search) q = q.or(`tx_hash.ilike.%${search}%,secondary_tx_hash.ilike.%${search}%`);

  const { data, error, count } = await q.range(from, to);

  if (error) {
    console.error('[public-stats] getPublicFeed failed:', error.message);
    return { rows: [], total: 0, page, pageSize };
  }

  return {
    rows: (data ?? []) as PublicFeedRow[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Aggregate totals for the CURRENT filter set (independent of pagination). */
export async function getPublicFeedTotals(query: FeedQuery): Promise<PublicFeedTotals> {
  const start = rangeStart(query.range);
  const search = sanitizeSearch(query.search);

  const { data, error } = await supabaseAdmin.rpc('get_public_feed_totals', {
    p_type: query.type ?? null,
    p_chain: query.chain ?? null,
    p_start: start,
    p_end: null,
    p_search: search || null,
  });

  if (error) {
    console.error('[public-stats] getPublicFeedTotals failed:', error.message);
    return { total_count: 0, total_volume: 0, by_type: {} };
  }

  return data as unknown as PublicFeedTotals;
}

/** Fetch a single anonymized transaction by id (for the deep-linked detail modal). */
export async function getPublicTransaction(id: string): Promise<PublicFeedRow | null> {
  const { data, error } = await supabaseAdmin
    .from('public_transaction_feed')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[public-stats] getPublicTransaction failed:', error.message);
    return null;
  }
  return (data as PublicFeedRow) ?? null;
}
