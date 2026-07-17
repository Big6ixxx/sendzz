/**
 * Types for the public `/explore` transparency dashboard.
 *
 * These mirror the anonymized `public_transaction_feed` view + the get_public_stats /
 * get_public_feed_totals RPCs from migration 031. Nothing here contains PII — see the
 * migration header for the anonymity contract.
 */

export type TxType = 'transfer' | 'deposit' | 'withdrawal' | 'bridge';

/** A single anonymized row from `public_transaction_feed`. */
export interface PublicFeedRow {
  id: string;
  tx_type: TxType;
  amount: number;
  asset: string;
  status: string;
  is_settled: boolean;
  source_chain: string | null;
  dest_chain: string | null;
  consolidated: boolean;
  tx_hash: string | null;
  secondary_tx_hash: string | null;
  fiat_currency: string | null;
  created_at: string;
}

export interface PerTypeStat {
  count: number;
  volume: number;
}

export type SystemStatus = 'operational' | 'degraded' | 'down';

/** Shape returned by `get_public_stats()`. */
export interface PublicStats {
  total_users: number;
  active_users_24h: number;
  active_users_7d: number;
  total_volume: number;
  tx_count_total: number;
  pending_count: number;
  by_type: Partial<Record<TxType, PerTypeStat>>;
  last_tx_at: string | null;
  system_status: SystemStatus;
}

/** Shape returned by `get_public_feed_totals(...)`. */
export interface PublicFeedTotals {
  total_count: number;
  total_volume: number;
  by_type: Partial<Record<TxType, number>>;
}

export type TimeRange = '24h' | '7d' | '30d' | '6m' | '1y' | 'all';
export type SortColumn = 'created_at' | 'amount';
export type SortDir = 'asc' | 'desc';

/** Filter/sort/pagination inputs shared by the feed + totals server actions. */
export interface FeedQuery {
  type?: TxType | null;
  chain?: string | null;
  range?: TimeRange;
  search?: string;
  sortCol?: SortColumn;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

/** Paginated feed result returned to the client. */
export interface PublicFeedResult {
  rows: PublicFeedRow[];
  total: number;
  page: number;
  pageSize: number;
}
