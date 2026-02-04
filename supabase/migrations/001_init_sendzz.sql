-- =========================================
-- SENDZZ SUPABASE MIGRATION (Schema + RLS)
-- =========================================

-- Enable useful extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- =========================================
-- ENUMS
-- =========================================

do $$ begin
  create type public.asset_type as enum ('USDC');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.transfer_status as enum (
    'pending_claim',
    'claimed',
    'completed',
    'cancelled',
    'expired'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.deposit_status as enum (
    'pending',
    'confirmed',
    'failed',
    'reversed'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.withdrawal_status as enum (
    'awaiting_verification',
    'processing',
    'completed',
    'failed',
    'reversed'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.withdrawal_verification_status as enum (
    'pending',
    'verified',
    'expired'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.webhook_provider as enum (
    'paycrest'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.otp_purpose as enum (
    'login',
    'withdrawal_verification'
  );
exception
  when duplicate_object then null;
end $$;

-- =========================================
-- TABLE: user_profiles
-- =========================================

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  paycrest_customer_id text,
  paycrest_wallet_id text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_email on public.user_profiles(email);

-- =========================================
-- TABLE: balances
-- =========================================

create table if not exists public.balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  asset public.asset_type not null default 'USDC',
  available_balance numeric(20, 8) not null default 0,
  locked_balance numeric(20, 8) not null default 0,
  updated_at timestamptz not null default now(),

  constraint balances_non_negative check (
    available_balance >= 0 and locked_balance >= 0
  )
);

create index if not exists idx_balances_user_id on public.balances(user_id);

-- =========================================
-- TABLE: transfers
-- =========================================

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),

  sender_id uuid not null references auth.users(id) on delete restrict,
  recipient_id uuid references auth.users(id) on delete restrict,

  recipient_email text not null,
  amount numeric(20, 8) not null,
  asset public.asset_type not null default 'USDC',

  status public.transfer_status not null default 'pending_claim',

  note text,

  -- NEVER store raw claim tokens, only hash
  claim_token_hash text,
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transfer_amount_positive check (amount > 0),
  constraint claim_token_required_for_pending check (
    (status <> 'pending_claim')
    OR (claim_token_hash is not null)
  )
);

create index if not exists idx_transfers_sender_id on public.transfers(sender_id);
create index if not exists idx_transfers_recipient_id on public.transfers(recipient_id);
create index if not exists idx_transfers_recipient_email on public.transfers(recipient_email);
create index if not exists idx_transfers_claim_token_hash on public.transfers(claim_token_hash);

-- =========================================
-- TABLE: deposits
-- =========================================

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  paycrest_tx_id text unique,

  amount_fiat numeric(20, 8),
  currency_fiat text,

  amount_usdc numeric(20, 8),
  status public.deposit_status not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deposit_amount_valid check (
    (amount_fiat is null or amount_fiat > 0)
    and
    (amount_usdc is null or amount_usdc > 0)
  )
);

create index if not exists idx_deposits_user_id on public.deposits(user_id);
create index if not exists idx_deposits_paycrest_tx_id on public.deposits(paycrest_tx_id);

-- =========================================
-- TABLE: withdrawals
-- =========================================

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  paycrest_order_id text unique,

  amount_usdc numeric(20, 8) not null,
  fiat_currency text not null,
  institution_code text not null,

  -- store only masked bank info (e.g. ****1234)
  bank_account_masked text not null,

  status public.withdrawal_status not null default 'awaiting_verification',
  verification_status public.withdrawal_verification_status not null default 'pending',

  verification_token_hash text,
  verification_expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint withdrawal_amount_positive check (amount_usdc > 0),
  constraint withdrawal_verification_required check (
    verification_status <> 'pending'
    OR verification_token_hash is not null
  )
);

create index if not exists idx_withdrawals_user_id on public.withdrawals(user_id);
create index if not exists idx_withdrawals_paycrest_order_id on public.withdrawals(paycrest_order_id);
create index if not exists idx_withdrawals_verification_token_hash on public.withdrawals(verification_token_hash);

-- =========================================
-- TABLE: otp_logs
-- =========================================

create table if not exists public.otp_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,

  purpose public.otp_purpose not null,
  success boolean not null default false,

  ip text,
  user_agent text,

  created_at timestamptz not null default now()
);

create index if not exists idx_otp_logs_email on public.otp_logs(email);
create index if not exists idx_otp_logs_user_id on public.otp_logs(user_id);

-- =========================================
-- TABLE: audit_logs
-- =========================================

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references auth.users(id) on delete set null,
  action text not null,

  metadata_json jsonb not null default '{}'::jsonb,

  ip text,
  user_agent text,

  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_user_id on public.audit_logs(user_id);
create index if not exists idx_audit_logs_action on public.audit_logs(action);

-- =========================================
-- TABLE: webhook_events
-- =========================================

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),

  provider public.webhook_provider not null default 'paycrest',
  event_id text not null,

  payload_json jsonb not null,
  processed boolean not null default false,

  created_at timestamptz not null default now(),

  constraint webhook_event_unique unique (provider, event_id)
);

create index if not exists idx_webhook_events_processed on public.webhook_events(processed);

-- =========================================
-- TRIGGERS: updated_at auto update
-- =========================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_transfers_updated_at on public.transfers;
create trigger trg_transfers_updated_at
before update on public.transfers
for each row execute function public.set_updated_at();

drop trigger if exists trg_deposits_updated_at on public.deposits;
create trigger trg_deposits_updated_at
before update on public.deposits
for each row execute function public.set_updated_at();

drop trigger if exists trg_withdrawals_updated_at on public.withdrawals;
create trigger trg_withdrawals_updated_at
before update on public.withdrawals
for each row execute function public.set_updated_at();

-- =========================================
-- AUTO CREATE PROFILE + BALANCE ON SIGNUP
-- =========================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.balances (user_id, asset, available_balance, locked_balance)
  values (new.id, 'USDC', 0, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =========================================
-- ENABLE ROW LEVEL SECURITY (RLS)
-- =========================================

alter table public.user_profiles enable row level security;
alter table public.balances enable row level security;
alter table public.transfers enable row level security;
alter table public.deposits enable row level security;
alter table public.withdrawals enable row level security;
alter table public.otp_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.webhook_events enable row level security;

-- =========================================
-- RLS POLICIES
-- =========================================

-- -----------------------------------------
-- user_profiles
-- -----------------------------------------

drop policy if exists "Users can view own profile" on public.user_profiles;
create policy "Users can view own profile"
on public.user_profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile"
on public.user_profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- -----------------------------------------
-- balances
-- -----------------------------------------

drop policy if exists "Users can view own balance" on public.balances;
create policy "Users can view own balance"
on public.balances
for select
to authenticated
using (auth.uid() = user_id);

-- balances should only be modified by backend/service-role logic,
-- not directly by client.
drop policy if exists "No direct balance updates by users" on public.balances;
create policy "No direct balance updates by users"
on public.balances
for update
to authenticated
using (false);

drop policy if exists "No direct balance inserts by users" on public.balances;
create policy "No direct balance inserts by users"
on public.balances
for insert
to authenticated
with check (false);

-- -----------------------------------------
-- transfers
-- -----------------------------------------

drop policy if exists "Users can view transfers they are involved in" on public.transfers;
create policy "Users can view transfers they are involved in"
on public.transfers
for select
to authenticated
using (
  auth.uid() = sender_id
  OR auth.uid() = recipient_id
);

drop policy if exists "Users can create outgoing transfers" on public.transfers;
create policy "Users can create outgoing transfers"
on public.transfers
for insert
to authenticated
with check (
  auth.uid() = sender_id
);

drop policy if exists "Users can update their outgoing transfers (limited)" on public.transfers;
create policy "Users can update their outgoing transfers (limited)"
on public.transfers
for update
to authenticated
using (auth.uid() = sender_id)
with check (auth.uid() = sender_id);

-- Note: claiming should be done by backend service role.
-- We still allow recipient to view after claim.

-- -----------------------------------------
-- deposits
-- -----------------------------------------

drop policy if exists "Users can view own deposits" on public.deposits;
create policy "Users can view own deposits"
on public.deposits
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create deposit records" on public.deposits;
create policy "Users can create deposit records"
on public.deposits
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users cannot update deposits directly" on public.deposits;
create policy "Users cannot update deposits directly"
on public.deposits
for update
to authenticated
using (false);

-- -----------------------------------------
-- withdrawals
-- -----------------------------------------

drop policy if exists "Users can view own withdrawals" on public.withdrawals;
create policy "Users can view own withdrawals"
on public.withdrawals
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create withdrawal requests" on public.withdrawals;
create policy "Users can create withdrawal requests"
on public.withdrawals
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users cannot update withdrawals directly" on public.withdrawals;
create policy "Users cannot update withdrawals directly"
on public.withdrawals
for update
to authenticated
using (false);

-- -----------------------------------------
-- otp_logs
-- -----------------------------------------

-- OTP logs should never be readable by normal users
drop policy if exists "No OTP log reads by users" on public.otp_logs;
create policy "No OTP log reads by users"
on public.otp_logs
for select
to authenticated
using (false);

-- allow insert (backend or client) if desired
drop policy if exists "Allow OTP logs insert" on public.otp_logs;
create policy "Allow OTP logs insert"
on public.otp_logs
for insert
to authenticated
with check (true);

-- -----------------------------------------
-- audit_logs
-- -----------------------------------------

-- Audit logs must not be readable by normal users
drop policy if exists "No audit log reads by users" on public.audit_logs;
create policy "No audit log reads by users"
on public.audit_logs
for select
to authenticated
using (false);

-- allow insert (backend only recommended)
drop policy if exists "Allow audit logs insert" on public.audit_logs;
create policy "Allow audit logs insert"
on public.audit_logs
for insert
to authenticated
with check (true);

-- -----------------------------------------
-- webhook_events
-- -----------------------------------------

-- webhook events should never be accessible from client
drop policy if exists "No webhook events access for users" on public.webhook_events;
create policy "No webhook events access for users"
on public.webhook_events
for all
to authenticated
using (false)
with check (false);

-- =========================================
-- OPTIONAL: SERVICE ROLE ACCESS (recommended)
-- =========================================
-- Supabase service_role bypasses RLS automatically.
-- Ensure backend uses SUPABASE_SERVICE_ROLE_KEY for:
-- - webhook processing
-- - claiming transfers
-- - updating balances
-- - updating withdrawal statuses

-- =========================================
-- DONE
-- =========================================
