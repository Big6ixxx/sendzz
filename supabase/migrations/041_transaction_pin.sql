-- A 4-digit PIN as a second factor, stored so that nobody can read it back.
--
-- `pin_hash` holds a self-describing scrypt digest — `scrypt$N$r$p$salt$hash` — not the PIN and
-- not an encryption of it. There is deliberately no key anywhere that could turn it back into
-- four digits, which is what makes it safe from us as well as from an attacker.
--
-- The hash alone is not the whole defence. A 4-digit PIN is 10,000 possibilities, so two other
-- things carry equal weight:
--
--   * A pepper in the server environment (PIN_PEPPER), never in this database. A stolen dump
--     cannot even begin to test guesses without it.
--   * The attempt counter below. Five tries against 10,000 values, then a lockout, is what
--     makes guessing impractical rather than merely slow.

alter table public.user_profiles
  add column if not exists pin_hash            text,
  add column if not exists pin_set_at          timestamptz,
  add column if not exists pin_failed_attempts integer not null default 0,
  add column if not exists pin_locked_until    timestamptz;

comment on column public.user_profiles.pin_hash is
  'scrypt digest of the PIN combined with a server-side pepper. Not reversible, by design — no key exists that can recover the PIN.';
comment on column public.user_profiles.pin_failed_attempts is
  'Consecutive wrong PINs. Reset to 0 on success or on lockout.';
comment on column public.user_profiles.pin_locked_until is
  'Set when the attempt limit is hit. Verification is refused until this passes.';
