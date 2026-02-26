-- ===========================================
-- MIGRATION: Add BlockRadar wallet columns
-- ===========================================

-- Add wallet columns to user_profiles table
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS blockradar_address_id TEXT,
ADD COLUMN IF NOT EXISTS solana_address TEXT;

-- Create index for faster lookups by solana address
CREATE INDEX IF NOT EXISTS idx_user_profiles_solana_address 
ON public.user_profiles(solana_address) 
WHERE solana_address IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.user_profiles.blockradar_address_id IS 'BlockRadar generated address ID for this user';
COMMENT ON COLUMN public.user_profiles.solana_address IS 'Solana wallet address for receiving USDC deposits';
