-- Bounding how often anyone may hit the endpoints that cost us something.
--
-- --- Why this is needed even after every route got a session ------------------
--
-- Requiring a session ended the ANONYMOUS case. It does not bound a patient signed-in caller,
-- and several of the things worth bounding are things a legitimate account can do:
--
--   * six-digit codes. An account can ask to verify one as often as it likes, and 10^6 is not
--     a large number when the attempts are free. The PIN has had a lockout since migration 041
--     precisely because four digits is indefensible without one; the email and authenticator
--     codes had nothing.
--   * somebody's inbox. `2fa/send` mails a code on request; unbounded, it is a way to make
--     Sendzz spam a user until they stop trusting our mail.
--   * our RPC and Circle quota, and our gas. The read routes and the sponsors are cheap per
--     call and unmetered in aggregate.
--   * the recipient lookup. It answers "does this email have a wallet", one address at a time,
--     which is enumeration given enough patience.
--
-- --- Fixed windows, in Postgres ----------------------------------------------
--
-- A fixed window is coarser than a sliding one: a caller can spend a full allowance at the end
-- of one window and another at the start of the next. That is a factor of two at the seam, and
-- it buys a counter that is one row, one statement, and impossible to get subtly wrong.
--
-- Postgres rather than a cache because the limit must hold ACROSS serverless instances. An
-- in-memory counter resets on every cold start, so an attacker does not even have to try: the
-- platform clears it for them.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- What is being limited, and for whom: e.g. `2fa:verify:user:<uuid>` or `read:ip:1.2.3.4`.
  -- Composed by the caller, because only the caller knows which dimension matters.
  key           TEXT PRIMARY KEY,

  -- Start of the current window. When now() passes window_start + the caller's window, the
  -- count resets rather than the row being deleted — one row per key, reused forever.
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  count         INTEGER NOT NULL DEFAULT 0
);

-- The sweep below reads this.
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits (window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access" ON public.rate_limits;
CREATE POLICY "Service role has full access"
  ON public.rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same reasoning as migration 042: a client role that could write here could reset its own
-- counter, which is the same as having no limit at all.
REVOKE ALL ON public.rate_limits FROM anon;
REVOKE ALL ON public.rate_limits FROM authenticated;

/*
 * Spend one unit against a key, and say whether it was allowed.
 *
 * One statement, and that is the point. Read-then-write in application code leaves a window in
 * which several concurrent requests all see the same count and all proceed — which is exactly
 * the burst a limiter exists to stop, and exactly how a limiter comes to look like it works
 * while doing nothing.
 *
 * The INSERT ... ON CONFLICT does all three cases at once: a first request creates the row, a
 * request inside a live window increments it, and a request after the window has elapsed
 * resets it. `count` comes back so the caller can decide; the row is written either way, so a
 * refused attempt still counts against the window. That is deliberate — otherwise a caller who
 * is already over the limit gets unlimited free refusals, and the lockout never lengthens.
 */
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key       TEXT,
  p_limit     INTEGER,
  p_window_ms BIGINT
)
RETURNS TABLE (allowed BOOLEAN, used INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window INTERVAL := make_interval(secs => p_window_ms / 1000.0);
  v_row    public.rate_limits%ROWTYPE;
BEGIN
  INSERT INTO public.rate_limits AS rl (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE
    SET
      -- Elapsed window: start a fresh one at 1. Otherwise carry on counting.
      window_start = CASE
        WHEN rl.window_start + v_window <= now() THEN now()
        ELSE rl.window_start
      END,
      count = CASE
        WHEN rl.window_start + v_window <= now() THEN 1
        ELSE rl.count + 1
      END
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.count <= p_limit,
    v_row.count,
    v_row.window_start + v_window;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.rate_limits IS
  'Fixed-window counters, one row per key. Spent through consume_rate_limit(). Service-role access only.';
