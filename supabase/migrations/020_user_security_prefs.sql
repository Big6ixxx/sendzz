-- Add security preferences to user_profiles
ALTER TABLE public.user_profiles 
  ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS two_fa_threshold NUMERIC(20, 8) NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS two_fa_nudge_dismissed_at timestamptz;