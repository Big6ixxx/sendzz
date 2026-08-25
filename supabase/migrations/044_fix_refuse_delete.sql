-- Fix `refuse_delete` so it reads columns that only exist on one of the tables it guards.
--
-- Migration 043 wrote the deposits exemption as `old.provider = 'onchain'`, guarded by
-- `tg_table_name = 'deposits'`. That guard does not help: PL/pgSQL resolves the field reference
-- against the record's actual type when the expression runs, and a `users` or `audit_logs` row
-- has no `provider` column. So deleting from any table other than `deposits` failed with
--
--     record "old" has no field "provider"   (42703)
--
-- rather than the intended message. Deletes were still refused — the statement aborted either
-- way, so nothing was ever at risk — but the reason given was wrong, and an operator hitting it
-- would reasonably think the protection was broken rather than working.
--
-- Reading through `to_jsonb(old)` instead sidesteps typing entirely: a missing key is null, so
-- the same expression is valid on every table. `freeze_core_columns` in 043 already does this;
-- this function simply should have too.

create or replace function public.refuse_delete()
returns trigger
language plpgsql
as $$
declare
  row_json jsonb := to_jsonb(old);
begin
  -- One exemption, and it is not history.
  --
  -- The chain scanner writes a `provider = 'onchain'` deposit as soon as it sees a transfer.
  -- When the ramp provider's own record for the same transfer arrives, that scanned row is a
  -- duplicate — and `deposits_user_tx_hash_uniq` (migration 035) forbids the pair, so the
  -- provider's update fails until the shadow goes. Removing it loses nothing: the surviving row
  -- describes the same movement and carries the fiat side as well.
  --
  -- Narrow on purpose: only an onchain row, and only while a different row already records the
  -- same transfer for the same user. A real deposit never satisfies both.
  if tg_table_name = 'deposits'
     and (row_json ->> 'provider') = 'onchain'
     and exists (
       select 1 from public.deposits d
       where d.user_id = (row_json ->> 'user_id')::uuid
         and d.tx_hash = (row_json ->> 'tx_hash')
         and d.id <> (row_json ->> 'id')::uuid
         and d.provider is distinct from 'onchain'
     )
  then
    return old;
  end if;

  raise exception
    'Deleting from % is not allowed. Financial history is append-only; mark the row instead.',
    tg_table_name
    using errcode = 'raise_exception';
end;
$$;
