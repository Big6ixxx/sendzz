-- Make the protection explicit instead of incidental.
--
-- --- What the audit actually found -------------------------------------------
--
-- Every table carries RLS with a policy of the form `FOR ALL USING (true)`. Read literally
-- that says "anyone may do anything", and the only reason it is not true is that `anon` and
-- `authenticated` hold no privileges on those tables — so no policy is ever consulted.
--
-- That is correct today and fragile forever. The safety lives in the ABSENCE of a grant, which
-- is invisible: nothing in the migrations says "this table is protected", and a single
-- `GRANT SELECT` issued from the dashboard to debug something would quietly make a table
-- world-readable while its policy still reads as deliberate. Ten tables had no revoke recorded
-- anywhere — balances, bank_contacts, contacts, kyc_verifications, platform_admins,
-- user_sessions and others — protected only by that absence.
--
-- Views are worse, and are the reason #18 is separate from #17. A view runs with its OWNER's
-- privileges, so a view over a protected table hands out exactly what the table refuses, and
-- Postgres grants views to PUBLIC by default. The same is true of functions.
--
-- --- What this does ----------------------------------------------------------
--
-- States the rule, for everything in `public`, in one place: client roles hold nothing, and
-- the service role holds what the application needs. Written as loops over the catalogue
-- rather than a list of names, so an object added next year is covered by the rule rather
-- than by somebody remembering to add a line.
--
-- This is defence in depth, not a fix for a live hole. The audit separately verified that the
-- anon key cannot currently read users, transfers, profiles, withdrawals or deposits.

-- ── Tables ───────────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.tablename);
    -- Every read and write in this application goes through the service role, which is
    -- exempt from RLS and needs the privilege explicitly rather than by inheritance.
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r.tablename);
  END LOOP;
END
$$;

-- ── Views ────────────────────────────────────────────────────────────────────
--
-- `public_transaction_feed` backs the public explorer, which might suggest it should be
-- readable by `anon`. It should not: the explorer is served by our own code through the
-- service role (lib/supabase/public-stats.ts), so the view never needs to be reachable with
-- the public key — and leaving it reachable would publish columns the feed's own query is
-- careful to filter.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r.table_name);
  END LOOP;
END
$$;

-- ── Functions ────────────────────────────────────────────────────────────────
--
-- Postgres grants EXECUTE on a new function to PUBLIC. Most of these are SECURITY DEFINER —
-- they run as the owner precisely so they can touch protected tables — which makes a default
-- grant the most direct way to hand a client exactly what every policy above refuses.
--
-- Trigger functions are included and unaffected: a trigger executes as part of the statement
-- that fired it, not as a call the client makes, so it does not consult EXECUTE at all.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

-- ── And for anything added later ─────────────────────────────────────────────
--
-- The loops above cover what exists now. These defaults cover what does not yet, so the next
-- table or function is protected on creation rather than when somebody notices.
--
-- Applies to objects created by the role running this migration. If migrations are ever
-- applied as a different role, repeat this for that role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

COMMENT ON SCHEMA public IS
  'Client roles (anon, authenticated) hold no privileges here. All access is through the service role in application code, which is why the permissive RLS policies are never consulted. See migration 061.';
