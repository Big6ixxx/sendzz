-- Becoming a Merchant: an application somebody reviews, not a threshold somebody trips.
--
-- --- Why not automatic promotion ---------------------------------------------
--
-- Volume alone is the wrong signal, in both directions.
--
-- Upwards: the Merchant track pays real cash out of the treasury, where the retail track only
-- discounts our own margin. Anything that moves a referrer onto it should be a decision, not
-- an arithmetic accident — and the people worth having on it are hand-picked community
-- leaders and agency operators, not whoever happened to cross a number.
--
-- Downwards, and less obviously: promotion is a DOWNGRADE at low volume. A retail referrer
-- earns $2 of fee credit per referee who withdraws $100. The same person as a Bronze Merchant
-- earns 0.10% of their network's volume — on $2,000 a month, $2. So auto-promoting at $2k
-- would silently move somebody onto a programme paying the same or less, in a form they
-- cannot spend as freely. Applying makes that a choice they have made.
--
-- --- Lifecycle ---------------------------------------------------------------
--
--   pending   — submitted, waiting on a human
--   approved  — users.referral_program flipped to 'merchant'
--   rejected  — declined, with a reason they are shown
--
-- The application is the record of WHY somebody is on the track, which is the question asked
-- when a payout is queried months later. It is kept after approval rather than consumed.

CREATE TABLE IF NOT EXISTS public.merchant_applications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One live application per user.
  --
  -- A partial unique index rather than a plain one: somebody rejected in March should be able
  -- to apply again in June with more to show, and a constraint across all rows would refuse
  -- that forever. Only pending and approved rows are exclusive.
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- What they told us, in their own words. Free text on purpose: the useful signal here is
  -- "I run a 400-person freelancer Slack in Lagos", which no dropdown would have captured.
  organisation   TEXT,
  audience       TEXT,
  expected_monthly_volume_usdc NUMERIC,
  notes          TEXT,

  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),

  -- Shown to the applicant when declined, so a rejection is actionable rather than a wall.
  decision_note  TEXT,
  -- The admin email that decided, for the audit trail. Not a foreign key: admins live in
  -- platform_admins keyed by email, and an admin leaving must not erase who approved what.
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_applications_one_open_idx
  ON public.merchant_applications (user_id)
  WHERE status IN ('pending', 'approved');

-- The admin queue reads oldest-pending-first.
CREATE INDEX IF NOT EXISTS merchant_applications_queue_idx
  ON public.merchant_applications (created_at)
  WHERE status = 'pending';

ALTER TABLE public.merchant_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access" ON public.merchant_applications;
CREATE POLICY "Service role has full access"
  ON public.merchant_applications FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same reasoning as migration 042. A client role that could write `status` here could approve
-- itself onto the track that pays cash.
REVOKE ALL ON public.merchant_applications FROM anon;
REVOKE ALL ON public.merchant_applications FROM authenticated;

COMMENT ON TABLE public.merchant_applications IS
  'Applications to the Merchant referral track (cash revenue share). Reviewed by an admin; approval flips users.referral_program. Service-role access only.';
