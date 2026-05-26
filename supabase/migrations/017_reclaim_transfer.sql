-- Migration: Add reclaim_transfer RPC
-- Allows senders to manually reclaim funds from expired pending_claim transfers.
-- NOTE: expire_pending_transfers() exists but should NOT be scheduled —
--       funds are never auto-reversed. Senders must reclaim explicitly.

CREATE OR REPLACE FUNCTION reclaim_transfer(
  p_transfer_id uuid,
  p_sender_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer transfers%ROWTYPE;
BEGIN
  -- Lock the specific transfer row to prevent race conditions
  SELECT * INTO v_transfer
  FROM transfers
  WHERE id = p_transfer_id
    AND sender_id = p_sender_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found or not owned by sender';
  END IF;

  IF v_transfer.status != 'pending_claim' THEN
    RAISE EXCEPTION 'Transfer cannot be reclaimed (current status: %)', v_transfer.status;
  END IF;

  IF v_transfer.expires_at IS NULL OR v_transfer.expires_at > NOW() THEN
    RAISE EXCEPTION 'Transfer has not yet expired and cannot be reclaimed';
  END IF;

  -- Return funds to sender's available balance
  UPDATE balances
  SET
    available_balance = available_balance + v_transfer.amount,
    locked_balance    = GREATEST(0, locked_balance - v_transfer.amount)
  WHERE user_id = p_sender_id;

  -- Mark transfer as expired and invalidate the claim token
  UPDATE transfers
  SET
    status           = 'expired',
    claim_token_hash = NULL,
    updated_at       = NOW()
  WHERE id = p_transfer_id;

  -- Append to audit log
  INSERT INTO audit_logs (user_id, action, metadata_json)
  VALUES (
    p_sender_id,
    'transfer_reclaimed',
    jsonb_build_object(
      'transfer_id', p_transfer_id,
      'amount',      v_transfer.amount,
      'recipient_email', v_transfer.recipient_email
    )
  );
END;
$$;

-- Grant execute to authenticated users (RLS enforces sender_id ownership)
GRANT EXECUTE ON FUNCTION reclaim_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reclaim_transfer(uuid, uuid) TO service_role;
