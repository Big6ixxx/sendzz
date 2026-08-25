-- Bridges that happen INSIDE a withdrawal, held only until they are claimed.
--
-- A withdrawal that spans chains has to bridge before it can settle. Those bridges are not
-- transfers the user chose to make, so they must not appear in history or count towards any
-- total — recording them in `bridge_transactions` alongside real user bridges would inflate
-- every number we report.
--
-- But they cannot be forgotten either. The burn is irreversible, and a burn nobody knows about
-- is USDC that shows in no balance and on no claim screen. That is not hypothetical: a 10.71
-- USDC burn from Base to Stellar was lost exactly this way and had to be read back off chain.
--
-- So: a scratch row, written the moment the burn lands and DELETED as soon as the funds are
-- delivered. It exists only while something is owed. Nothing accumulates, nothing to exclude
-- from reports later, and the common case leaves no trace at all.

create table if not exists public.consolidation_claims (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  burn_tx_hash text not null unique,
  source_chain text not null,
  dest_chain   text not null,
  amount       numeric not null,
  created_at   timestamptz not null default now()
);

comment on table public.consolidation_claims is
  'Scratch space for un-delivered withdrawal-consolidation bridges. Rows are deleted on delivery and must never be treated as transaction history.';

create index if not exists consolidation_claims_user_idx
  on public.consolidation_claims (user_id, created_at desc);

-- Server-only. RLS with no policy for anon or authenticated denies them by default, and the
-- grants are revoked as well so no future policy can hand it out by accident. The service role
-- is exempt from both, which is the only way the app touches this table.
alter table public.consolidation_claims enable row level security;

revoke all on public.consolidation_claims from anon;
revoke all on public.consolidation_claims from authenticated;

-- Guarded so the whole file can be re-run safely; `create policy` alone errors if it exists.
drop policy if exists "service role manages consolidation claims" on public.consolidation_claims;
create policy "service role manages consolidation claims"
  on public.consolidation_claims
  for all
  to service_role
  using (true)
  with check (true);
