-- =========================================
-- CONTACTS TABLE
-- =========================================
-- Stores user contacts for quick selection

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  name text not null,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Unique constraint: A user can't add the same email twice
create unique index if not exists idx_contacts_user_email on public.contacts(user_id, lower(email));

-- RLS
alter table public.contacts enable row level security;

-- Policies
create policy "Users can view their own contacts"
  on public.contacts for select
  using (auth.uid() = user_id);

create policy "Users can insert their own contacts"
  on public.contacts for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own contacts"
  on public.contacts for update
  using (auth.uid() = user_id);

create policy "Users can delete their own contacts"
  on public.contacts for delete
  using (auth.uid() = user_id);
