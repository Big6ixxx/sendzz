-- ========================================================
-- FIX FOREIGN KEYS FOR PRIVY AUTHENTICATION
-- ========================================================
-- This migration re-links the transaction tables to the 
-- public.users table (Privy) instead of auth.users.
-- ========================================================

-- 1. Fix Deposits Table
ALTER TABLE public.deposits DROP CONSTRAINT IF EXISTS deposits_user_id_fkey;
ALTER TABLE public.deposits 
  ADD CONSTRAINT deposits_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 2. Fix Withdrawals Table
ALTER TABLE public.withdrawals DROP CONSTRAINT IF EXISTS withdrawals_user_id_fkey;
ALTER TABLE public.withdrawals 
  ADD CONSTRAINT withdrawals_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 3. Fix Transfers Table (Sender)
ALTER TABLE public.transfers DROP CONSTRAINT IF EXISTS transfers_sender_id_fkey;
ALTER TABLE public.transfers 
  ADD CONSTRAINT transfers_sender_id_fkey 
  FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE RESTRICT;

-- 4. Fix Transfers Table (Recipient)
ALTER TABLE public.transfers DROP CONSTRAINT IF EXISTS transfers_recipient_id_fkey;
ALTER TABLE public.transfers 
  ADD CONSTRAINT transfers_recipient_id_fkey 
  FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE RESTRICT;

-- 5. Add missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_deposits_paycrest_tx_id ON public.deposits(paycrest_tx_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_paycrest_order_id ON public.withdrawals(paycrest_order_id);

-- 6. Fix Audit Logs
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE public.audit_logs 
  ADD CONSTRAINT audit_logs_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- 7. Fix OTP Logs
ALTER TABLE public.otp_logs DROP CONSTRAINT IF EXISTS otp_logs_user_id_fkey;
ALTER TABLE public.otp_logs 
  ADD CONSTRAINT otp_logs_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
