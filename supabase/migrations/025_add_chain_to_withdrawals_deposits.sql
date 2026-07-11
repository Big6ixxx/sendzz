-- 025: Record which network each transaction touched, so transaction history can show
-- the source chain (and, for withdrawals, whether funds were bridged/consolidated first).
--
-- Also backfills every existing row to 'base' (the pre-multichain default — all prior
-- activity settled on Base), so historical transactions display a network instead of
-- "unknown".

-- ── Withdrawals ──────────────────────────────────────────────────────────────
-- source_chain: the Paycrest-supported chain the off-ramp settled from (base/polygon/ethereum).
-- consolidated: true when funds were spread across networks and auto-bridged onto
--               source_chain (CCTP) before the off-ramp.
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS source_chain TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS consolidated BOOLEAN NOT NULL DEFAULT false;

-- ── Deposits ─────────────────────────────────────────────────────────────────
-- network: the chain the purchased USDC was delivered to (the user's home chain).
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS network TEXT;

-- ── Ramp provider (which on/off-ramp provider created the order) ──────────────
-- Needed to route status lookups + webhooks to the right provider (bitnob | paycrest).
ALTER TABLE public.deposits    ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS provider TEXT;

-- Allow Bitnob webhooks to be logged (webhook_events.provider is an enum).
ALTER TYPE public.webhook_provider ADD VALUE IF NOT EXISTS 'bitnob';

-- ── Backfill existing rows ───────────────────────────────────────────────────
-- All activity before the multichain rollout settled on Base via Paycrest.
UPDATE public.transfers   SET source_chain = 'base' WHERE source_chain IS NULL;
UPDATE public.withdrawals SET source_chain = 'base' WHERE source_chain IS NULL;
UPDATE public.deposits    SET network      = 'base' WHERE network      IS NULL;
UPDATE public.deposits    SET provider     = 'paycrest' WHERE provider IS NULL;
UPDATE public.withdrawals SET provider     = 'paycrest' WHERE provider IS NULL;

-- NOTE: bridge_transactions already store their real source_chain/dest_chain — left untouched.