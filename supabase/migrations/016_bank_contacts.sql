-- =========================================
-- BANK CONTACTS TABLE
-- =========================================
-- Stores user bank accounts for quick selection and refunds

CREATE TABLE IF NOT EXISTS public.bank_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    bank_name TEXT NOT NULL,
    bank_code TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, account_number, bank_code)
);

-- RLS
ALTER TABLE public.bank_contacts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own bank contacts"
  ON public.bank_contacts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bank contacts"
  ON public.bank_contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bank contacts"
  ON public.bank_contacts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bank contacts"
  ON public.bank_contacts FOR DELETE
  USING (auth.uid() = user_id);
