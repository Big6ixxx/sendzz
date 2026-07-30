-- =========================================
-- KYC VERIFICATIONS & TRANSACTION LIMITS
-- Migration: 034_kyc_and_limits.sql
-- =========================================

-- ─── Enum ──────────────────────────────────────────────────────────────────
do $$ begin
  create type public.kyc_status as enum (
    'not_started',
    'pending',
    'in_review',
    'approved',
    'declined'
  );
exception
  when duplicate_object then null;
end $$;

-- ─── Table: kyc_verifications ───────────────────────────────────────────────
-- One row per user. Upserted whenever Didit sends a status update.
-- `didit_session_id` is the canonical session ID from Didit's API.
-- `vendor_data` mirrors what we sent Didit (= our internal user ID) so we can
-- match webhooks back to users without trusting the payload alone.
create table if not exists public.kyc_verifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  didit_session_id  text unique,
  vendor_data       text,   -- our user_id stringified, for webhook reconciliation
  status            public.kyc_status not null default 'not_started',
  -- raw last webhook payload for audit
  last_webhook_payload jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- only one active verification row per user
  constraint kyc_verifications_user_id_unique unique (user_id)
);

create index if not exists idx_kyc_verifications_user_id
  on public.kyc_verifications(user_id);

create index if not exists idx_kyc_verifications_didit_session_id
  on public.kyc_verifications(didit_session_id);

create index if not exists idx_kyc_verifications_vendor_data
  on public.kyc_verifications(vendor_data);

-- Auto-update updated_at
drop trigger if exists trg_kyc_verifications_updated_at on public.kyc_verifications;
create trigger trg_kyc_verifications_updated_at
  before update on public.kyc_verifications
  for each row execute function public.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────
alter table public.kyc_verifications enable row level security;

-- Users can see their own KYC record (status, session id) — needed for the
-- dashboard to show verification state.
drop policy if exists "Users can view own kyc record" on public.kyc_verifications;
create policy "Users can view own kyc record"
  on public.kyc_verifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- All mutations happen via service-role (admin client) only.
drop policy if exists "No direct kyc mutations by users" on public.kyc_verifications;
create policy "No direct kyc mutations by users"
  on public.kyc_verifications
  for all
  to authenticated
  using (false)
  with check (false);

-- ─── RPC: get_user_transaction_totals ──────────────────────────────────────
-- Returns the sum of USDC sent/withdrawn by a user in rolling daily, weekly,
-- and monthly windows.  Computes across transfers (sent), withdrawals, and
-- deposits (on-ramps counted as neutral but included for future tiers).
-- All amounts are stored in USDC so no conversion is needed.
create or replace function public.get_user_transaction_totals(
  p_user_id uuid
)
returns table (
  daily_total   numeric,
  weekly_total  numeric,
  monthly_total numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with
  transfers_sent as (
    select
      coalesce(sum(amount), 0) as daily,
      coalesce(sum(case when created_at >= now() - interval '7 days'  then amount else 0 end), 0) as weekly,
      coalesce(sum(case when created_at >= now() - interval '30 days' then amount else 0 end), 0) as monthly
    from public.transfers
    where sender_id = p_user_id
      and created_at >= now() - interval '1 day'
      and status not in ('cancelled', 'expired')
  ),
  transfers_sent_weekly as (
    select
      coalesce(sum(amount), 0) as weekly,
      coalesce(sum(case when created_at >= now() - interval '30 days' then amount else 0 end), 0) as monthly
    from public.transfers
    where sender_id = p_user_id
      and created_at >= now() - interval '7 days'
      and status not in ('cancelled', 'expired')
  ),
  transfers_sent_monthly as (
    select coalesce(sum(amount), 0) as monthly
    from public.transfers
    where sender_id = p_user_id
      and created_at >= now() - interval '30 days'
      and status not in ('cancelled', 'expired')
  ),
  withdrawals_daily as (
    select coalesce(sum(amount_usdc), 0) as total
    from public.withdrawals
    where user_id = p_user_id
      and created_at >= now() - interval '1 day'
      and status not in ('failed', 'reversed')
  ),
  withdrawals_weekly as (
    select coalesce(sum(amount_usdc), 0) as total
    from public.withdrawals
    where user_id = p_user_id
      and created_at >= now() - interval '7 days'
      and status not in ('failed', 'reversed')
  ),
  withdrawals_monthly as (
    select coalesce(sum(amount_usdc), 0) as total
    from public.withdrawals
    where user_id = p_user_id
      and created_at >= now() - interval '30 days'
      and status not in ('failed', 'reversed')
  )
  select
    (select daily  from transfers_sent) + (select total from withdrawals_daily)   as daily_total,
    (select weekly from transfers_sent_weekly) + (select total from withdrawals_weekly) as weekly_total,
    (select monthly from transfers_sent_monthly) + (select total from withdrawals_monthly) as monthly_total;
$$;

-- Grant to service role only (backend uses admin client)
revoke all on function public.get_user_transaction_totals(uuid) from public;
grant execute on function public.get_user_transaction_totals(uuid) to service_role;

-- ─── RPC: get_kyc_status_and_totals ────────────────────────────────────────
-- Combined query: returns KYC status + transaction totals in one round-trip.
-- Used by the KYC guard on every transaction to avoid N+1 DB calls.
create or replace function public.get_kyc_status_and_totals(
  p_user_id uuid
)
returns table (
  kyc_status    public.kyc_status,
  didit_session_id text,
  daily_total   numeric,
  weekly_total  numeric,
  monthly_total numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(k.status, 'not_started'::public.kyc_status) as kyc_status,
    k.didit_session_id,
    t.daily_total,
    t.weekly_total,
    t.monthly_total
  from (select p_user_id as uid) u
  left join public.kyc_verifications k on k.user_id = u.uid
  cross join lateral public.get_user_transaction_totals(u.uid) t;
$$;

revoke all on function public.get_kyc_status_and_totals(uuid) from public;
grant execute on function public.get_kyc_status_and_totals(uuid) to service_role;

-- =========================================
-- DONE
-- =========================================
