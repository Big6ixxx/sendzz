-- Paying people for bringing other people.
--
-- --- What a referrer earns, and why not the obvious thing --------------------
--
-- A share of OUR REVENUE on the referee's fiat deposits, not a share of the deposits.
--
-- The obvious reading — "a fraction of what they deposit" — does not survive contact with how
-- deposits work here. An on-chain deposit is USDC arriving at an address: it costs the sender
-- nothing but gas, earns Sendzz nothing, and can be repeated all day. Paying a percentage of
-- it would mean paying real money, out of our own pocket, to anyone willing to move the same
-- balance in and out in a loop. There is no amount of monitoring that makes that shape safe.
--
-- Fiat on-ramps are different: Paycrest skims a partner fee for us on every one, so there is
-- genuine revenue to share. Sharing revenue cannot be farmed at a loss, because the payout is
-- by construction a fraction of something we were paid first.
--
-- The consequence, stated plainly so nobody is surprised later: on-chain deposits accrue
-- nothing. They earn us nothing, so they pay nothing.
--
-- --- Why the earnings are a ledger, and not a number on the user row ---------
--
-- `referral_earnings` keeps one immutable row per qualifying deposit, holding the figures AS
-- THEY WERE at the time: the revenue it was calculated from, and the percentage applied.
-- Recomputing later from environment variables would silently restate history the first time
-- a rate changes — every past payout would start disagreeing with the row that explains it.
-- A balance is then the sum of rows, which is a number somebody can audit.

-- ── Attribution ──────────────────────────────────────────────────────────────

ALTER TABLE public.users
  -- The code this user hands out. Null until they open the referrals screen, so we are not
  -- minting codes for accounts that will never share one.
  ADD COLUMN IF NOT EXISTS referral_code text,
  -- Who brought them. Set once, on first sign-in, and never again — see the trigger below.
  ADD COLUMN IF NOT EXISTS referred_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referred_at   timestamptz;

-- Codes are matched case-insensitively (people retype them from messages and screenshots), so
-- uniqueness has to be case-insensitive too. A plain UNIQUE would happily accept "ADA7" and
-- "ada7" as different codes and then hand a referral to whichever one the lookup found first.
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uniq
  ON public.users (lower(referral_code))
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_referred_by_idx
  ON public.users (referred_by)
  WHERE referred_by IS NOT NULL;

-- Nobody refers themselves. Cheap to try, and free money if it worked.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_no_self_referral;
ALTER TABLE public.users
  ADD CONSTRAINT users_no_self_referral CHECK (referred_by IS DISTINCT FROM id);

/*
 * Attribution is write-once, enforced here rather than in application code.
 *
 * The application sets `referred_by` on first sign-in and never touches it again — but "never
 * again" is a property of one code path today, and this column decides who gets paid. A single
 * future endpoint that updates a user row carelessly would be enough to let an established
 * account be re-attributed to a new referrer, retroactively redirecting every future payout.
 *
 * The database is the only place that rule cannot be forgotten.
 */
CREATE OR REPLACE FUNCTION public.freeze_referral_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.referred_by IS NOT NULL AND NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'referred_by is write-once and cannot be changed after it is set';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_freeze_referral_attribution ON public.users;
CREATE TRIGGER users_freeze_referral_attribution
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_referral_attribution();

-- ── Earnings ledger ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referral_earnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  referrer_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referee_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The deposit that earned it.
  --
  -- UNIQUE, and that is the entire idempotency story. A provider webhook can fire more than
  -- once for the same order — retries, redeliveries, our own reconcile cron re-driving a
  -- settlement — and without this a single deposit could be paid out two or three times. The
  -- accrual is an upsert that ignores conflicts, so the second delivery is a no-op rather than
  -- an error that fails the webhook it rode in on.
  deposit_id    UUID NOT NULL UNIQUE REFERENCES public.deposits(id) ON DELETE CASCADE,

  -- Our revenue on that deposit, in USDC. The thing a share is taken OF.
  basis_usdc    NUMERIC NOT NULL CHECK (basis_usdc >= 0),
  -- The share applied, stored rather than looked up, so the row still explains itself after
  -- the rate changes.
  percent       NUMERIC NOT NULL CHECK (percent >= 0 AND percent <= 100),
  -- basis_usdc * percent / 100, at the time.
  amount_usdc   NUMERIC NOT NULL CHECK (amount_usdc >= 0),

  --   accrued — owed, not yet sent
  --   paid    — included in a completed payout
  --   void    — reversed, because the deposit itself was reversed or refunded
  status        TEXT NOT NULL DEFAULT 'accrued'
                CHECK (status IN ('accrued', 'paid', 'void')),

  payout_id     UUID,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sweep asks exactly this: who is owed, and how much.
CREATE INDEX IF NOT EXISTS referral_earnings_payable_idx
  ON public.referral_earnings (referrer_id)
  WHERE status = 'accrued';

CREATE INDEX IF NOT EXISTS referral_earnings_referrer_idx
  ON public.referral_earnings (referrer_id, created_at DESC);

-- ── Payouts ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referral_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  referrer_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The sum of the earnings rows this payout settles.
  amount_usdc   NUMERIC NOT NULL CHECK (amount_usdc > 0),
  -- Where it was sent, and on which network.
  destination   TEXT NOT NULL,
  chain         TEXT NOT NULL,

  --   pending — rows claimed, transfer not yet confirmed
  --   paid    — on-chain and confirmed
  --   failed  — did not go through; the earnings are released back to `accrued`
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid', 'failed')),

  -- Circle's own id for the transfer, known the moment the request is accepted. This is what
  -- a payout can be chased by while it is in flight, and it is NOT a transaction hash — a
  -- block explorer does not know it.
  provider_tx_id TEXT,

  -- The on-chain hash, which only exists once the transfer is mined. Null until then, and the
  -- UI links to an explorer only when it is present. Storing Circle's id in a column named
  -- `tx_hash` would have produced confident links to pages that do not exist.
  tx_hash       TEXT,

  -- Why it failed, for the operator reading this table at 3am rather than for the user.
  error         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_payouts_referrer_idx
  ON public.referral_payouts (referrer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS referral_payouts_pending_idx
  ON public.referral_payouts (status)
  WHERE status = 'pending';

ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_payouts  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access" ON public.referral_earnings;
CREATE POLICY "Service role has full access"
  ON public.referral_earnings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role has full access" ON public.referral_payouts;
CREATE POLICY "Service role has full access"
  ON public.referral_payouts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same reasoning as migration 042. These tables decide who gets paid, so a client role that
-- could write a row — or flip one from 'paid' back to 'accrued' — could pay itself. Without a
-- grant, no policy can let anyone in, and nothing in the app needs one.
REVOKE ALL ON public.referral_earnings FROM anon;
REVOKE ALL ON public.referral_earnings FROM authenticated;
REVOKE ALL ON public.referral_payouts  FROM anon;
REVOKE ALL ON public.referral_payouts  FROM authenticated;

COMMENT ON TABLE public.referral_earnings IS
  'One immutable row per qualifying deposit: our revenue, the share applied, and what it came to. Service-role access only.';
COMMENT ON TABLE public.referral_payouts IS
  'Batched USDC sweeps of accrued referral earnings. Service-role access only.';
