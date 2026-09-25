-- Referral earnings move from deposits to withdrawals, and from share-of-fee to share-of-volume.
--
-- --- Why the table is replaced rather than altered ---------------------------
--
-- Migration 054 recorded a share of our revenue on fiat DEPOSITS. Deposits are now free
-- (migration in the same series removed that fee), so the event it keyed on no longer earns
-- anything and every column describing it is meaningless. Replacing is honest where a rename
-- would leave columns whose names no longer match what they hold.
--
-- READ THIS BEFORE APPLYING. Migration 054 IS LIVE IN PRODUCTION — `referral_earnings`,
-- `referral_payouts` and the `users` referral columns all exist there. This file therefore
-- drops a table that really is present, and a DROP TABLE takes its rows with it silently:
-- nothing references `referral_earnings`, so there is no foreign key to raise an objection.
--
-- That is safe only because the table is empty. Confirmed empty on 2026-09-25, before this
-- was applied. If any time has passed since, confirm it again:
--
--     select count(*) from public.referral_earnings;
--     select count(*) from public.referral_payouts;
--
-- A non-zero count means somebody has accrued a commission under the deposit-based shape, and
-- this file must not run as written — those rows need archiving into the new table, or into a
-- table of their own, before anything is dropped. A commission that vanishes is not a schema
-- change, it is money somebody is owed.
--
-- --- Share of volume, not share of fee --------------------------------------
--
-- The referrer earns a FIXED PERCENTAGE OF WITHDRAWAL VOLUME, not a fixed share of the fee:
--
--   corridor at 0.5%  →  referrer gets 0.25% of volume  =  half the fee
--   corridor at 1.0%  →  referrer gets 0.25% of volume  =  a quarter of the fee
--
-- The rate stays put when a corridor is repriced. That is the point: corridor pricing is a
-- commercial decision about what the USER pays, and it must not silently reprice what we owe
-- our affiliates along with it.
--
-- The tier percentages people are quoted (20% / 35% / 50% of the fee) are translated into
-- volume rates ONCE, against a 0.5% reference corridor, in lib/referrals/tiers.ts. So "Gold
-- earns 50% of our fee" stays true on the standard corridor and the arithmetic stays stable
-- everywhere else.
--
-- --- Why every figure is stored ---------------------------------------------
--
-- A paid commission has to be explainable months later, to the affiliate asking why a number
-- is what it is. Recomputing from environment variables cannot do that: rates change, and the
-- explanation would silently change with them. So the row carries the volume, the tier and its
-- rate, the gross fee, the third-party cost, the net, what the rate produced, and what was
-- actually paid after the cap. Nothing about a past payout depends on present config.

-- ── Record what a withdrawal actually cost and earned ────────────────────────
--
-- These were only ever in `provider_metadata` as JSONB, which is awkward to aggregate and
-- impossible to index. The fee is now a first-class column because referral accrual, tier
-- rollups and revenue reporting all have to sum it.

ALTER TABLE public.withdrawals
  -- What we charged, in USDC. Our revenue on this withdrawal.
  ADD COLUMN IF NOT EXISTS platform_fee_usdc NUMERIC,
  -- What the payout provider deducts for this corridor, in USDC. A COST, not revenue — it is
  -- subtracted before a referrer's share is worked out, so a corridor that costs more to serve
  -- does not fund a commission out of margin that does not exist.
  ADD COLUMN IF NOT EXISTS corridor_fee_usdc NUMERIC;

COMMENT ON COLUMN public.withdrawals.platform_fee_usdc IS
  'Platform fee charged on this withdrawal, in USDC. Our gross revenue on it.';
COMMENT ON COLUMN public.withdrawals.corridor_fee_usdc IS
  'Flat provider cost for this corridor, in USDC. Subtracted from the fee to get net margin.';

-- Referral accrual sums a referee network''s withdrawals for the month, and the tier rollup
-- does the same over a wider window. Both filter on the owner and the date.
CREATE INDEX IF NOT EXISTS withdrawals_user_created_idx
  ON public.withdrawals (user_id, created_at DESC);

-- ── The earnings ledger, reshaped ────────────────────────────────────────────

DROP TABLE IF EXISTS public.referral_earnings;

CREATE TABLE public.referral_earnings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  referrer_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referee_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The withdrawal that earned it.
  --
  -- UNIQUE, and that is the whole idempotency story. A provider webhook fires more than once
  -- for the same payout — retries, redeliveries, the reconcile cron re-driving a settlement —
  -- and without this one withdrawal could pay a commission two or three times. Accrual is an
  -- upsert that ignores conflicts, so a repeat is a no-op rather than an error that would fail
  -- the webhook it rode in on.
  withdrawal_id      UUID NOT NULL UNIQUE REFERENCES public.withdrawals(id) ON DELETE CASCADE,

  -- What the referee withdrew. The figure the rate is applied to.
  volume_usdc        NUMERIC NOT NULL CHECK (volume_usdc >= 0),

  -- The referrer''s tier WHEN THIS HAPPENED, and the volume rate that tier carries.
  --
  -- Frozen at the moment of the withdrawal rather than recomputed at month end. A referrer who
  -- reaches Gold mid-month earns Gold on what follows, not retroactively on what came before.
  -- The alternative makes every row provisional until the month closes, which would mean no
  -- payout could be made until then — and continuous payout is the entire point of the
  -- programme. It also keeps each row a fact rather than an estimate.
  tier               TEXT NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold')),
  tier_rate_percent  NUMERIC NOT NULL CHECK (tier_rate_percent >= 0 AND tier_rate_percent <= 100),

  -- The economics of this specific withdrawal, as they were.
  gross_fee_usdc     NUMERIC NOT NULL CHECK (gross_fee_usdc >= 0),
  corridor_cost_usdc NUMERIC NOT NULL DEFAULT 0 CHECK (corridor_cost_usdc >= 0),
  net_fee_usdc       NUMERIC NOT NULL,

  -- What the tier rate produced, before the safety cap.
  uncapped_usdc      NUMERIC NOT NULL CHECK (uncapped_usdc >= 0),
  -- True when the cap bound, i.e. the rate would have paid out more than the withdrawal
  -- actually earned. Stored rather than inferred so "why is this smaller than 0.25%?" has an
  -- answer that does not require re-deriving the arithmetic.
  capped             BOOLEAN NOT NULL DEFAULT false,

  -- What is actually owed: min(uncapped, cap).
  amount_usdc        NUMERIC NOT NULL CHECK (amount_usdc >= 0),

  --   accrued — owed, not yet sent
  --   paid    — included in a completed payout
  --   void    — reversed, because the withdrawal itself failed or was refunded
  status             TEXT NOT NULL DEFAULT 'accrued'
                     CHECK (status IN ('accrued', 'paid', 'void')),

  payout_id          UUID,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sweep asks exactly this: who is owed, and how much.
CREATE INDEX IF NOT EXISTS referral_earnings_payable_idx
  ON public.referral_earnings (referrer_id)
  WHERE status = 'accrued';

CREATE INDEX IF NOT EXISTS referral_earnings_referrer_idx
  ON public.referral_earnings (referrer_id, created_at DESC);

ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access" ON public.referral_earnings;
CREATE POLICY "Service role has full access"
  ON public.referral_earnings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same reasoning as migration 042: this table decides who gets paid, so a client role that
-- could write a row — or flip one from 'paid' back to 'accrued' — could pay itself.
REVOKE ALL ON public.referral_earnings FROM anon;
REVOKE ALL ON public.referral_earnings FROM authenticated;

COMMENT ON TABLE public.referral_earnings IS
  'One immutable row per qualifying withdrawal: the volume, the tier rate applied, the economics at the time, and what was owed. Service-role access only.';
