-- Accounts and transaction history cannot be deleted, and their facts cannot be rewritten.
--
-- Two separate protections, because RLS and grants only stop the CLIENT. Everything in this app
-- reaches the database as the service role, which is exempt from both — so the thing most likely
-- to erase a user's history is our own code, or someone with the service key running a query by
-- hand. A policy cannot help there. A trigger can, because it fires whoever the caller is.
--
-- What is protected:
--   users, user_profiles          — the account itself
--   transfers, deposits,
--   withdrawals, bridge_transactions — the money movements
--   audit_logs                    — the record of what happened and who did it
--
-- What is deliberately NOT frozen: status, timestamps, hashes that arrive late, reconciled fiat
-- amounts, refund bookkeeping. Those legitimately change as a payout progresses. Only the facts
-- that identify a record and state its size are locked.


-- ── Deletion: refused, always ───────────────────────────────────────────────
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
  -- duplicate of it — and `deposits_user_tx_hash_uniq` (migration 035) forbids the pair, so the
  -- provider's update fails until the shadow goes. Removing it loses nothing: the surviving row
  -- describes the same movement and carries the fiat side as well.
  --
  -- Narrow on purpose: only an onchain row, and only while a different row already records the
  -- same transfer for the same user. A real deposit never satisfies both.
  -- Read through `to_jsonb` rather than `old.provider`: this function guards seven tables and
  -- most have no `provider` column. PL/pgSQL resolves the field against the record's real type
  -- when the expression runs, so a direct reference fails on those tables even though the
  -- `tg_table_name` test above is false. A missing key in jsonb is simply null.
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

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'user_profiles', 'transfers', 'deposits',
    'withdrawals', 'bridge_transactions', 'audit_logs'
  ] loop
    execute format('drop trigger if exists no_delete on public.%I', t);
    execute format(
      'create trigger no_delete before delete on public.%I
       for each row execute function public.refuse_delete()', t);
  end loop;
end;
$$;


-- ── Mutation: identity and amount are set once ──────────────────────────────
--
-- A row may progress — pending to settled, a hash filled in once it is known — but the account
-- it belongs to, the amount it moved and when it was created are facts, not state. Changing one
-- after the fact is indistinguishable from falsifying the record.
create or replace function public.freeze_core_columns()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'The id of a % row cannot change.', tg_table_name;
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'The created_at of a % row cannot change.', tg_table_name;
  end if;

  -- Column names differ per table, so each is guarded only where it exists.
  if tg_table_name in ('deposits', 'withdrawals', 'bridge_transactions') then
    if to_jsonb(new) -> 'user_id' is distinct from to_jsonb(old) -> 'user_id' then
      raise exception 'A % row cannot be moved to another user.', tg_table_name;
    end if;
  end if;

  if tg_table_name in ('deposits', 'withdrawals') then
    if to_jsonb(new) -> 'amount_usdc' is distinct from to_jsonb(old) -> 'amount_usdc' then
      raise exception 'The amount of a % row cannot change once recorded.', tg_table_name;
    end if;
  end if;

  if tg_table_name in ('transfers', 'bridge_transactions') then
    if to_jsonb(new) -> 'amount' is distinct from to_jsonb(old) -> 'amount' then
      raise exception 'The amount of a % row cannot change once recorded.', tg_table_name;
    end if;
  end if;

  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'transfers', 'deposits', 'withdrawals', 'bridge_transactions'
  ] loop
    execute format('drop trigger if exists freeze_core on public.%I', t);
    execute format(
      'create trigger freeze_core before update on public.%I
       for each row execute function public.freeze_core_columns()', t);
  end loop;
end;
$$;


-- ── Audit logs are append-only in full ──────────────────────────────────────
--
-- An audit trail that can be edited is not an audit trail. Nothing in it may change at all.
create or replace function public.refuse_update()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only; existing rows cannot be modified.', tg_table_name
    using errcode = 'raise_exception';
end;
$$;

drop trigger if exists no_update on public.audit_logs;
create trigger no_update before update on public.audit_logs
  for each row execute function public.refuse_update();


-- ── A note on cascades ──────────────────────────────────────────────────────
--
-- Several tables cascade from `auth.users` and from `public.users`. Those cascades still exist,
-- but they can no longer take history with them: deleting an account now raises before any
-- child row is touched, so a cascade cannot quietly empty a user's transfers, deposits and
-- withdrawals as a side effect of removing one row. Closing an account is a status change, not
-- a delete — and if a real erasure is ever required by law, it has to be done deliberately by
-- dropping these triggers first, which is exactly the friction that was missing.


-- ── Client roles hold nothing on these tables ───────────────────────────────
-- Belt and braces alongside the triggers: no grant means no policy can hand access out later.
revoke all on public.users               from anon, authenticated;
revoke all on public.transfers           from anon, authenticated;
revoke all on public.deposits            from anon, authenticated;
revoke all on public.withdrawals         from anon, authenticated;
revoke all on public.bridge_transactions from anon, authenticated;
revoke all on public.audit_logs          from anon, authenticated;
