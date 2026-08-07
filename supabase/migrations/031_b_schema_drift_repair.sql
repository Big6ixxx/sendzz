-- 031_b: Repair schema drift — columns the app requires that no migration ever created.
--
-- These four columns exist in production and in types/database.ts, and are read and
-- written across the app, but they were added by hand and never captured here. The gap
-- only surfaced when the schema was rebuilt from scratch for a testnet database:
-- 031_public_dashboard builds `public_transaction_feed` over `d.tx_hash` and `w.tx_hash`,
-- and failed with "column d.tx_hash does not exist" on an empty project.
--
-- Ordering matters: this file must apply before 031_public_dashboard.sql, which is why it
-- is named to sort between 031_add_stellar_columns_to_users.sql and that view.
--
-- Every statement is IF NOT EXISTS, so this is a no-op against production (which already
-- has all four) and safe to re-run anywhere.

-- ── Deposits ─────────────────────────────────────────────────────────────────
-- On-chain hash of the USDC delivery. Written by the deposit scanner for direct
-- on-chain deposits, and by the ramp webhooks once a purchase settles.
ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;

-- ── Withdrawals ──────────────────────────────────────────────────────────────
-- tx_hash:       the on-chain USDC transfer that funded the off-ramp.
-- fiat_amount:   payout amount in the destination currency.
-- exchange_rate: USDC → fiat rate quoted at the time of the order, kept so a receipt can
--                be reproduced later even after the rate has moved.
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS fiat_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC;

-- ── Webhook events ───────────────────────────────────────────────────────────
-- Provider's event name (e.g. payment.settled), used to route and de-duplicate
-- incoming webhooks.
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS event_type TEXT;

-- Deposit lookups by hash back the "have we already recorded this deposit?" check that
-- keeps the scanner idempotent across re-scans.
CREATE INDEX IF NOT EXISTS idx_deposits_tx_hash ON public.deposits (tx_hash);
CREATE INDEX IF NOT EXISTS idx_withdrawals_tx_hash ON public.withdrawals (tx_hash);

-- ── Foreign keys missed by 013_fix_fkeys_for_privy ───────────────────────────
-- Identity moved to Privy, so users live in public.users and there is no auth.users row
-- to point at. 013 repointed deposits, withdrawals, transfers, audit_logs and otp_logs
-- but missed these two, which were created back in 008. On a rebuilt database every
-- bridge insert fails with "Key (user_id)=… is not present in table users", and any
-- balance lock fails the same way. Production has both repointed already — by hand,
-- which is why the gap never showed up until the schema was rebuilt from these files.
ALTER TABLE public.bridge_transactions
  DROP CONSTRAINT IF EXISTS bridge_transactions_user_id_fkey;
ALTER TABLE public.bridge_transactions
  ADD CONSTRAINT bridge_transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.balances
  DROP CONSTRAINT IF EXISTS balances_user_id_fkey;
ALTER TABLE public.balances
  ADD CONSTRAINT balances_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
