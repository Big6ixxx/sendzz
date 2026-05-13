-- Add tx_hash column to transfers table
ALTER TABLE transfers ADD COLUMN tx_hash TEXT;

-- Move existing tx_hashes from note to tx_hash where note starts with 0x
UPDATE transfers
SET tx_hash = note, note = NULL
WHERE note LIKE '0x%';
