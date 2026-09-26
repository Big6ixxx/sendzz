-- Every account gets the `user_profiles` row it was always supposed to have.
--
-- --- How they went missing ---------------------------------------------------
--
-- Migration 001 creates the profile from a trigger on `auth.users`. Sendzz authenticates with
-- Privy and writes accounts straight into `public.users`, so nothing has inserted into
-- Supabase's auth schema since the day that trigger was written, and it has never fired.
--
-- Migration 022 papered over it once, by deleting every profile and rebuilding the set from
-- `public.users`. That fixed the accounts existing at the time and did nothing for any account
-- created afterwards. Since then a profile has appeared only by accident — `emailPrefs` upserts
-- one as a side effect of saving notification preferences, so whether an account had a profile
-- came down to whether its owner had ever opened that screen.
--
-- --- Why it mattered ---------------------------------------------------------
--
-- `user_profiles` holds `pin_hash`, `totp_secret` and the passkey list. No row means nowhere to
-- put a transaction PIN. And the endpoint that stored one wrote through an UPDATE keyed on
-- email — which, against no row, is a statement that changes nothing and reports no error. So
-- the user was told their PIN was saved, and then could not authorise a single payment: every
-- transaction asked for a PIN that had never been stored.
--
-- --- What this does ----------------------------------------------------------
--
-- Inserts the missing rows and nothing else. Unlike migration 022 it does NOT delete first:
-- that was safe when profiles held preferences and is not safe now that they hold credentials.
-- Deleting and rebuilding would silently strip every PIN, TOTP secret and passkey on the
-- system.
--
-- The defaults match what 022 used, so a backfilled row is indistinguishable from one it made.

INSERT INTO public.user_profiles (id, email, onboarding_completed, two_fa_enabled, two_fa_threshold)
SELECT u.id, lower(btrim(u.email)), true, false, 500
FROM public.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = u.id)
  -- `email` is UNIQUE on this table, and since migration 063 unique case-insensitively too.
  -- An account whose address is already spoken for by some other profile row is a data
  -- problem this migration must not mask by failing halfway through the rest.
  AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles p2
    WHERE lower(btrim(p2.email)) = lower(btrim(u.email))
  )
ON CONFLICT (id) DO NOTHING;

-- Anything still missing afterwards is one of those collisions, and wants looking at by hand
-- rather than being left to surface as somebody unable to set a PIN.
DO $$
DECLARE
  orphans bigint;
BEGIN
  SELECT count(*) INTO orphans
  FROM public.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = u.id);

  IF orphans > 0 THEN
    RAISE WARNING
      '% account(s) still have no user_profiles row — their email collides with an existing profile. Investigate before they try to set a PIN.',
      orphans;
  END IF;
END;
$$;
