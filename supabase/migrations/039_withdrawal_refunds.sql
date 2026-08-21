-- Refunding a withdrawal whose money already left the user's wallet.
--
-- Until now `finalize_withdrawal_failed` claimed to refund by crediting `public.balances`. That
-- is a leftover from a custodial design: the table has no rows, nothing reads it, and the real
-- balance is read from chain. So the "refund" updated nothing while the audit log recorded
-- `withdrawal_failed_refunded` — which is why a user could be left without their USDC and
-- without anyone noticing.
--
-- Two states have to be told apart, and only the second owes anybody anything:
--
--   * failed BEFORE the deposit  (tx_hash is null) — the user still holds their USDC. Nothing
--     to refund; `failed` is the whole truth.
--   * failed AFTER the deposit   (tx_hash is set)  — the USDC is gone from their wallet and no
--     payout was made. We owe it back, and the row must say so until we have paid it.
--
-- `reversed` is the settled state, matching what Paycrest already reports and what the admin
-- UI, explore page and status badges already render.

alter table public.withdrawals
  add column if not exists refund_owed_usdc numeric,
  add column if not exists refund_tx_hash   text,
  add column if not exists refunded_at      timestamptz;

comment on column public.withdrawals.refund_owed_usdc is
  'USDC owed back to the user: set only when a withdrawal failed after their deposit landed. Null means nothing is owed.';
comment on column public.withdrawals.refund_tx_hash is
  'On-chain hash of the refund transfer. Null means the debt is still outstanding.';

-- A single on-chain transfer can only ever settle ONE refund. This is the double-spend guard:
-- replaying the same hash against a second withdrawal fails at the database, not in review.
create unique index if not exists withdrawals_refund_tx_hash_key
  on public.withdrawals (refund_tx_hash)
  where refund_tx_hash is not null;

-- Outstanding debts, newest first — what an operator and the alerting job both read.
create index if not exists withdrawals_refund_outstanding_idx
  on public.withdrawals (created_at desc)
  where refund_owed_usdc is not null and refund_tx_hash is null;


-- ── Failing a withdrawal, honestly ──────────────────────────────────────────
--
-- Same signature as before so every existing caller keeps working. What changes is that it now
-- records whether money is actually owed, and stops asserting a refund that never happened.
create or replace function public.finalize_withdrawal_failed(
  p_paycrest_order_id text,
  p_reason text default null::text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_withdrawal public.withdrawals%rowtype;
  v_owed numeric;
  v_fee numeric;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where provider_order_id = p_paycrest_order_id
     or paycrest_order_id = p_paycrest_order_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found for order %', p_paycrest_order_id;
  end if;

  if v_withdrawal.status in ('failed', 'reversed') then
    return true; -- idempotent
  end if;

  if v_withdrawal.status <> 'processing' then
    raise exception 'Withdrawal not in processing state';
  end if;

  -- Did the user's money actually leave? `tx_hash` is the only proof of that, and on a shared
  -- deposit address it is the only thing tying their transfer to this withdrawal at all.
  if v_withdrawal.tx_hash is not null then
    -- Everything that left the wallet, not just the payout: the platform fee was taken for a
    -- service that was never delivered, so it is owed back too.
    v_fee := coalesce((v_withdrawal.provider_metadata ->> 'fee_usdc')::numeric, 0);
    v_owed := coalesce(v_withdrawal.amount_usdc, 0) + v_fee;
  end if;

  update public.withdrawals
  set
    status = 'failed',
    refund_owed_usdc = v_owed,
    updated_at = now()
  where id = v_withdrawal.id;

  perform public.insert_audit_log(
    v_withdrawal.user_id,
    case when v_owed is not null
      then 'withdrawal_failed_refund_owed'
      else 'withdrawal_failed'
    end,
    jsonb_build_object(
      'withdrawal_id', v_withdrawal.id,
      'order_id', p_paycrest_order_id,
      'provider', v_withdrawal.provider,
      'amount_usdc', v_withdrawal.amount_usdc,
      'refund_owed_usdc', v_owed,
      'tx_hash', v_withdrawal.tx_hash,
      'reason', p_reason
    )
  );

  return true;
end;
$function$;


-- ── Settling the debt ───────────────────────────────────────────────────────
--
-- Called once the refund transfer is confirmed on chain. Returns false rather than raising when
-- the debt is already settled, so a retrying caller cannot pay twice.
create or replace function public.finalize_withdrawal_refunded(
  p_withdrawal_id uuid,
  p_refund_tx_hash text,
  p_amount_usdc numeric default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  if p_refund_tx_hash is null or length(trim(p_refund_tx_hash)) = 0 then
    raise exception 'A refund must record the transfer that paid it';
  end if;

  select *
  into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found: %', p_withdrawal_id;
  end if;

  -- Already paid. Not an error — a retry, a replayed webhook, two operators clicking at once.
  -- The row lock above means only one caller can be here at a time, so this is the guard that
  -- makes paying twice impossible rather than merely unlikely.
  if v_withdrawal.refund_tx_hash is not null then
    return false;
  end if;

  update public.withdrawals
  set
    status = 'reversed',
    refund_tx_hash = p_refund_tx_hash,
    refunded_at = now(),
    refund_owed_usdc = coalesce(p_amount_usdc, refund_owed_usdc),
    updated_at = now()
  where id = v_withdrawal.id;

  perform public.insert_audit_log(
    v_withdrawal.user_id,
    'withdrawal_refunded',
    jsonb_build_object(
      'withdrawal_id', v_withdrawal.id,
      'order_id', v_withdrawal.provider_order_id,
      'provider', v_withdrawal.provider,
      'refund_tx_hash', p_refund_tx_hash,
      'refund_amount_usdc', coalesce(p_amount_usdc, v_withdrawal.refund_owed_usdc),
      'original_tx_hash', v_withdrawal.tx_hash
    )
  );

  return true;
end;
$function$;

grant execute on function public.finalize_withdrawal_refunded(uuid, text, numeric) to service_role;
