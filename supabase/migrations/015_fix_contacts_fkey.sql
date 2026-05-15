-- ========================================================
-- FIX CONTACTS FOREIGN KEY FOR PRIVY
-- ========================================================
-- This fixes the foreign key on the contacts table to point 
-- to the public.users table instead of public.user_profiles.
-- ========================================================

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_user_id_fkey;

ALTER TABLE public.contacts 
  ADD CONSTRAINT contacts_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
