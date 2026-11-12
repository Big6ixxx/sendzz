-- 066: One payment, one transfer row, whoever writes it first.
--
-- Two writers record sends. The app writes the transfer once the user sees the send through. The
-- reconciler (lib/supabase/pendingSends.ts) writes it from the chain when the app never did: a
-- closed tab, a dropped connection. Each checked for the other's row and then inserted, which
-- went wrong three ways:
--
--   • A send gathered from several networks is one transaction per network but one row, and the
--     row kept only the first network's hash. The reconciler, matching on hash, recorded every
--     other network again: 10 from Base plus 20 from Polygon became 30 + 20 on the ledger.
--   • When the reconciler got there first, the app either wrote a second copy or, once it learned
--     to skip, kept the reconciler's row: a part of the payment, with the reconciler's status
--     ('completed') where the app knew it was 'pending_claim'.
--   • Check, then insert, from two processes: both could see nothing and both write.
--
-- So every network's hash now lives on the row (`leg_tx_hashes`), the row says who wrote it
-- (`recorded_by`), and both writers go through `record_transfer`, which looks and writes inside
-- one transaction, serialised per sender and recipient.

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS leg_tx_hashes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recorded_by text NOT NULL DEFAULT 'app';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_recorded_by_check') THEN
    ALTER TABLE public.transfers
      ADD CONSTRAINT transfers_recorded_by_check CHECK (recorded_by IN ('app', 'recovery'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_transfers_leg_tx_hashes ON public.transfers USING gin (leg_tx_hashes);
CREATE INDEX IF NOT EXISTS idx_transfers_sender_tx_hash ON public.transfers (sender_id, tx_hash);

COMMENT ON COLUMN public.transfers.leg_tx_hashes IS
  'Every on-chain transaction that paid for this transfer, tx_hash included. Written by record_transfer.';
COMMENT ON COLUMN public.transfers.recorded_by IS
  'app: written by the sender''s own session. recovery: written by the reconciler from the chain, '
  'and replaced by the app''s row if that arrives later.';

/**
 * Record one transfer, or return the row that already records it.
 *
 * "Already records it" means: same sender, same recipient (compared case-insensitively, so the
 * lowercased Stellar copies the reconciler used to write are recognised), and any shared
 * transaction hash, on the row's own hash or any of its legs.
 *
 * Outcomes:
 *   existing  the app already recorded this payment. Nothing is written.
 *   inserted  no row covered it. One is written.
 *   merged    (app only) the reconciler had recorded some or all of it. Its rows become this
 *             one row, with the app's amount, status and recipient and every leg's hash.
 *
 * A recovery call never overwrites anything: if any row covers its hash it returns 'existing'.
 *
 * The advisory lock is per sender and recipient, so the two writers for one payment queue
 * behind each other while unrelated sends do not.
 */
CREATE OR REPLACE FUNCTION public.record_transfer(
  p_sender_id       uuid,
  p_sender_email    text,
  p_recipient_id    uuid,
  p_recipient_email text,
  p_amount          numeric,
  p_status          public.transfer_status,
  p_note            text,
  p_tx_hash         text,
  p_source_chain    text,
  p_leg_hashes      text[],
  p_recorded_by     text
)
RETURNS TABLE (transfer_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_legs   text[];
  v_found  uuid[];
  v_keep   uuid;
  v_id     uuid;
BEGIN
  IF p_recorded_by NOT IN ('app', 'recovery') THEN
    RAISE EXCEPTION 'record_transfer: recorded_by must be app or recovery';
  END IF;

  SELECT coalesce(array_agg(DISTINCT h), '{}')
    INTO v_legs
    FROM unnest(coalesce(p_leg_hashes, '{}') || p_tx_hash) AS h
   WHERE h IS NOT NULL AND h <> '';

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_sender_id::text || '|' || lower(p_recipient_email), 66)
  );

  IF cardinality(v_legs) > 0 THEN
    -- Has the app already recorded this payment? Then this is a repeat call, whoever makes it.
    SELECT t.id INTO v_id
      FROM public.transfers t
     WHERE t.sender_id = p_sender_id
       AND lower(t.recipient_email) = lower(p_recipient_email)
       AND (t.tx_hash = ANY (v_legs) OR t.leg_tx_hashes && v_legs)
       AND t.recorded_by = 'app'
     ORDER BY t.created_at
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'existing'::text;
      RETURN;
    END IF;

    -- Rows the reconciler wrote for any part of it.
    SELECT array_agg(t.id ORDER BY t.created_at) INTO v_found
      FROM public.transfers t
     WHERE t.sender_id = p_sender_id
       AND lower(t.recipient_email) = lower(p_recipient_email)
       AND (t.tx_hash = ANY (v_legs) OR t.leg_tx_hashes && v_legs);

    IF v_found IS NOT NULL THEN
      IF p_recorded_by = 'recovery' THEN
        RETURN QUERY SELECT v_found[1], 'existing'::text;
        RETURN;
      END IF;

      -- The app's view wins: it knows the whole payment, its status and its recipient.
      v_keep := v_found[1];
      UPDATE public.transfers t
         SET sender_email    = p_sender_email,
             recipient_id    = coalesce(p_recipient_id, t.recipient_id),
             recipient_email = p_recipient_email,
             amount          = p_amount,
             status          = p_status,
             note            = coalesce(p_note, t.note),
             tx_hash         = coalesce(p_tx_hash, t.tx_hash),
             source_chain    = coalesce(p_source_chain, t.source_chain),
             leg_tx_hashes   = (
               SELECT coalesce(array_agg(DISTINCT h), '{}')
                 FROM (
                   SELECT unnest(v_legs) AS h
                   UNION
                   SELECT o.tx_hash FROM public.transfers o WHERE o.id = ANY (v_found) AND o.tx_hash IS NOT NULL
                   UNION
                   SELECT unnest(o.leg_tx_hashes) FROM public.transfers o WHERE o.id = ANY (v_found)
                 ) s
             ),
             recorded_by     = 'app',
             updated_at      = now()
       WHERE t.id = v_keep;

      DELETE FROM public.transfers WHERE id = ANY (v_found) AND id <> v_keep;

      RETURN QUERY SELECT v_keep, 'merged'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.transfers (
    sender_id, sender_email, recipient_id, recipient_email, amount, asset, status, note,
    tx_hash, source_chain, leg_tx_hashes, recorded_by
  ) VALUES (
    p_sender_id, p_sender_email, p_recipient_id, p_recipient_email, p_amount, 'USDC', p_status, p_note,
    nullif(p_tx_hash, ''), p_source_chain, v_legs, p_recorded_by
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'inserted'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_transfer(uuid, text, uuid, text, numeric, public.transfer_status, text, text, text, text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_transfer(uuid, text, uuid, text, numeric, public.transfer_status, text, text, text, text[], text)
  TO service_role;

-- Existing rows: their own hash is their only known leg.
UPDATE public.transfers
   SET leg_tx_hashes = ARRAY[tx_hash]
 WHERE tx_hash IS NOT NULL AND leg_tx_hashes = '{}';
