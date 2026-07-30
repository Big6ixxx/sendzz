-- Migration: Create webauthn_challenges table
-- Replaces the in-memory Map used for WebAuthn challenge storage.
-- This is required for correctness on serverless deployments (Vercel, etc.)
-- where each request may hit a different function instance.

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge   TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('registration', 'authentication')),
  used        BOOLEAN     NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by email + type during verification
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_email_type
  ON webauthn_challenges (email, type);

-- Row Level Security: only service_role can access this table
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed — all access goes through supabaseAdmin (service role)
-- which bypasses RLS.

-- Auto-cleanup: delete expired or used challenges older than 10 minutes
-- (Supabase doesn't support pg_cron by default, but we handle cleanup in-app;
--  this partial index helps identify rows eligible for cleanup)
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires
  ON webauthn_challenges (expires_at)
  WHERE used = false;
