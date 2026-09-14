-- Sends that were broadcast but not yet confirmed.
--
-- --- The problem -------------------------------------------------------------
--
-- A transfer is broadcast, the wait for confirmation times out, and the ledger row is never
-- written — while the transaction lands seconds later. The money moves, the history is empty,
-- and the user is invited to send it again. One real 39 USDC send was lost exactly this way.
--
-- --- Why an intent log, and not a chain scan ---------------------------------
--
-- The obvious repair is to scan each user's wallet for outgoing USDC that has no matching row.
-- That cannot be done safely. On-chain there is nothing to distinguish a peer transfer from a
-- withdrawal to a payout provider, a bridge burn, or a platform-fee leg, so such a scan has to
-- classify by exclusion lists — and the first time a new payout address appears, it starts
-- writing FAKE transfer rows for withdrawals that already happened. Inventing history is worse
-- than the gap it would close.
--
-- So this table records our own INTENT, written immediately before the transaction is broadcast.
-- Reconciliation then asks the chain about a hash we already know, and records a transfer only
-- when the chain confirms that exact transaction succeeded. Nothing can be invented: a row here
-- exists only because Sendzz itself was about to broadcast it.
--
-- --- Lifecycle ---------------------------------------------------------------
--
--   1. Row inserted with the precomputed transaction hash, just before broadcast.
--   2. Confirmed in the same request  -> transfer recorded, row deleted.
--   3. Request dies, or confirmation times out -> row survives.
--   4. The cron checks the hash against the chain:
--        landed + successful -> record the transfer, delete the row
--        past its validity window, never landed -> delete the row, record nothing
--
-- A row is therefore transient by design. Anything still here is an unfinished question.
--
-- NOTE: an interim version of this file keyed the table on `tx_hash`. If that is what was run,
-- migration 051 corrects it — see the note there on why a batch makes that keying wrong.

CREATE TABLE IF NOT EXISTS public.pending_sends (
  -- One row per RECIPIENT, not per transaction.
  --
  -- A batch send pays many people in a single transaction, and `transfers` already records that
  -- as one row each sharing a hash. Intents have to match, or a batch would be recoverable only
  -- for whoever happened to be first. So the hash is not the key here — this id is.
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The identifier the chain will know this by, shared by every recipient of the same send.
  --
  -- What it holds depends on the rail. On Stellar it is the transaction hash, derived from the
  -- signed envelope before submission; that precomputation is what makes a submission timeout
  -- recoverable at all. On EVM there is no transaction yet at broadcast time, so it is the
  -- UserOperation hash, and the reconciler resolves that to a transaction hash via the bundler.
  --
  -- Deliberately NOT unique, and with no unique pair alongside it: one batch may legitimately pay
  -- the same address twice, and a constraint that silently merged those two rows would record one
  -- payment where two happened. Duplicate intents are not a real risk — the write happens once
  -- per successful broadcast, and a retried send produces a different hash.
  tx_hash        TEXT NOT NULL,

  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  chain          TEXT NOT NULL,
  sender_email   TEXT NOT NULL,

  -- Address or email, exactly as it will be written to `transfers.recipient_email`.
  recipient      TEXT NOT NULL,
  amount         NUMERIC NOT NULL,
  note           TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The moment after which inclusion has become impossible, so a row that has not landed by then
  -- never will. Set per rail, because the two differ in kind: a Stellar transaction carries a
  -- 300-second timebound the protocol itself enforces, while a UserOperation has no deadline at
  -- all — a bundler may hold one far longer than expected. EVM therefore gets a day, because
  -- forgetting a send early would quietly recreate the bug this table exists to close.
  -- See validityMs in lib/supabase/pendingSends.ts.
  expires_at     TIMESTAMPTZ NOT NULL
);

-- The cron reads oldest-first.
CREATE INDEX IF NOT EXISTS pending_sends_created_idx
  ON public.pending_sends (created_at);

-- Every recipient of one send is resolved together, and cleared together.
CREATE INDEX IF NOT EXISTS pending_sends_tx_hash_idx
  ON public.pending_sends (tx_hash);

ALTER TABLE public.pending_sends ENABLE ROW LEVEL SECURITY;

-- Reached only through the service role, like the rest of the schema.
DROP POLICY IF EXISTS "Service role has full access" ON public.pending_sends;
CREATE POLICY "Service role has full access"
  ON public.pending_sends FOR ALL USING (true) WITH CHECK (true);
