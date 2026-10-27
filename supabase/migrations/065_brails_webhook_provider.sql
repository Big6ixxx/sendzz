-- Brails webhook events in the admin webhook log.
--
-- `webhook_events.provider` is the `webhook_provider` enum, which had no 'brails', so the Brails
-- webhook (app/api/webhook/brails) could not record its events alongside Bitnob's and
-- Paycrest's. Already applied on production; IF NOT EXISTS keeps a re-run harmless.
ALTER TYPE public.webhook_provider ADD VALUE IF NOT EXISTS 'brails';
