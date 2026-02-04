-- =========================================
-- AUTH OTP TABLE
-- =========================================
-- Stores OTP codes for custom email authentication

create table if not exists public.auth_otp (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Index for fast lookup by email
create index if not exists idx_auth_otp_email on public.auth_otp(email);
create index if not exists idx_auth_otp_expires on public.auth_otp(expires_at);

-- Clean up old OTPs (can be run via cron)
create or replace function public.cleanup_expired_otps()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.auth_otp
  where expires_at < now() or used = true;
  
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- RLS: Only service role can access this table
alter table public.auth_otp enable row level security;

-- No policies = only service role (bypasses RLS) can access
-- This is intentional for security

-- Revoke all access from public and authenticated
revoke all on public.auth_otp from public;
revoke all on public.auth_otp from authenticated;

-- Grant to service role only (implicitly has access via RLS bypass)
