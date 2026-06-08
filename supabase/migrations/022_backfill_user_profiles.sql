-- Backfill user_profiles for all existing users
-- This ensures all existing users can use TOTP and other 2FA features
-- The users table is the source of truth

-- Step 1: Disable the foreign key constraint temporarily
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

-- Step 2: Delete all existing profiles (will be recreated)
DELETE FROM public.user_profiles;

-- Step 3: Recreate all profiles from users table
INSERT INTO public.user_profiles (id, email, onboarding_completed, two_fa_enabled, two_fa_threshold)
SELECT 
  id,
  email,
  true as onboarding_completed,
  false as two_fa_enabled,
  500 as two_fa_threshold
FROM public.users;