-- When each kind of operational alert was last sent.
--
-- --- Why this exists --------------------------------------------------------
--
-- Alerts about a CONDITION rather than an EVENT repeat. A refund owed is an event: it happens
-- once, one email is sent, done. "The referral payout wallet is running low" is a condition —
-- it stays true until somebody tops the wallet up, and the job that notices it runs hourly.
-- Without a record of what was already sent, an admin gets the same email every hour until
-- they act, which is precisely how people learn to filter alerts into a folder they never
-- open. An alert that is ignored is worse than no alert, because it looks like coverage.
--
-- One row per alert key, holding the last time it went out. A cooldown then turns a standing
-- condition into an occasional reminder.
--
-- --- Why a table and not an in-process timer --------------------------------
--
-- These jobs run as serverless invocations. A module-level timestamp lives exactly as long as
-- one invocation, so every run would start out believing nothing had ever been sent. The state
-- has to outlive the process that reads it.

CREATE TABLE IF NOT EXISTS public.ops_alert_log (
  -- A stable identifier for the condition, e.g. 'referral_payout_treasury_low'. Callers own
  -- the naming; this table does not care what the alert means.
  key          TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access" ON public.ops_alert_log;
CREATE POLICY "Service role has full access"
  ON public.ops_alert_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same reasoning as migration 042: a client role that could write here could silence an alert.
REVOKE ALL ON public.ops_alert_log FROM anon;
REVOKE ALL ON public.ops_alert_log FROM authenticated;

COMMENT ON TABLE public.ops_alert_log IS
  'Cooldown state for repeating operational alerts, so a standing condition does not email admins on every cron run. Service-role access only.';
