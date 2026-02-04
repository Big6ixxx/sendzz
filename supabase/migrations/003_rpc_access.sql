-- =========================================
-- FUNCTION ACCESS CONTROL
-- =========================================

-- Default: revoke all function execution from public
revoke all on function public.create_transfer_and_lock_balance(uuid, text, numeric, text, text, timestamptz) from public;
revoke all on function public.claim_transfer(uuid, text) from public;
revoke all on function public.expire_pending_transfers() from public;
revoke all on function public.create_withdrawal_and_lock_balance(uuid, numeric, text, text, text, text, timestamptz) from public;
revoke all on function public.verify_withdrawal(uuid, uuid, text) from public;
revoke all on function public.mark_withdrawal_processing(uuid, text) from public;
revoke all on function public.finalize_withdrawal_success(text) from public;
revoke all on function public.finalize_withdrawal_failed(text, text) from public;

-- Allow authenticated users to call safe user-initiated functions
grant execute on function public.create_transfer_and_lock_balance(uuid, text, numeric, text, text, timestamptz) to authenticated;
grant execute on function public.claim_transfer(uuid, text) to authenticated;
grant execute on function public.create_withdrawal_and_lock_balance(uuid, numeric, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.verify_withdrawal(uuid, uuid, text) to authenticated;

-- DO NOT allow authenticated users to call webhook/finalization functions
-- Those should be called only by backend with service role key (bypasses RLS anyway)
-- So no grant for:
-- - mark_withdrawal_processing
-- - finalize_withdrawal_success
-- - finalize_withdrawal_failed
-- - expire_pending_transfers
