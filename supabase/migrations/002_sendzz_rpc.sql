-- =========================================
-- SENDZZ RPC FUNCTIONS (Atomic Money Ops)
-- =========================================

create extension if not exists "pgcrypto";

-- =========================================
-- Helper: audit log insert
-- =========================================
create or replace function public.insert_audit_log(
  p_user_id uuid,
  p_action text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(user_id, action, metadata_json)
  values (p_user_id, p_action, p_metadata);
end;
$$;


-- =========================================
-- RPC: create_transfer_and_lock_balance
-- =========================================
-- Creates transfer row and locks sender funds atomically.
-- If recipient exists, it can optionally credit recipient immediately.
--
-- IMPORTANT:
-- - claim token must already be hashed (SHA256) before passing.
-- - raw token is never stored.
-- =========================================

create or replace function public.create_transfer_and_lock_balance(
  p_sender_id uuid,
  p_recipient_email text,
  p_amount numeric,
  p_note text default null,
  p_claim_token_hash text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_balance numeric;
  v_transfer_id uuid;
  v_recipient_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  -- Lock sender balance row to prevent race conditions
  select available_balance
  into v_sender_balance
  from public.balances
  where user_id = p_sender_id
  for update;

  if v_sender_balance is null then
    raise exception 'Sender balance row not found';
  end if;

  if v_sender_balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  -- Try to find recipient by email (case-insensitive)
  select id
  into v_recipient_id
  from public.user_profiles
  where lower(email) = lower(p_recipient_email)
  limit 1;

  -- Deduct sender available balance, move to locked balance
  update public.balances
  set
    available_balance = available_balance - p_amount,
    locked_balance = locked_balance + p_amount,
    updated_at = now()
  where user_id = p_sender_id;

  -- Insert transfer
  insert into public.transfers (
    sender_id,
    recipient_id,
    recipient_email,
    amount,
    status,
    note,
    claim_token_hash,
    expires_at
  )
  values (
    p_sender_id,
    v_recipient_id,
    p_recipient_email,
    p_amount,
    case
      when v_recipient_id is null then 'pending_claim'::public.transfer_status
      else 'completed'::public.transfer_status
    end,
    p_note,
    p_claim_token_hash,
    p_expires_at
  )
  returning id into v_transfer_id;

  -- If recipient exists, immediately credit recipient
  if v_recipient_id is not null then
    update public.balances
    set
      available_balance = available_balance + p_amount,
      updated_at = now()
    where user_id = v_recipient_id;

    -- Unlock sender locked funds since transfer is completed internally
    update public.balances
    set
      locked_balance = locked_balance - p_amount,
      updated_at = now()
    where user_id = p_sender_id;

    perform public.insert_audit_log(
      p_sender_id,
      'transfer_sent_completed',
      jsonb_build_object(
        'transfer_id', v_transfer_id,
        'recipient_id', v_recipient_id,
        'recipient_email', p_recipient_email,
        'amount', p_amount
      )
    );

    perform public.insert_audit_log(
      v_recipient_id,
      'transfer_received',
      jsonb_build_object(
        'transfer_id', v_transfer_id,
        'sender_id', p_sender_id,
        'amount', p_amount
      )
    );
  else
    perform public.insert_audit_log(
      p_sender_id,
      'transfer_sent_pending_claim',
      jsonb_build_object(
        'transfer_id', v_transfer_id,
        'recipient_email', p_recipient_email,
        'amount', p_amount
      )
    );
  end if;

  return v_transfer_id;
end;
$$;


-- =========================================
-- RPC: claim_transfer
-- =========================================
-- Claims a pending transfer using claim_token_hash.
-- Credits recipient balance and unlocks sender locked balance.
-- Token is invalidated after claim.
-- =========================================

create or replace function public.claim_transfer(
  p_recipient_id uuid,
  p_claim_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.transfers%rowtype;
begin
  if p_claim_token_hash is null or length(p_claim_token_hash) < 10 then
    raise exception 'Invalid claim token';
  end if;

  -- Lock the transfer row
  select *
  into v_transfer
  from public.transfers
  where claim_token_hash = p_claim_token_hash
  for update;

  if v_transfer.id is null then
    raise exception 'Transfer not found';
  end if;

  if v_transfer.status <> 'pending_claim' then
    raise exception 'Transfer is not claimable';
  end if;

  if v_transfer.expires_at is not null and v_transfer.expires_at < now() then
    update public.transfers
    set status = 'expired'
    where id = v_transfer.id;

    -- Return funds back to sender (unlock)
    update public.balances
    set
      available_balance = available_balance + v_transfer.amount,
      locked_balance = locked_balance - v_transfer.amount,
      updated_at = now()
    where user_id = v_transfer.sender_id;

    raise exception 'Transfer expired';
  end if;

  -- Assign recipient and mark claimed/completed
  update public.transfers
  set
    recipient_id = p_recipient_id,
    status = 'claimed',
    claim_token_hash = null, -- invalidate token
    updated_at = now()
  where id = v_transfer.id;

  -- Credit recipient
  update public.balances
  set
    available_balance = available_balance + v_transfer.amount,
    updated_at = now()
  where user_id = p_recipient_id;

  -- Unlock sender funds
  update public.balances
  set
    locked_balance = locked_balance - v_transfer.amount,
    updated_at = now()
  where user_id = v_transfer.sender_id;

  -- Mark transfer completed after claim
  update public.transfers
  set
    status = 'completed',
    updated_at = now()
  where id = v_transfer.id;

  perform public.insert_audit_log(
    p_recipient_id,
    'transfer_claimed',
    jsonb_build_object(
      'transfer_id', v_transfer.id,
      'sender_id', v_transfer.sender_id,
      'amount', v_transfer.amount
    )
  );

  perform public.insert_audit_log(
    v_transfer.sender_id,
    'transfer_claimed_by_recipient',
    jsonb_build_object(
      'transfer_id', v_transfer.id,
      'recipient_id', p_recipient_id,
      'amount', v_transfer.amount
    )
  );

  return v_transfer.id;
end;
$$;


-- =========================================
-- RPC: expire_pending_transfers
-- =========================================
-- Runs as a scheduled job (cron) to expire transfers
-- and return locked funds back to sender.
-- =========================================

create or replace function public.expire_pending_transfers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_transfer record;
begin
  for v_transfer in
    select *
    from public.transfers
    where status = 'pending_claim'
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    -- Expire transfer
    update public.transfers
    set
      status = 'expired',
      claim_token_hash = null,
      updated_at = now()
    where id = v_transfer.id;

    -- Return funds to sender
    update public.balances
    set
      available_balance = available_balance + v_transfer.amount,
      locked_balance = locked_balance - v_transfer.amount,
      updated_at = now()
    where user_id = v_transfer.sender_id;

    perform public.insert_audit_log(
      v_transfer.sender_id,
      'transfer_expired_refunded',
      jsonb_build_object(
        'transfer_id', v_transfer.id,
        'amount', v_transfer.amount
      )
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- =========================================
-- RPC: create_withdrawal_and_lock_balance
-- =========================================
-- Creates a withdrawal request and locks user funds.
-- Verification token must be hashed before passing.
-- Status remains awaiting_verification.
-- =========================================

create or replace function public.create_withdrawal_and_lock_balance(
  p_user_id uuid,
  p_amount_usdc numeric,
  p_fiat_currency text,
  p_institution_code text,
  p_bank_account_masked text,
  p_verification_token_hash text,
  p_verification_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_withdrawal_id uuid;
begin
  if p_amount_usdc <= 0 then
    raise exception 'Withdrawal amount must be greater than 0';
  end if;

  if p_verification_token_hash is null then
    raise exception 'Verification token hash is required';
  end if;

  if p_verification_expires_at is null then
    raise exception 'Verification expiry required';
  end if;

  -- Lock user balance row
  select available_balance
  into v_balance
  from public.balances
  where user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'Balance row not found';
  end if;

  if v_balance < p_amount_usdc then
    raise exception 'Insufficient balance';
  end if;

  -- Lock funds
  update public.balances
  set
    available_balance = available_balance - p_amount_usdc,
    locked_balance = locked_balance + p_amount_usdc,
    updated_at = now()
  where user_id = p_user_id;

  -- Create withdrawal record
  insert into public.withdrawals (
    user_id,
    amount_usdc,
    fiat_currency,
    institution_code,
    bank_account_masked,
    status,
    verification_status,
    verification_token_hash,
    verification_expires_at
  )
  values (
    p_user_id,
    p_amount_usdc,
    p_fiat_currency,
    p_institution_code,
    p_bank_account_masked,
    'awaiting_verification',
    'pending',
    p_verification_token_hash,
    p_verification_expires_at
  )
  returning id into v_withdrawal_id;

  perform public.insert_audit_log(
    p_user_id,
    'withdrawal_created_awaiting_verification',
    jsonb_build_object(
      'withdrawal_id', v_withdrawal_id,
      'amount_usdc', p_amount_usdc,
      'fiat_currency', p_fiat_currency,
      'institution_code', p_institution_code
    )
  );

  return v_withdrawal_id;
end;
$$;


-- =========================================
-- RPC: verify_withdrawal
-- =========================================
-- Verifies withdrawal using hashed verification token.
-- If valid, marks verification_status = verified.
-- Paycrest payout must be initiated AFTER this in backend.
-- =========================================

create or replace function public.verify_withdrawal(
  p_user_id uuid,
  p_withdrawal_id uuid,
  p_verification_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found';
  end if;

  if v_withdrawal.user_id <> p_user_id then
    raise exception 'Unauthorized';
  end if;

  if v_withdrawal.status <> 'awaiting_verification' then
    raise exception 'Withdrawal not in awaiting verification state';
  end if;

  if v_withdrawal.verification_status <> 'pending' then
    raise exception 'Withdrawal already verified or expired';
  end if;

  if v_withdrawal.verification_expires_at < now() then
    update public.withdrawals
    set verification_status = 'expired'
    where id = v_withdrawal.id;

    -- refund locked funds
    update public.balances
    set
      available_balance = available_balance + v_withdrawal.amount_usdc,
      locked_balance = locked_balance - v_withdrawal.amount_usdc,
      updated_at = now()
    where user_id = p_user_id;

    raise exception 'Verification expired';
  end if;

  if v_withdrawal.verification_token_hash <> p_verification_token_hash then
    raise exception 'Invalid verification token';
  end if;

  update public.withdrawals
  set
    verification_status = 'verified',
    verification_token_hash = null,
    verification_expires_at = null,
    updated_at = now()
  where id = v_withdrawal.id;

  perform public.insert_audit_log(
    p_user_id,
    'withdrawal_verified',
    jsonb_build_object(
      'withdrawal_id', v_withdrawal.id,
      'amount_usdc', v_withdrawal.amount_usdc
    )
  );

  return true;
end;
$$;


-- =========================================
-- RPC: mark_withdrawal_processing
-- =========================================
-- Called by backend after Paycrest order is created.
-- This stores paycrest_order_id and sets status=processing.
-- =========================================

create or replace function public.mark_withdrawal_processing(
  p_withdrawal_id uuid,
  p_paycrest_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found';
  end if;

  if v_withdrawal.verification_status <> 'verified' then
    raise exception 'Withdrawal not verified';
  end if;

  update public.withdrawals
  set
    paycrest_order_id = p_paycrest_order_id,
    status = 'processing',
    updated_at = now()
  where id = v_withdrawal.id;

  perform public.insert_audit_log(
    v_withdrawal.user_id,
    'withdrawal_processing_paycrest_order_created',
    jsonb_build_object(
      'withdrawal_id', v_withdrawal.id,
      'paycrest_order_id', p_paycrest_order_id
    )
  );

  return true;
end;
$$;


-- =========================================
-- RPC: finalize_withdrawal_success
-- =========================================
-- Called by webhook handler when Paycrest status=success.
-- Unlocks locked funds permanently (burn from locked).
-- =========================================

create or replace function public.finalize_withdrawal_success(
  p_paycrest_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where paycrest_order_id = p_paycrest_order_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found for Paycrest order';
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
      'paycrest_order_id', p_paycrest_order_id,
      'amount_usdc', v_withdrawal.amount_usdc
    )
  );

  return true;
end;
$$;


-- =========================================
-- RPC: finalize_withdrawal_failed
-- =========================================
-- Called by webhook handler when Paycrest status=failed.
-- Refunds locked funds back to available.
-- =========================================

create or replace function public.finalize_withdrawal_failed(
  p_paycrest_order_id text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where paycrest_order_id = p_paycrest_order_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found for Paycrest order';
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
      'paycrest_order_id', p_paycrest_order_id,
      'amount_usdc', v_withdrawal.amount_usdc,
      'reason', p_reason
    )
  );

  return true;
end;
$$;
