-- =========================================
-- Migration 018: Universal Escrow
-- =========================================
-- Changes ALL transfers to use pending_claim regardless of whether the
-- recipient has a Sendzz account. Funds stay locked until the recipient
-- explicitly accepts. Senders can reclaim after the 7-day window.
--
-- Adds accept_transfer() RPC for existing authenticated users to accept
-- a pending incoming payment from their dashboard (no token required).
-- New users without accounts continue to use the token-based /claim flow.
-- =========================================


-- =========================================
-- 1. Update create_transfer_and_lock_balance
--    Always use pending_claim — remove the instant-completion path.
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

  -- Claim token is always required (status will always be pending_claim)
  if p_claim_token_hash is null then
    raise exception 'Claim token hash is required';
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
  -- recipient_id is stored so accept_transfer() can validate ownership
  select id
  into v_recipient_id
  from public.user_profiles
  where lower(email) = lower(p_recipient_email)
  limit 1;

  -- Deduct sender available balance, move to locked balance
  update public.balances
  set
    available_balance = available_balance - p_amount,
    locked_balance    = locked_balance + p_amount,
    updated_at        = now()
  where user_id = p_sender_id;

  -- Insert transfer — always pending_claim regardless of recipient existence
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
    v_recipient_id,          -- may be null for unknown emails
    p_recipient_email,
    p_amount,
    'pending_claim'::public.transfer_status,  -- always pending, never instant
    p_note,
    p_claim_token_hash,
    p_expires_at
  )
  returning id into v_transfer_id;

  -- Always log as pending_claim regardless of recipient existence
  perform public.insert_audit_log(
    p_sender_id,
    'transfer_sent_pending_claim',
    jsonb_build_object(
      'transfer_id',     v_transfer_id,
      'recipient_email', p_recipient_email,
      'recipient_id',    v_recipient_id,
      'amount',          p_amount
    )
  );

  return v_transfer_id;
end;
$$;


-- =========================================
-- 2. accept_transfer
--    Used by existing authenticated users to accept a pending payment
--    from their dashboard. No claim token needed — auth validates identity.
-- =========================================

create or replace function public.accept_transfer(
  p_transfer_id  uuid,
  p_recipient_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.transfers%rowtype;
begin
  -- Lock the transfer row for this operation
  select *
  into v_transfer
  from public.transfers
  where id = p_transfer_id
  for update;

  if v_transfer.id is null then
    raise exception 'Transfer not found';
  end if;

  if v_transfer.status <> 'pending_claim' then
    raise exception 'Transfer is not pending (status: %)', v_transfer.status;
  end if;

  if v_transfer.expires_at is not null and v_transfer.expires_at < now() then
    raise exception 'Transfer has expired';
  end if;

  -- Verify the caller is the intended recipient
  -- recipient_id is set at creation time for known users
  if v_transfer.recipient_id is distinct from p_recipient_id then
    raise exception 'Unauthorized: you are not the intended recipient of this transfer';
  end if;

  -- Credit recipient balance (upsert in case row somehow missing)
  insert into public.balances (user_id, asset, available_balance, locked_balance)
    values (p_recipient_id, v_transfer.asset, v_transfer.amount, 0)
  on conflict (user_id, asset) do update
    set available_balance = public.balances.available_balance + v_transfer.amount,
        updated_at        = now();

  -- Unlock sender locked funds
  update public.balances
  set
    locked_balance = greatest(0, locked_balance - v_transfer.amount),
    updated_at     = now()
  where user_id = v_transfer.sender_id;

  -- Mark transfer as completed
  update public.transfers
  set
    status     = 'completed',
    updated_at = now()
  where id = p_transfer_id;

  perform public.insert_audit_log(
    p_recipient_id,
    'transfer_accepted',
    jsonb_build_object(
      'transfer_id', p_transfer_id,
      'sender_id',   v_transfer.sender_id,
      'amount',      v_transfer.amount
    )
  );

  perform public.insert_audit_log(
    v_transfer.sender_id,
    'transfer_accepted_by_recipient',
    jsonb_build_object(
      'transfer_id',  p_transfer_id,
      'recipient_id', p_recipient_id,
      'amount',       v_transfer.amount
    )
  );
end;
$$;


-- Grants
grant execute on function public.create_transfer_and_lock_balance(uuid, text, numeric, text, text, timestamptz) to authenticated;
grant execute on function public.create_transfer_and_lock_balance(uuid, text, numeric, text, text, timestamptz) to service_role;
grant execute on function public.accept_transfer(uuid, uuid) to authenticated;
grant execute on function public.accept_transfer(uuid, uuid) to service_role;
