create or replace function claim_transfer_atomic(
  p_transfer_id uuid,
  p_claimant_id uuid
)
returns numeric
language plpgsql
security definer
as $$
declare
  v_transfer record;
  v_amount numeric;
begin
  -- Lock transfer row
  select * into v_transfer
  from public.transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'Transfer not found';
  end if;

  if v_transfer.status <> 'pending_claim' then
    raise exception 'Transfer is not pending claim';
  end if;

  v_amount := v_transfer.amount;

  -- Update transfer
  update public.transfers
  set 
    status = 'completed',
    recipient_id = p_claimant_id,
    claim_token_hash = null,
    updated_at = now()
  where id = p_transfer_id;

  -- Credit balance
  update public.balances
  set 
    available_balance = available_balance + v_amount,
    updated_at = now()
  where user_id = p_claimant_id;
  
  if not found then
    raise exception 'User balance record not found';
  end if;

  return v_amount;
end;
$$;
