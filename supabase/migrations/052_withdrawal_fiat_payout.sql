-- Settling a withdrawal debt by paying the fiat, instead of reversing the USDC.
--
-- When a withdrawal fails after the user's deposit landed, migration 039 records what we owe.
-- Until now the only way to discharge that debt was `finalize_withdrawal_refunded` — send the
-- USDC back. But the user did not ask for USDC back; they asked for money in their bank. When
-- we can still reach that account, paying it is the outcome they wanted.
--
-- So there are now two ways to settle, and they are NOT interchangeable:
--
--   finalize_withdrawal_refunded    USDC returned to their wallet.  status -> 'reversed'
--   finalize_withdrawal_fiat_payout Fiat sent from our own bank.    status -> 'completed'
--
-- `completed` is deliberate and load-bearing. A manual payout delivered exactly what an
-- automatic one delivers, so it must be indistinguishable to the user: same status, same
-- history row, same receipt, same public feed, same KYC allowance consumption. Anything else
-- would be telling someone their money arrived differently because of how WE routed it.
--
-- --- The transaction hash does not change ------------------------------------
--
-- `tx_hash` is the on-chain leg where the user's USDC left their wallet. It is already set —
-- that is precisely how `finalize_withdrawal_failed` knew money was taken and a debt existed.
-- The fiat leg has no hash in the automatic flow either, because a bank transfer is not an
-- on-chain event. So this function does not touch `tx_hash`: it is already correct, and
-- inventing or clearing one would make the record less true, not more.
--
-- --- Why refund_owed_usdc is cleared -----------------------------------------
--
-- The debt is discharged, so the row must stop appearing in the outstanding-debt index. A
-- completed automatic withdrawal carries a null there, and "identical to automatic" is the
-- whole requirement. The trail lives in provider_metadata and the audit log instead, which are
-- operator-facing and do not leak into anything the user sees.

create or replace function public.finalize_withdrawal_fiat_payout(
  p_withdrawal_id uuid,
  p_admin_email   text default null,
  p_note          text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select *
  into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found: %', p_withdrawal_id;
  end if;

  -- Already settled one way or the other. False rather than an exception, so a retry, a double
  -- click or two operators acting at once cannot pay twice — the row lock above makes this the
  -- guard that decides it, not a race.
  if v_withdrawal.status = 'completed' or v_withdrawal.refund_tx_hash is not null then
    return false;
  end if;

  -- Only a recorded debt can be settled this way. A withdrawal that failed BEFORE the deposit
  -- owes nothing: the user still holds their USDC, and marking it completed would assert a
  -- payout for money we never received.
  if v_withdrawal.refund_owed_usdc is null then
    raise exception 'Withdrawal % owes nothing — nothing to pay out', p_withdrawal_id;
  end if;

  update public.withdrawals
  set
    status            = 'completed',
    refund_owed_usdc  = null,
    provider_metadata = coalesce(provider_metadata, '{}'::jsonb)
                        || jsonb_build_object(
                             'manual_fiat_payout',
                             jsonb_build_object(
                               'paid_by',    p_admin_email,
                               'paid_at',    now(),
                               'owed_usdc',  v_withdrawal.refund_owed_usdc,
                               'note',       p_note
                             )
                           ),
    updated_at        = now()
  where id = v_withdrawal.id;

  perform public.insert_audit_log(
    v_withdrawal.user_id,
    'withdrawal_manual_fiat_payout',
    jsonb_build_object(
      'withdrawal_id',   v_withdrawal.id,
      'order_id',        coalesce(v_withdrawal.provider_order_id, v_withdrawal.paycrest_order_id),
      'provider',        v_withdrawal.provider,
      'amount_usdc',     v_withdrawal.amount_usdc,
      'settled_usdc',    v_withdrawal.refund_owed_usdc,
      'fiat_amount',     v_withdrawal.fiat_amount,
      'fiat_currency',   v_withdrawal.fiat_currency,
      'tx_hash',         v_withdrawal.tx_hash,
      'paid_by',         p_admin_email,
      'note',            p_note
    )
  );

  return true;
end;
$function$;

grant execute on function public.finalize_withdrawal_fiat_payout(uuid, text, text) to service_role;
