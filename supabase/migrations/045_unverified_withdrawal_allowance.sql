-- A one-off 100 USDC withdrawal allowance for users who have not verified their identity.
--
-- The old rule was three rolling windows (500/day, 2500/week, 10000/month) summed across
-- transfers AND withdrawals. It never expressed the actual policy: a first-ever withdrawal of
-- 400 sat comfortably inside the daily window and went straight through, four times what the
-- app told users they could do without verifying.
--
-- The policy is a single cumulative total instead. Withdraw 100 in one go, or 20 five times —
-- either way, once the total reaches 100 the next withdrawal needs identity verification. A
-- rolling window cannot express that: it forgives, and this must not.
--
-- Counting starts from a cutoff the application passes in, so the rule applies going forward
-- and nobody is retroactively over their limit on the day it ships.

-- ── What counts: money that actually left, and was not returned ──────────────
--
-- `tx_hash is not null` is the whole test for "left". A withdrawal row is written when the
-- quote is taken, before anything is signed — so a user who opens the withdrawal screen,
-- changes their mind and starts again leaves a row behind that never moved a cent. Counting
-- those would burn an allowance on transactions that never happened, and they are common:
-- the quote expires ~16 minutes later and the row is finalised as `failed`.
--
-- `failed` and `reversed` are excluded on top of that. A failure after the deposit landed does
-- carry a hash, but the USDC is owed back (`refund_owed_usdc`, migration 039) — charging the
-- allowance for money being returned would be counting it twice.
--
-- In-flight withdrawals DO count once signed: `processing` with a hash is money already gone,
-- and waiting for `completed` would let several concurrent withdrawals each pass the check.
create or replace function public.get_unverified_withdrawal_total(
  p_user_id uuid,
  p_since   timestamptz
)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(amount_usdc), 0)::numeric
  from public.withdrawals
  where user_id = p_user_id
    and created_at >= p_since
    and tx_hash is not null
    and status not in ('failed', 'reversed');
$$;

comment on function public.get_unverified_withdrawal_total(uuid, timestamptz) is
  'Total USDC a user has actually withdrawn since p_since, counting only withdrawals that moved money and were not refunded. Drives the unverified withdrawal allowance.';

-- Same posture as every other KYC function: the service role calls it, nobody else. A client
-- that could call this directly could not change the answer, but it should not be able to read
-- another user's withdrawal volume either.
revoke all on function public.get_unverified_withdrawal_total(uuid, timestamptz) from public;
grant execute on function public.get_unverified_withdrawal_total(uuid, timestamptz) to service_role;

-- Makes the sum an index-only lookup rather than a scan of the user's whole withdrawal
-- history. It runs on the withdrawal path, before the user can enter an amount.
create index if not exists withdrawals_user_settled_idx
  on public.withdrawals (user_id, created_at)
  where tx_hash is not null and status not in ('failed', 'reversed');
