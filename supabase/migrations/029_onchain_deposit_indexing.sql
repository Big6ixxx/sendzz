-- 029: On-chain USDC deposit indexing (ADDITIVE — run at deploy time).
--
-- Supports recording USDC that users receive directly to their wallet as deposit history:
--   • deposit_sync_state — a per-(user, chain) cursor so each scan only looks at transfers
--     AFTER the last one we processed (instead of re-reading the recent window every time),
--     and so a first scan can deep-backfill from the beginning then stay incremental.
--   • users.solana_address — persist the user's Solana wallet so the server can scan it
--     without the client having to pass it in.

-- ── Per-(user, chain) scan cursor ────────────────────────────────────────────
-- `cursor` is opaque per rail: EVM stores the last scanned block (decimal string);
-- Solana stores the last processed transaction signature.
CREATE TABLE IF NOT EXISTS public.deposit_sync_state (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chain      text NOT NULL,
  cursor     text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chain)
);

-- ── Persist the Solana wallet address ────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS solana_address text;

-- When the user's deposits were last scanned. The reconcile cron scans users least-recently
-- scanned first (nulls first = never scanned), so idle users' backfills still make progress.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_deposit_scan_at timestamptz;
