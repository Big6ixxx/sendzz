-- 027: Provider-agnostic ledger (ADDITIVE — safe to run before the new code ships).
--
-- Adds a generic order reference + a JSONB metadata bag to withdrawals/deposits so the
-- ledger no longer depends on paycrest_*/bitnob_* columns. Nothing is dropped here — the
-- old columns stay populated (dual-write) until a later migration removes them AFTER the
-- new code is live in prod.

-- ── Generic columns ──────────────────────────────────────────────────────────
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.deposits    ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE public.deposits    ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── Backfill from the existing provider-specific columns ─────────────────────
UPDATE public.withdrawals
SET provider_order_id = paycrest_order_id
WHERE provider_order_id IS NULL AND paycrest_order_id IS NOT NULL;

UPDATE public.deposits
SET provider_order_id = paycrest_tx_id
WHERE provider_order_id IS NULL AND paycrest_tx_id IS NOT NULL;

-- Fold the Bitnob-specific columns into provider_metadata where present.
UPDATE public.withdrawals
SET provider_metadata = provider_metadata
  || jsonb_strip_nulls(jsonb_build_object(
       'quote_id', bitnob_quote_id,
       'deposit_address', bitnob_deposit_address,
       'network', source_chain
     ))
WHERE bitnob_quote_id IS NOT NULL OR bitnob_deposit_address IS NOT NULL OR source_chain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawals_provider_order_id ON public.withdrawals (provider_order_id);
CREATE INDEX IF NOT EXISTS idx_deposits_provider_order_id    ON public.deposits (provider_order_id);

-- ── RPCs: match provider_order_id OR paycrest_order_id (superset — non-breaking) ──
-- Param name kept as p_paycrest_order_id so existing callers don't change. Balance logic
-- is unchanged; only the lookup predicate is broadened.
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
     or paycrest_order_id = p_paycrest_order_id
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

  -- deduct locked balance permanently
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
     or paycrest_order_id = p_paycrest_order_id
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

  -- refund funds
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
