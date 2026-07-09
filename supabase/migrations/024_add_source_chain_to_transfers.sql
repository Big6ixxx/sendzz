-- Records which network a transfer settled on, so the activity detail view can show the
-- accurate network + block-explorer link per transfer (not just for bridges).
-- Nullable + backward compatible: existing rows and pre-migration inserts are unaffected.
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS source_chain TEXT;
