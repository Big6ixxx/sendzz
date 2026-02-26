-- ===========================================
-- MIGRATION: 008 Add multi-chain and CCTP
-- ===========================================

-- Add EVM wallet columns to user_profiles table
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS ethereum_address TEXT,
ADD COLUMN IF NOT EXISTS arbitrum_address TEXT,
ADD COLUMN IF NOT EXISTS base_address TEXT,
ADD COLUMN IF NOT EXISTS polygon_address TEXT,
ADD COLUMN IF NOT EXISTS optimism_address TEXT,
ADD COLUMN IF NOT EXISTS avalanche_address TEXT,
ADD COLUMN IF NOT EXISTS blockradar_evm_address_id TEXT;

-- Create indexes for EVM addresses
CREATE INDEX IF NOT EXISTS idx_user_profiles_ethereum_address ON public.user_profiles(ethereum_address) WHERE ethereum_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_arbitrum_address ON public.user_profiles(arbitrum_address) WHERE arbitrum_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_base_address ON public.user_profiles(base_address) WHERE base_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_polygon_address ON public.user_profiles(polygon_address) WHERE polygon_address IS NOT NULL;

-- Create bridge_transactions table for CCTP tracking
CREATE TABLE IF NOT EXISTS public.bridge_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    burn_tx_hash TEXT NOT NULL,
    source_chain TEXT NOT NULL,
    dest_chain TEXT NOT NULL,
    amount NUMERIC(20, 8) NOT NULL,
    attestation_status TEXT NOT NULL DEFAULT 'pending', -- pending, complete, failed
    mint_tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_burn_tx UNIQUE (burn_tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_bridge_tx_user_id ON public.bridge_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_bridge_tx_status ON public.bridge_transactions(attestation_status);

-- Add update trigger
CREATE TRIGGER trg_bridge_transactions_updated_at
BEFORE UPDATE ON public.bridge_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.bridge_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bridge transactions"
ON public.bridge_transactions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create bridge transactions"
ON public.bridge_transactions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "No direct updates on bridge transactions"
ON public.bridge_transactions
FOR UPDATE
TO authenticated
USING (false);
