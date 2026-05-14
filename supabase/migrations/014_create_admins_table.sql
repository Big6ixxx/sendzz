-- 014: Create Platform Admins Table
-- This table stores users who have administrative access to the Sendzz dashboard.

CREATE TABLE IF NOT EXISTS public.platform_admins (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text UNIQUE NOT NULL,
    role text DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'moderator')),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add initial admins
INSERT INTO public.platform_admins (email, role)
VALUES 
    ('yunusabdulmajidyunus38@gmail.com', 'super_admin'),
    ('junaidaaliyah260@gmail.com', 'admin'),
    ('maleekcherry510@gmail.com', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Enable RLS (Row Level Security)
-- We want this table to be restricted. Only the service role should query it directly for auth checks.
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Create policy for service_role only (optional as service_role bypasses RLS, but good for clarity)
CREATE POLICY "Only service_role can access platform_admins"
ON public.platform_admins
FOR ALL
USING (auth.role() = 'service_role');

-- Add index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_platform_admins_email ON public.platform_admins(email);
