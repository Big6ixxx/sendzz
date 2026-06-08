-- Add TOTP (Authenticator App) support to user_profiles
ALTER TABLE public.user_profiles 
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backup_codes TEXT[],  -- Encrypted backup codes
  ADD COLUMN IF NOT EXISTS backup_codes_used TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS webauthn_credentials JSONB DEFAULT '[]'::jsonb;

-- Add index for TOTP-enabled users
CREATE INDEX IF NOT EXISTS idx_user_profiles_totp_enabled 
  ON public.user_profiles(totp_enabled) 
  WHERE totp_enabled = true;
