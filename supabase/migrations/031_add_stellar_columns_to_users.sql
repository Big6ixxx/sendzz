-- Add Stellar columns to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stellar_address text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stellar_wallet_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stellar_signer_granted boolean DEFAULT false;
