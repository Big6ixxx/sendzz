-- Track 1: the retail programme. Fee-free withdrawals for the referee, fee credits for the
-- referrer.
--
-- --- Why a referrer is on ONE programme, never both --------------------------
--
-- The two tracks pay for the same event and would stack. A Gold Merchant earns 0.25% of every
-- withdrawal; a retail referrer earns $2.00 in credits per referee who moves $100+. Both at
-- once on a $100 withdrawal is $2.00 of credit plus $0.25 of cash against a $0.50 fee — four
-- and a half times what we made on it, which is not a promotion, it is a loss per transaction
-- that grows with volume.
--
-- So `users.referral_program` picks one. Everyone starts on 'retail' because it costs no cash;
-- 'merchant' is granted deliberately (migration 058) and switches the same referrer from credits
-- to revenue share. Accrual reads this and takes exactly one branch.
--
-- --- Why benefits are a ledger, not two balance columns ----------------------
--
-- A balance column answers "how much?" and nothing else. When an affiliate asks why their
-- credit is $4 rather than $6, or a user asks why they were charged a fee they thought was
-- waived, the only useful answer is a list: granted here, spent there, released when that
-- withdrawal failed. Signed rows give that, and the balance is their sum — which cannot drift
-- from the history the way a separately-maintained counter does.

-- ── Which programme a referrer is on ─────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_program text NOT NULL DEFAULT 'retail';

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_referral_program_valid;
ALTER TABLE public.users
  ADD CONSTRAINT users_referral_program_valid
  CHECK (referral_program IN ('retail', 'merchant'));

COMMENT ON COLUMN public.users.referral_program IS
  'Which referral programme this user earns under as a REFERRER. retail = fee credits, merchant = revenue share. Never both — see migration 057.';

-- ── The benefits ledger ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referral_benefits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Two kinds, in two different units, which is why they are never summed together:
  --
  --   waiver_volume — USDC of WITHDRAWAL VOLUME that carries no fee. Granted to a referee on
  --                   sign-up ("your first $200 is fee-free"). Measured in volume because
  --                   that is what the promise is about; the fee it saves depends on the
  --                   corridor, and the promise should not.
  --   fee_credit    — USDC of FEE that is written off. Granted to a retail referrer when
  --                   someone they invited reaches a milestone. Measured in fee because it is
  --                   spent against one.
  kind          TEXT NOT NULL CHECK (kind IN ('waiver_volume', 'fee_credit')),

  -- Positive when granted, negative when used. The balance is the sum of active rows.
  delta_usdc    NUMERIC NOT NULL,

  -- The withdrawal that spent it, or that earned it. Null for a grant with no single
  -- withdrawal behind it, such as the sign-up waiver.
  withdrawal_id UUID REFERENCES public.withdrawals(id) ON DELETE SET NULL,

  -- Who this came from, for a grant earned through somebody else's activity.
  referee_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Human-readable origin: 'signup_waiver', 'referee_milestone', 'withdrawal'.
  source        TEXT NOT NULL,

  -- Idempotency for grants that must happen exactly once.
  --
  -- A milestone is crossed once per referee, but the check runs on every withdrawal they
  -- make, and a provider webhook can redeliver any of them. Without this, one referee could
  -- mint the milestone credit repeatedly. Null for spends, which are already keyed by the
  -- withdrawal that caused them.
  dedupe_key    TEXT UNIQUE,

  -- Voided when the withdrawal that spent it failed, which returns the balance. Grants are
  -- voided only if the activity behind them is reversed.
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every balance read is "this user, this kind, still active".
CREATE INDEX IF NOT EXISTS referral_benefits_balance_idx
  ON public.referral_benefits (user_id, kind)
  WHERE status = 'active';

-- Releasing what a failed withdrawal spent.
CREATE INDEX IF NOT EXISTS referral_benefits_withdrawal_idx
  ON public.referral_benefits (withdrawal_id)
  WHERE withdrawal_id IS NOT NULL;

ALTER TABLE public.referral_benefits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access" ON public.referral_benefits;
CREATE POLICY "Service role has full access"
  ON public.referral_benefits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same reasoning as migration 042. A client role that could insert here could grant itself
-- unlimited fee-free withdrawals, which is the same thing as granting itself money.
REVOKE ALL ON public.referral_benefits FROM anon;
REVOKE ALL ON public.referral_benefits FROM authenticated;

COMMENT ON TABLE public.referral_benefits IS
  'Signed ledger of referral fee waivers and fee credits. Balance is the sum of active rows. Service-role access only.';
