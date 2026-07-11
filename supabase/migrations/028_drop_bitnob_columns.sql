-- 028: Drop the Bitnob-specific columns — provider data now lives in provider_metadata.
--
-- Safe: these columns were added this session (migration 026) and are NOT in production,
-- and migration 027 already folded their data into withdrawals.provider_metadata. All code
-- now reads provider_metadata->>'quote_id' / ->>'deposit_address' instead.
--
-- (The paycrest_* columns are still in prod, so they are dropped separately in the FINAL
-- post-rollout migration — not here.)

DROP INDEX IF EXISTS public.idx_withdrawals_bitnob_deposit_address;
ALTER TABLE public.withdrawals DROP COLUMN IF EXISTS bitnob_quote_id;
ALTER TABLE public.withdrawals DROP COLUMN IF EXISTS bitnob_deposit_address;
