-- One-time: end every device session that exists right now.
--
-- ALREADY RUN on 14 Sep 2026. Kept as the record of what was done; re-running it would sign
-- everybody out again. The client half that accompanied it (hooks/useSessionEpoch.ts) has been
-- removed now that the sweep is complete — to repeat this later, restore that hook with a new
-- epoch value rather than running this file on its own, which on its own reaches only sessions
-- the app has already seen.
--
-- RUN THIS ONCE, AFTER the code is deployed — not before.
--
-- Order matters. Run before the deploy and you revoke rows that the old code does not check,
-- while users carry on; then the new code arrives and everyone is signed out at a random moment
-- instead of a chosen one. Run it after, and the sweep is immediate and deliberate.
--
-- --- What this does, and what it cannot do -----------------------------------
--
-- `resolveSession` checks `revoked_at` on every request, so a revoked row refuses that device on
-- its very next call. This is the ENFORCED half of the sign-out.
--
-- The other half is client-side: hooks/useSessionEpoch.ts calls Privy logout when it sees a new
-- epoch, which is what actually prompts people to sign in again. Privy's server SDK has no way
-- to terminate a session, so the backend alone cannot do it.
--
-- Neither half can touch a session this app has never seen — a device whose first-ever request
-- arrives after this runs has no row here to revoke, and `resolveSession` will create a fresh
-- one for it. That device is then governed by the 24-hour idle rule like any other.
--
-- Safe to re-run: revoking an already-revoked row changes nothing, and rows created afterwards
-- are untouched.

UPDATE public.user_sessions
   SET revoked_at = now()
 WHERE revoked_at IS NULL;

-- Confirm the sweep. Expect: zero live sessions immediately after running.
-- SELECT count(*) FILTER (WHERE revoked_at IS NULL) AS live,
--        count(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
--   FROM public.user_sessions;
