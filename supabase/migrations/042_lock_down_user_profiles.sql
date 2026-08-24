-- Keep secrets in `user_profiles` out of reach of the client roles.
--
-- The table already has RLS, but its policies are ROW level and permissive:
--
--   "Users can view own profile"    select … using (auth.uid() = id)
--   "Users can update own profile"  update … using (auth.uid() = id)
--
-- Row level is the wrong granularity for this table. It now holds `totp_secret` and, since
-- migration 041, `pin_hash` plus the PIN attempt counter — and "your own row" includes every
-- column in it. Under those policies an authenticated session could:
--
--   * read `pin_hash` and `totp_secret` outright, and
--   * write `pin_failed_attempts` and `pin_locked_until` back to zero, which defeats the
--     lockout entirely. That lockout is the main thing standing between a 4-digit PIN and
--     10,000 guesses, so being able to reset it is worse than the hash being read.
--
-- RLS cannot express "every column except these", so the fix is at the privilege layer:
-- without a grant, no policy can let anyone in. Nothing is lost — every read and write of
-- this table in the app goes through the service role, which is exempt from both.

revoke all on public.user_profiles from anon;
revoke all on public.user_profiles from authenticated;

-- The policies stay in place. They are correct as intent and become effective again the
-- moment a column-level grant is issued deliberately, rather than being inherited wholesale.

comment on table public.user_profiles is
  'Holds authentication secrets (totp_secret, pin_hash). Service-role access only — anon and authenticated hold no grants on this table.';
