-- Remove backup codes columns from user_profiles
ALTER TABLE public.user_profiles 
  DROP COLUMN IF EXISTS backup_codes,
  DROP COLUMN IF EXISTS backup_codes_used;
