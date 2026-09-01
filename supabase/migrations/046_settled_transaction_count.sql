-- The explore page's transaction count should mean what it says: transactions that happened.
--
-- `get_public_stats` filtered VOLUME on `is_settled` but counted every row, so the headline
-- "Transactions / All-time count" included failed withdrawals, expired quotes that never moved
-- a cent, and anything still processing. The two figures sat side by side disagreeing about
-- what they described: a settled volume next to an everything count.
--
-- `is_settled` is already defined per type by `public_transaction_feed`, so there is no new
-- rule here:
--   transfers   -> completed / claimed
--   deposits    -> confirmed
--   withdrawals -> completed
--   bridges     -> attestation_status complete
--
-- This is migration 031's function reproduced verbatim with ONE line changed, so the status
-- heuristic, the active-user windows and the returned keys are exactly as they were. Written
-- that way on purpose: retyping a 90-line function to change a count is how `system_status`
-- quietly goes missing.
--
-- `get_public_feed_totals` is deliberately untouched. Its "Matching transactions" figure counts
-- the rows the table below it is actually showing, filters and all, so filtering that one would
-- make the number disagree with the list it sits above.

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
      count(*) FILTER (WHERE is_settled)                    AS cnt,
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
