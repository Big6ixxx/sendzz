-- 036: Add memo column to withdrawals table for storing payment reference/memo
-- Used by recipients and surfaced in transaction receipts.

ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS memo TEXT;
