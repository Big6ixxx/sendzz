CREATE TYPE transaction_otp_action AS ENUM ('transfer', 'withdrawal');

CREATE TABLE transaction_otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    otp_code TEXT NOT NULL,
    action_type transaction_otp_action NOT NULL,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE transaction_otps ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own otps
CREATE POLICY "Users can view their own transaction otps" ON transaction_otps
    FOR SELECT
    USING (auth.uid() = (SELECT id FROM users WHERE email = transaction_otps.user_email));

-- Allow service role to manage all
CREATE POLICY "Service role can manage transaction otps" ON transaction_otps
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_transaction_otps_user_email ON transaction_otps(user_email);
CREATE INDEX idx_transaction_otps_expires_at ON transaction_otps(expires_at);
