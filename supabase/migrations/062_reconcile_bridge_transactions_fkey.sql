-- `bridge_transactions.user_id` points at the wrong table in this repo.
--
-- Migration 013 moved the transaction tables off `auth.users` and onto `public.users`, because
-- Privy is the identity here and nothing ever writes a row into Supabase's own auth schema. It
-- did deposits, withdrawals, transfers, audit_logs and otp_logs — and missed this one.
--
-- Production has been correct since some point after that: a schema dump taken 2026-09-25 shows
-- the constraint referencing `public.users`. It was evidently repaired by hand and the repair
-- never made it back into a migration, so the repo has been describing a foreign key that would
-- make the feature impossible. `lib/supabase/transactions.ts` inserts a bridge row with a
-- `user_id` taken from `public.users`; against the constraint as this repo declares it, every
-- one of those inserts fails. Bridging works in production precisely because production does
-- not match this repo.
--
-- Anyone rebuilding from these migrations — a staging environment, a restore, a local database
-- — inherits the broken version. This is the statement that would have been written at the time.
--
-- In production this is a no-op that replaces the constraint with an identical one. Doing it
-- unconditionally rather than probing first keeps the outcome the same either way.

ALTER TABLE public.bridge_transactions
  DROP CONSTRAINT IF EXISTS bridge_transactions_user_id_fkey;

ALTER TABLE public.bridge_transactions
  ADD CONSTRAINT bridge_transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- A note on `balances`, which 013 also missed and this migration deliberately leaves alone.
--
-- `balances.user_id` still references `auth.users` in both this repo and production, so on that
-- one they agree. It is not fixed here because nothing reads or writes the table: there is not a
-- single reference to it anywhere in lib/ or app/. Repointing a foreign key on a table no code
-- touches would be a change with no behaviour attached to it, and would suggest the table is
-- live when it is not. It should be dropped, but dropping a table is a decision that wants to be
-- made deliberately and on its own, not buried in a migration about something else.
