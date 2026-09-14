-- Correction for a `pending_sends` created with `tx_hash` as its PRIMARY KEY.
--
-- An interim version of migration 049 keyed the table on the transaction hash. That is wrong for
-- one reason: a BATCH send pays many people in a single transaction, and `transfers` already
-- records that as one row per recipient sharing a hash. Intents have to match — keyed on the
-- hash, the first recipient's intent would insert and every other one would be rejected as a
-- duplicate, leaving a batch recoverable only for whoever happened to be first.
--
-- So the hash stops being the key and becomes an ordinary indexed column, and a surrogate id
-- takes over. No unique constraint replaces it: one batch may legitimately pay the same address
-- twice, and a constraint that merged those rows would record one payment where two happened.
--
-- Safe on an already-correct table: every step is guarded, so this is a no-op against a database
-- that ran the final 049. Safe on data too, though in practice there is none — rows here are
-- transient by design and the table is empty until the code that writes it ships.

DO $$
BEGIN
  -- Only act if `id` is missing, which is what identifies the interim shape.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pending_sends' AND column_name = 'id'
  ) THEN
    -- Release the hash from key duty so it can repeat across a batch's recipients.
    ALTER TABLE public.pending_sends DROP CONSTRAINT IF EXISTS pending_sends_pkey;

    ALTER TABLE public.pending_sends
      ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();

    ALTER TABLE public.pending_sends ADD PRIMARY KEY (id);

    RAISE NOTICE 'pending_sends: re-keyed on id; tx_hash may now repeat across a batch.';
  ELSE
    RAISE NOTICE 'pending_sends: already keyed on id — nothing to do.';
  END IF;
END $$;

-- Every recipient of one send is resolved together, and cleared together. Harmless to repeat.
CREATE INDEX IF NOT EXISTS pending_sends_tx_hash_idx
  ON public.pending_sends (tx_hash);
