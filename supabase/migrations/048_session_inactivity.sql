-- Per-DEVICE sessions: a 24-hour inactivity logout, plus the ability to see and revoke devices.
--
-- The threat is a lost or stolen phone with a live session on it. Privy refreshes its token
-- silently for as long as the refresh token is valid, so without this a session found on a device
-- stays usable indefinitely.
--
-- --- Why per-device and not per-account -------------------------------------
--
-- An account-level `users.last_active_at` looks like it solves this and does not: the owner
-- carries on working from their laptop, every transaction refreshes the single shared clock, and
-- the thief's phone session is kept alive by the victim's own activity. The clock has to belong
-- to the session, so using the laptop extends the laptop and nothing else.
--
-- `session_id` comes from the Privy access token's claims. It is inside the signed JWT, so a
-- caller cannot invent one or borrow another device's: presenting it means holding a token Privy
-- issued for that session.
--
-- --- Why no triggers here ---------------------------------------------------
--
-- An earlier draft stamped activity from triggers on the transaction tables. That cannot work
-- per-device: a database trigger has no idea which session inserted the row. Stamping moves into
-- the request path, where the session is known -- see markSessionTransacted.
--
-- Only what the user INITIATED counts (a withdrawal, a bridge, a transfer sent, a fiat on-ramp
-- ordered). Receiving does not: an incoming transfer or an on-chain deposit arrives whether or
-- not the account holder is near their phone, and treating that as presence would let a
-- stranger's payment quietly extend a thief's session.

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The Privy session this row tracks. Unique: one row per device session.
  session_id     TEXT NOT NULL UNIQUE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Last transaction INITIATED from this device. Sign-in seeds it, so a new session always starts
  -- with a full window rather than being refused the moment it is created.
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Set when the user signs this device out from another one. Checked on every request, so
  -- revocation takes effect immediately rather than whenever a token happens to expire.
  revoked_at     TIMESTAMPTZ,

  -- `user_agent` names the device on the settings screen ("Pixel 8 Pro - Chrome") so someone can
  -- recognise their own. It is self-reported and trivially spoofed, so it must never be treated
  -- as identity -- it exists to help a human answer "is that me?", nothing more.
  --
  -- `ip` is recorded but never displayed: a raw address means nothing to most people, changes on
  -- its own, and is shared by every device on one wifi. It is kept only so "where did this
  -- session come from?" stays answerable when investigating a report of a lost phone.
  user_agent     TEXT,
  ip             TEXT
);

-- The settings screen lists a user's sessions, most recently used first.
CREATE INDEX IF NOT EXISTS user_sessions_user_idx
  ON public.user_sessions (user_id, last_active_at DESC);

-- --- One clock owns expiry ---------------------------------------------------
--
-- `last_active_at` is written here with Postgres `now()`, so the elapsed time has to be measured
-- with Postgres `now()` too. Reading the column into the application and subtracting its own
-- Date.now() compares two different machines' clocks: they are both ours and both roughly right,
-- but "roughly" is doing real work in a security control, and any drift silently lengthens or
-- shortens every session window.
--
-- So the database reports how long a session has been idle, and the application decides what the
-- limit is. Elapsed time comes from one clock; the policy stays in one place (SESSION_IDLE_LIMIT_MS).
--
-- `ip` is deliberately NOT exposed here: nothing reads it, and the narrower a view is, the less
-- a mistake with its grants can cost.
CREATE OR REPLACE VIEW public.user_sessions_state AS
  SELECT
    s.id,
    s.user_id,
    s.session_id,
    s.created_at,
    s.last_active_at,
    s.revoked_at,
    s.user_agent,
    EXTRACT(EPOCH FROM (now() - s.last_active_at)) AS idle_seconds
  FROM public.user_sessions s;

-- Extend a session using the same clock that created it. An UPDATE from the application would
-- carry the app server's timestamp instead, which is the mismatch this whole section exists to
-- remove.
CREATE OR REPLACE FUNCTION public.touch_user_session(p_session_id TEXT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.user_sessions
     SET last_active_at = now()
   WHERE session_id = p_session_id
     AND revoked_at IS NULL;
$$;

-- --- Lock the view and the function down ------------------------------------
--
-- The table is safe by accident of grants: `anon` has no privilege on it, so the permissive RLS
-- policy below never gets a chance to apply. Views and functions do NOT inherit that safety.
--
-- Verified against this database: `anon` CAN read views (public_transaction_feed returns rows to
-- the public key) and CAN execute functions (Postgres grants EXECUTE to PUBLIC by default). A
-- view also runs with its OWNER's privileges unless declared otherwise, so it reaches straight
-- past the base table's protection.
--
-- Left alone, that would publish every user's session id, device and user_id to anyone holding
-- the public anon key, and let anyone call touch_user_session to keep a session alive forever.
-- Both are reached only by the service role, which these revocations do not affect.
REVOKE ALL ON public.user_sessions_state FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_user_session(TEXT) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Reached only through the service role, like the rest of the schema.
DROP POLICY IF EXISTS "Service role has full access" ON public.user_sessions;
CREATE POLICY "Service role has full access"
  ON public.user_sessions FOR ALL USING (true) WITH CHECK (true);
