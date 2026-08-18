-- 038: Let the server finish a deferred payout when the user's browser cannot.
--
-- On a shared-address chain the payout is created only AFTER the deposit is verified, and the
-- beneficiary is supplied at that moment. If the tab closes or the connection drops between the
-- transfer landing and that call, the deposit is credited but no payout exists — and the server
-- has no bank details to finish with, so the money strands until someone intervenes by hand.
--
-- This column holds those details for exactly that window, AES-256-GCM encrypted (lib/encryption)
-- so the table keeps its "masked bank info only" property at rest. The reconcile cron decrypts it
-- to complete the payout, and it is scrubbed to NULL the moment the payout is initialized —
-- successfully or not. Nothing accumulates.
alter table public.withdrawals
  add column if not exists pending_beneficiary text;

comment on column public.withdrawals.pending_beneficiary is
  'Transient AES-256-GCM encrypted beneficiary for a deferred payout. Written at order creation, '
  'scrubbed at initialize. NULL at rest for every settled withdrawal.';
