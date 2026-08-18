-- 037: One on-chain transfer funds at most one withdrawal.
--
-- On a shared deposit address (Stellar returns one static company account for every payout) the
-- only thing tying a deposit to a payout is its transaction hash — so that hash is what the
-- settle path verifies against. Without uniqueness, the same settled deposit could be presented
-- twice and fund two payouts, the second one entirely out of our own float. Bitnob cannot help
-- here: it never links a deposit to the payout it funded, which is the whole reason we match on
-- the hash ourselves. This table is therefore the only place the "already spent" fact exists.
--
-- A partial unique index makes the database refuse a second claim atomically. The application
-- check it replaces was read-then-act, which two concurrent settles could both pass.
--
-- Safe to apply: verified 289 withdrawals carry a tx_hash and none is duplicated.
create unique index if not exists withdrawals_tx_hash_unique
  on withdrawals (tx_hash)
  where tx_hash is not null;
