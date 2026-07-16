-- Add email notification preferences column to user_profiles table.
-- Each field maps to a specific transactional email category.
-- All default to true (opt-in) so existing users keep getting emails.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS email_notif_transfer   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_notif_deposit    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_notif_withdrawal BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_notif_bridge     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_notif_security   BOOLEAN NOT NULL DEFAULT TRUE;
