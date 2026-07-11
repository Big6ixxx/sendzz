-- 029: FINAL post-rollout drop of the legacy paycrest_* columns.
--
-- ⚠️ DO NOT RUN THIS UNTIL BOTH ARE TRUE:
--   1. The provider-agnostic code (migrations 025 + 027) has been live in prod and stable —
--      you are no longer going to roll back to a build that reads paycrest_order_id /
--      paycrest_tx_id.
--   2. You have deployed the "phase 2" code change that STOPS dual-writing those columns:
--        • lib/supabase/transactions.ts → recordDeposit  baseRow: remove `paycrest_tx_id`
--        • lib/supabase/transactions.ts → recordWithdrawal baseRow: remove `paycrest_order_id`
--        • types/database.ts: drop paycrest_tx_id / paycrest_order_id from deposits/withdrawals
--      If the deployed code still inserts those columns, INSERTs will fail after this drop.
--
-- What it does:
--   • Rewrites the finalize RPCs to match ONLY provider_order_id (drops the transitional
--     `OR paycrest_order_id` predicate). The param name stays `p_paycrest_order_id` so the
--     webhook/cron/polling callers don't need to change (rename is optional cosmetics).
--   • Drops the now-unused paycrest_* columns.
--
-- Order matters: recreate the RPCs (which reference paycrest_order_id) BEFORE dropping the
-- column, so the function bodies never point at a missing column.

-- ── 1. RPCs now match provider_order_id only ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_withdrawal_success(p_paycrest_order_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where provider_order_id = p_paycrest_order_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found for order %', p_paycrest_order_id;
  end if;

  if v_withdrawal.status = 'completed' then
    return true; -- idempotent
  end if;

  if v_withdrawal.status <> 'processing' then
    raise exception 'Withdrawal not in processing state';
  end if;

  update public.balances
  set
    locked_balance = locked_balance - v_withdrawal.amount_usdc,
    updated_at = now()
  where user_id = v_withdrawal.user_id;

  update public.withdrawals
  set
    status = 'completed',
    updated_at = now()
  where id = v_withdrawal.id;

  perform public.insert_audit_log(
    v_withdrawal.user_id,
    'withdrawal_completed',
    jsonb_build_object(
      'withdrawal_id', v_withdrawal.id,
      'order_id', p_paycrest_order_id,
      'provider', v_withdrawal.provider,
      'amount_usdc', v_withdrawal.amount_usdc
    )
  );

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_withdrawal_failed(p_paycrest_order_id text, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where provider_order_id = p_paycrest_order_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found for order %', p_paycrest_order_id;
  end if;

  if v_withdrawal.status = 'failed' then
    return true; -- idempotent
  end if;

  if v_withdrawal.status <> 'processing' then
    raise exception 'Withdrawal not in processing state';
  end if;

  update public.balances
  set
    available_balance = available_balance + v_withdrawal.amount_usdc,
    locked_balance = locked_balance - v_withdrawal.amount_usdc,
    updated_at = now()
  where user_id = v_withdrawal.user_id;

  update public.withdrawals
  set
    status = 'failed',
    updated_at = now()
  where id = v_withdrawal.id;

  perform public.insert_audit_log(
    v_withdrawal.user_id,
    'withdrawal_failed_refunded',
    jsonb_build_object(
      'withdrawal_id', v_withdrawal.id,
      'order_id', p_paycrest_order_id,
      'provider', v_withdrawal.provider,
      'amount_usdc', v_withdrawal.amount_usdc,
      'reason', p_reason
    )
  );

  return true;
end;
$function$;

-- ── 2. Drop the legacy provider-specific columns ─────────────────────────────
DROP INDEX IF EXISTS public.idx_withdrawals_paycrest_order_id;
ALTER TABLE public.withdrawals DROP COLUMN IF EXISTS paycrest_order_id;
ALTER TABLE public.deposits    DROP COLUMN IF EXISTS paycrest_tx_id;
