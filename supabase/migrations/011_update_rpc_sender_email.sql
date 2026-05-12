-- Update RPC to include sender_email
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
  v_sender_email text;
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

  -- Get sender email
  select email into v_sender_email from public.users where id = p_sender_id;

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
    sender_email,
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
    v_sender_email,
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
