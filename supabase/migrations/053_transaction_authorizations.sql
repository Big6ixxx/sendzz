-- Recovery for a PIN that is now mandatory.
--
-- Migration 019 created this enum with exactly the two actions that existed then. The PIN is
-- required on every outgoing transaction as of this migration, so forgetting it now means
-- losing access to your own funds — and no one, including us, can read a scrypt hash back.
-- Recovery therefore has to exist, and it goes through the account's own email.
--
-- Added as its own statement, and used only by application code in later transactions:
-- Postgres refuses to use a new enum value in the same transaction that added it.
ALTER TYPE transaction_otp_action ADD VALUE IF NOT EXISTS 'pin_reset';

-- Proof that a PIN was entered for ONE specific operation.
--
-- --- Why a token, and not just "the PIN was correct" --------------------------
--
-- A PIN check that only answers yes/no can be replayed. The browser asks "is 4821 right?",
-- gets a yes, and that yes is good for any amount to any recipient for as long as the page
-- lives. Worse, the answer is client-side: whatever the server said, it is the browser that
-- decides to go on and sign. So a bare check authorises nothing — it decorates.
--
-- A row here is minted by the server when the PIN is accepted, and it is bound to the exact
-- operation the user was shown:
--
--   * `payload_hash` — a digest of what the money is doing: purpose, destination, amount,
--     chain. The consuming code hashes the parameters it is ABOUT TO ACT ON and compares.
--     A token minted for "send 10 to alice" therefore cannot authorise "send 5000 to mallory",
--     because the two hash differently and the second is refused.
--   * `session_id` — the device session out of the signed Privy JWT. A token stolen from one
--     browser is useless in another, because the claim cannot be forged.
--   * `expires_at` — minutes, not hours. Long enough to sign, too short to sit around.
--   * `consumed_at` — spent exactly once. Set by a conditional UPDATE, so two concurrent
--     requests racing the same token produce one winner and one refusal, not two payments.
--
-- --- What it does not cover --------------------------------------------------
--
-- Be honest about the boundary. Sendzz signs EVM operations in the browser, against Circle's
-- bundler directly — there is no server in that path to refuse anything. For those, this table
-- is an AUDIT record: it says a PIN was entered, and it is written before signing, but a
-- determined holder of an open session could skip the call and sign anyway.
--
-- Where the server does mediate — Stellar sends, Stellar bridges, and fiat withdrawals, all of
-- which it broadcasts or books itself — consumption is mandatory and the operation is refused
-- without it. That is the difference between a gate and a note, and the two are deliberately
-- not described as the same thing anywhere in this codebase.

CREATE TABLE IF NOT EXISTS public.transaction_authorizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The DEVICE session that proved the PIN, from `session_id` in the Privy access token.
  -- Not the account: binding to the account would let a token minted on a laptop be spent by
  -- a phone that never saw the PIN, which is most of what this is here to stop.
  session_id   TEXT NOT NULL,

  -- Which kind of operation this authorises. Compared on consumption, so a token minted for a
  -- withdrawal cannot be spent on a bridge even at an identical amount to an identical address.
  purpose      TEXT NOT NULL,

  -- SHA-256 over the canonical description of the operation. See canonicalPayload() in
  -- lib/security/transaction-auth.ts — that function is the definition, and both the mint and
  -- the consume go through it so the two can never drift into hashing different shapes.
  payload_hash TEXT NOT NULL,

  -- The token is handed to the browser in the clear and stored here only as a digest, for the
  -- same reason a password is. A dump of this table cannot be replayed into live authorisations
  -- before they expire.
  token_hash   TEXT NOT NULL UNIQUE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,

  -- Null until spent. The uniqueness of a single spend comes from an UPDATE that filters on
  -- this being null, not from reading it first and writing it after.
  consumed_at  TIMESTAMPTZ
);

-- Consumption looks a token up by its digest and nothing else.
CREATE UNIQUE INDEX IF NOT EXISTS transaction_authorizations_token_idx
  ON public.transaction_authorizations (token_hash);

-- "What did this account authorise, and when?" — the question asked during a fraud review.
CREATE INDEX IF NOT EXISTS transaction_authorizations_user_idx
  ON public.transaction_authorizations (user_id, created_at DESC);

-- Expired rows are swept by the same cron that prunes OTPs; this keeps that scan cheap.
CREATE INDEX IF NOT EXISTS transaction_authorizations_expiry_idx
  ON public.transaction_authorizations (expires_at);

ALTER TABLE public.transaction_authorizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access" ON public.transaction_authorizations;
CREATE POLICY "Service role has full access"
  ON public.transaction_authorizations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Same reasoning as migration 042: RLS cannot express "every column but this one", and a client
-- role that could write `consumed_at` or read `token_hash` would defeat the table entirely.
-- Without a grant, no policy can let anyone in. Nothing in the app needs one — every read and
-- write here goes through the service role.
REVOKE ALL ON public.transaction_authorizations FROM anon;
REVOKE ALL ON public.transaction_authorizations FROM authenticated;

COMMENT ON TABLE public.transaction_authorizations IS
  'Single-use, payload-bound proof that a transaction PIN was entered for one operation. Service-role access only.';
