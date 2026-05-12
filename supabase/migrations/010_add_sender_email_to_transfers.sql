-- Add sender_email to transfers table
ALTER TABLE transfers ADD COLUMN sender_email TEXT;

-- Update existing records if possible (best effort)
-- We try to join with the users table to get the email for the sender_id
UPDATE transfers
SET sender_email = users.email
FROM users
WHERE transfers.sender_id = users.id AND transfers.sender_email IS NULL;
