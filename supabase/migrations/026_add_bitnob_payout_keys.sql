-- 026: Store the Bitnob payout linking keys on withdrawals.
--
-- Bitnob's on-chain off-ramp needs a `finalize` call AFTER the USDC deposit lands. The
-- `deposit.success` webhook is keyed by the deposit ADDRESS (not our payout reference or
-- the quote_id), so we persist both the deposit address (to match the webhook) and the
-- quote_id (needed for the finalize path) against the withdrawal.

ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS bitnob_quote_id TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS bitnob_deposit_address TEXT;

CREATE INDEX IF NOT EXISTS idx_withdrawals_bitnob_deposit_address
  ON public.withdrawals (bitnob_deposit_address);
