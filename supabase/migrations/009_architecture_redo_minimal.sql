-- =========================================
-- SENDZZ ARCHITECTURE REDO (MINIMAL SCHEMA)
-- =========================================

-- Create the users table to map emails to Smart Account addresses
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  smart_account_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast identity lookups during transfers
create index if not exists idx_users_email on public.users(email);

-- Basic RLS (Optional as lib/supabase/actions.ts uses service_role, but good for security)
alter table public.users enable row level security;

-- Allow the service role to do everything
create policy "Service role has full access"
on public.users
for all
using (true)
with check (true);

-- Allow authenticated users to view their own record
create policy "Users can view own record"
on public.users
for select
to authenticated
using (email = auth.jwt() ->> 'email');

-- Trigger to update updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();
