-- 031: Public transparency dashboard (ADDITIVE — read-only, safe to run anytime).
--
-- Backs the public `/explore` page. The entire public data path reads ONLY from the
-- `public_transaction_feed` view + the two SECURITY DEFINER functions below. This view is
-- the anonymity boundary: it exposes exclusively columns that are already public on-chain
-- (hashes, USDC amounts, chains, status, timestamps) and NEVER emails, bank details, user
-- ids, exact fiat amounts, exchange rates, provider metadata, order ids, notes, or claim
-- tokens. Rows are independent anonymous events (no per-user identifier) so the feed can't
-- be used to cluster one user's activity.
--
-- Nothing is written or altered — this only adds a view + two functions.

-- ── The anonymity boundary: normalized, PII-free union of all tx tables ──────────
DROP VIEW IF EXISTS public.public_transaction_feed;
CREATE VIEW public.public_transaction_feed AS
  -- Transfers (user → user). Settle on their source chain (default base). No fiat leg.
  SELECT
    t.id,
    'transfer'::text                              AS tx_type,
    t.amount                                      AS amount,
    t.asset::text                                 AS asset,
    t.status::text                                AS status,
    (t.status IN ('completed', 'claimed'))        AS is_settled,
    t.source_chain                                AS source_chain,
    NULL::text                                    AS dest_chain,
    false                                         AS consolidated,
    t.tx_hash                                     AS tx_hash,
    NULL::text                                    AS secondary_tx_hash,
    NULL::text                                    AS fiat_currency,
    t.created_at                                  AS created_at
  FROM public.transfers t

  UNION ALL

  -- Deposits (fiat on-ramp → USDC). Only the fiat currency CODE is exposed, never the amount.
  SELECT
    d.id,
    'deposit'::text                               AS tx_type,
    COALESCE(d.amount_usdc, 0)                     AS amount,
    'USDC'::text                                   AS asset,
    d.status::text                                 AS status,
    (d.status = 'confirmed')                       AS is_settled,
    d.network                                     AS source_chain,
    NULL::text                                    AS dest_chain,
    false                                         AS consolidated,
    d.tx_hash                                     AS tx_hash,
    NULL::text                                    AS secondary_tx_hash,
    d.currency_fiat                               AS fiat_currency,
    d.created_at                                  AS created_at
  FROM public.deposits d

  UNION ALL

  -- Withdrawals (USDC → fiat off-ramp). Bank account + fiat amount are deliberately omitted.
  SELECT
    w.id,
    'withdrawal'::text                            AS tx_type,
    w.amount_usdc                                 AS amount,
    'USDC'::text                                   AS asset,
    w.status::text                                 AS status,
    (w.status = 'completed')                       AS is_settled,
    w.source_chain                                AS source_chain,
    NULL::text                                    AS dest_chain,
    COALESCE(w.consolidated, false)               AS consolidated,
    w.tx_hash                                     AS tx_hash,
    NULL::text                                    AS secondary_tx_hash,
    w.fiat_currency                               AS fiat_currency,
    w.created_at                                  AS created_at
  FROM public.withdrawals w

  UNION ALL

  -- Bridges (CCTP cross-chain). burn hash on source, mint hash on dest.
  SELECT
    b.id,
    'bridge'::text                                AS tx_type,
    b.amount                                      AS amount,
    'USDC'::text                                   AS asset,
    b.attestation_status::text                     AS status,
    (b.attestation_status = 'complete')            AS is_settled,
    b.source_chain                                AS source_chain,
    b.dest_chain                                  AS dest_chain,
    false                                         AS consolidated,
    b.burn_tx_hash                                AS tx_hash,
    b.mint_tx_hash                                AS secondary_tx_hash,
    NULL::text                                    AS fiat_currency,
    b.created_at                                  AS created_at
  FROM public.bridge_transactions b;

COMMENT ON VIEW public.public_transaction_feed IS
  'Anonymized, PII-free union of all transaction tables. Sole data source for the public /explore page.';

-- ── Headline platform stats for the public dashboard ────────────────────────────
-- Aggregates user ids internally (for active/total user counts) but returns ONLY counts —
-- no identifiers leave the function. system_status is derived from recent activity health.
CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_users        bigint;
  v_active_24h         bigint;
  v_active_7d          bigint;
  v_last_tx_at         timestamptz;
  v_pending_count      bigint;
  v_recent_total       bigint;   -- txs created in last 24h
  v_recent_failed      bigint;   -- failed/reversed in last 24h
  v_by_type            jsonb;
  v_total_volume       numeric;
  v_tx_count_total     bigint;
  v_system_status      text;
  v_now                timestamptz := now();
BEGIN
  SELECT count(*) INTO v_total_users FROM public.users;

  -- Unique active users over the two windows (union of every activity table).
  SELECT count(DISTINCT uid) INTO v_active_24h FROM (
    SELECT sender_id AS uid FROM public.transfers WHERE created_at >= v_now - interval '24 hours'
    UNION SELECT recipient_id FROM public.transfers WHERE created_at >= v_now - interval '24 hours' AND recipient_id IS NOT NULL
    UNION SELECT user_id FROM public.deposits WHERE created_at >= v_now - interval '24 hours'
    UNION SELECT user_id FROM public.withdrawals WHERE created_at >= v_now - interval '24 hours'
    UNION SELECT user_id FROM public.bridge_transactions WHERE created_at >= v_now - interval '24 hours'
  ) a;

  SELECT count(DISTINCT uid) INTO v_active_7d FROM (
    SELECT sender_id AS uid FROM public.transfers WHERE created_at >= v_now - interval '7 days'
    UNION SELECT recipient_id FROM public.transfers WHERE created_at >= v_now - interval '7 days' AND recipient_id IS NOT NULL
    UNION SELECT user_id FROM public.deposits WHERE created_at >= v_now - interval '7 days'
    UNION SELECT user_id FROM public.withdrawals WHERE created_at >= v_now - interval '7 days'
    UNION SELECT user_id FROM public.bridge_transactions WHERE created_at >= v_now - interval '7 days'
  ) a;

  -- Per-type settled volume + total counts, straight off the anonymized view.
  SELECT
    jsonb_object_agg(tx_type, jsonb_build_object(
      'count', cnt,
      'volume', vol
    )),
    COALESCE(sum(vol), 0),
    COALESCE(sum(cnt), 0),
    max(last_at)
  INTO v_by_type, v_total_volume, v_tx_count_total, v_last_tx_at
  FROM (
    SELECT
      tx_type,
      count(*)                                              AS cnt,
      COALESCE(sum(amount) FILTER (WHERE is_settled), 0)    AS vol,
      max(created_at)                                       AS last_at
    FROM public.public_transaction_feed
    GROUP BY tx_type
  ) g;

  -- Pending backlog + last-24h health for the status heuristic.
  SELECT count(*) INTO v_pending_count FROM public.public_transaction_feed
    WHERE status IN ('pending', 'pending_claim', 'processing', 'awaiting_verification');

  SELECT count(*) INTO v_recent_total FROM public.public_transaction_feed
    WHERE created_at >= v_now - interval '24 hours';
  SELECT count(*) INTO v_recent_failed FROM public.public_transaction_feed
    WHERE created_at >= v_now - interval '24 hours' AND status IN ('failed', 'reversed', 'cancelled');

  -- Status heuristic:
  --   down      → no successful/settled activity in the last 24h at all
  --   degraded  → >20% of last-24h txs failed, or a large pending backlog
  --   operational otherwise
  IF v_last_tx_at IS NULL OR v_last_tx_at < v_now - interval '24 hours' THEN
    v_system_status := 'down';
  ELSIF v_recent_total > 0 AND v_recent_failed::numeric / v_recent_total > 0.20 THEN
    v_system_status := 'degraded';
  ELSIF v_pending_count > 50 THEN
    v_system_status := 'degraded';
  ELSE
    v_system_status := 'operational';
  END IF;

  RETURN jsonb_build_object(
    'total_users',      v_total_users,
    'active_users_24h', v_active_24h,
    'active_users_7d',  v_active_7d,
    'total_volume',     v_total_volume,
    'tx_count_total',   v_tx_count_total,
    'pending_count',    v_pending_count,
    'by_type',          COALESCE(v_by_type, '{}'::jsonb),
    'last_tx_at',       v_last_tx_at,
    'system_status',    v_system_status
  );
END;
$$;

-- ── Totals for the CURRENT filter set (independent of pagination) ────────────────
-- p_chain matches either the source OR destination chain. p_search is a case-insensitive
-- substring match on either hash. All args are optional (NULL = no constraint).
CREATE OR REPLACE FUNCTION public.get_public_feed_totals(
  p_type   text DEFAULT NULL,
  p_chain  text DEFAULT NULL,
  p_start  timestamptz DEFAULT NULL,
  p_end    timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT *
    FROM public.public_transaction_feed
    WHERE (p_type   IS NULL OR tx_type = p_type)
      AND (p_chain  IS NULL OR source_chain = p_chain OR dest_chain = p_chain)
      AND (p_start  IS NULL OR created_at >= p_start)
      AND (p_end    IS NULL OR created_at <= p_end)
      AND (p_search IS NULL OR p_search = ''
           OR tx_hash ILIKE '%' || p_search || '%'
           OR secondary_tx_hash ILIKE '%' || p_search || '%')
  )
  SELECT jsonb_build_object(
    'total_count',  (SELECT count(*) FROM filtered),
    'total_volume', (SELECT COALESCE(sum(amount) FILTER (WHERE is_settled), 0) FROM filtered),
    'by_type',      (SELECT COALESCE(jsonb_object_agg(tx_type, cnt), '{}'::jsonb)
                     FROM (SELECT tx_type, count(*) AS cnt FROM filtered GROUP BY tx_type) t)
  );
$$;
