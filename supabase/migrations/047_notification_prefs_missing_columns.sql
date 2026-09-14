-- Notification preferences that the app has always written but the table never had.
--
-- Migration 033 added five email columns. The application type declared more fields than that,
-- so every `push_notif_*` was being written to a column that does not exist. PostgREST rejects
-- the whole statement when any column is unknown, so a single phantom key in the payload
-- silently discarded the entire save — including the valid email preferences alongside it.
--
-- Users reported turning notifications off and still receiving them; this was half the cause.
--
-- Defaults are TRUE to match 033: nobody's current behaviour changes by adding these.

-- `email_notif_system` and `push_notif_system` are deliberately NOT here: no email or push is
-- gated on them and no toggle exposes them, so they would be columns nothing could ever set.

-- Deposits and withdrawals get a column each rather than one `push_notif_wallet`. They are
-- different events to a user -- money arriving versus money leaving -- and the settings page
-- now offers them as separate switches, so the storage has to be separate too.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS push_notif_transfer   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_notif_deposit    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_notif_withdrawal BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_notif_bridge     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_notif_security   BOOLEAN NOT NULL DEFAULT TRUE;
