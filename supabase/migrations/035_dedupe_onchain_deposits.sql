-- 035: Make a deposit unrepeatable per (user, transaction) — ADDITIVE, safe to re-run.
--
-- The on-chain deposit scanner reads its cursor + known-hash set at the start of a scan and
-- inserts at the end, so two scans overlapping in that window build identical rows and both
-- insert. The in-memory throttle in deposit-scanner.ts can't stop this: it's a per-instance
-- Map, and the reconcile cron runs in a different invocation from a user's history load.
--
-- Nothing in the schema forbade the second row, so this adds the constraint that does.
--
-- Uniqueness is on (user_id, tx_hash), NOT tx_hash alone: one batch-send transaction pays
-- several recipients, so the same hash legitimately appears once per user.
--
-- The index is deliberately NOT partial on `tx_hash IS NOT NULL`. It doesn't need to be —
-- Postgres treats NULLs as distinct in a unique index, so the fiat-ramp rows that are created
-- before their hash is known stay unconstrained either way. And it must not be: ON CONFLICT
-- can only pick a partial index when the statement repeats its predicate as a WHERE clause,
-- which PostgREST can't send, so the scanner's upsert would fail to find an arbiter index.

-- ── 1. Report what's already duplicated, so the deploy log names it ──────────
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT user_id, tx_hash, count(*) AS copies,
           string_agg(coalesce(provider, '(none)'), ', ' ORDER BY created_at) AS providers
    FROM public.deposits
    WHERE tx_hash IS NOT NULL
    GROUP BY user_id, tx_hash
    HAVING count(*) > 1
  LOOP
    n := n + 1;
    RAISE NOTICE 'duplicate deposit: user=% tx=% copies=% providers=[%]',
      r.user_id, r.tx_hash, r.copies, r.providers;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'no duplicate deposits found';
  ELSE
    RAISE NOTICE '% duplicated (user, tx_hash) group(s) — collapsing to one row each', n;
  END IF;
END $$;

-- ── 2. Collapse each duplicate group to a single row ─────────────────────────
-- Keep-rule, in order:
--   1. A fiat-ramp row (Paycrest — the only wired on-ramp) over an `onchain` one. Both describe
--      the same arrival, but only the ramp row carries the fiat side — amount, currency, order
--      id. This is the ramp race: the scanner recorded the delivery before the webhook filled
--      in tx_hash, so dedupe couldn't see it.
--   2. Otherwise the earliest row, which is the one history and receipts already reference.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, tx_hash
           ORDER BY (provider IS DISTINCT FROM 'onchain') DESC, created_at ASC, id ASC
         ) AS rn
  FROM public.deposits
  WHERE tx_hash IS NOT NULL
)
DELETE FROM public.deposits d
USING ranked
WHERE d.id = ranked.id AND ranked.rn > 1;

-- ── 3. Enforce it from here on ───────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS deposits_user_tx_hash_uniq
  ON public.deposits (user_id, tx_hash);
