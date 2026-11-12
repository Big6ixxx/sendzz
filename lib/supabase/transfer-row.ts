import 'server-only';

import { supabaseAdmin } from './adminClient';
import type { TransferStatus } from '@/types/database';

/**
 * The one way a transfer row is written, by the app and by the reconciler alike.
 *
 * Both used to check for the other's row and then insert, and three things went wrong: a send
 * gathered from several networks was recorded again per network (the row kept one hash), a row
 * the reconciler wrote first stood in for the app's with the wrong amount or status, and two
 * writers racing could each see nothing and each insert. `record_transfer` (migration 066) looks
 * and writes in one transaction, locked per sender and recipient, and keeps every network's hash
 * on the row. See that migration for the outcomes.
 */

export type TransferRowOutcome = 'existing' | 'inserted' | 'merged';

export interface TransferRowInput {
  senderId: string;
  senderEmail: string;
  recipientId: string | null;
  /** As stored: see normalizeRecipient. */
  recipientEmail: string;
  amount: number;
  status: TransferStatus;
  note: string | null;
  txHash: string | null;
  sourceChain: string | null;
  /** Every transaction that paid for it, txHash included. */
  legHashes: string[];
  recordedBy: 'app' | 'recovery';
}

/**
 * Is this payment already on the ledger? A cheap look before the work that only matters for a
 * new row (reading the chain to decide whether to link a recipient). `record_transfer` makes
 * the binding decision; this only saves the trip.
 *
 * Returns the row's recipient, so a caller that stops here can still clear a deposit the same
 * arrival was credited as in the meantime.
 *
 * `appOnly` asks whether the app itself recorded it, which is the only case the app treats as
 * done: a row the reconciler wrote is replaced by the app's.
 */
export async function alreadyRecorded(params: {
  senderId: string;
  recipientEmail: string;
  legHashes: string[];
  appOnly: boolean;
}): Promise<{ id: string; recipientId: string | null } | null> {
  if (!params.legHashes.length) return null;
  let query = supabaseAdmin
    .from('transfers')
    .select('id, recipient_id')
    .eq('sender_id', params.senderId)
    .in('recipient_email', recipientForms(params.recipientEmail))
    .overlaps('leg_tx_hashes', params.legHashes);
  if (params.appOnly) query = query.eq('recorded_by', 'app');
  const { data, error } = await query.limit(1);
  // Before migration 066 the column does not exist; say "no" and let the write decide.
  if (error || !data?.[0]) return null;
  return { id: data[0].id, recipientId: data[0].recipient_id };
}

/** Write the row, or find the one that already records this payment. Null on failure. */
export async function writeTransferRow(
  input: TransferRowInput,
): Promise<{ id: string; outcome: TransferRowOutcome } | null> {
  const { data, error } = await supabaseAdmin.rpc('record_transfer', {
    p_sender_id: input.senderId,
    p_sender_email: input.senderEmail,
    p_recipient_id: input.recipientId,
    p_recipient_email: input.recipientEmail,
    p_amount: input.amount,
    p_status: input.status,
    p_note: input.note,
    p_tx_hash: input.txHash,
    p_source_chain: input.sourceChain,
    p_leg_hashes: input.legHashes,
    p_recorded_by: input.recordedBy,
  });

  if (!error && data?.[0]) return { id: data[0].transfer_id, outcome: data[0].outcome };

  if (error && isMissingFunction(error)) {
    console.error('[TransferRow] record_transfer is missing: apply migration 066. Writing the old way.');
    return writeWithoutMigration(input);
  }

  console.error('[TransferRow] record_transfer failed:', error?.message ?? 'no row returned');
  return null;
}

/** Case-insensitive recipients, stored both ways in older rows. */
function recipientForms(recipient: string): string[] {
  return [...new Set([recipient, recipient.toLowerCase()])];
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}

/**
 * Until migration 066 is applied: the check-then-insert this replaces, so a deploy that runs
 * ahead of the migration still records every send.
 */
async function writeWithoutMigration(
  input: TransferRowInput,
): Promise<{ id: string; outcome: TransferRowOutcome } | null> {
  if (input.legHashes.length) {
    const { data: existing } = await supabaseAdmin
      .from('transfers')
      .select('id')
      .eq('sender_id', input.senderId)
      .in('tx_hash', input.legHashes)
      .in('recipient_email', recipientForms(input.recipientEmail))
      .limit(1);
    if (existing?.[0]) return { id: existing[0].id, outcome: 'existing' };
  }

  const { data, error } = await supabaseAdmin
    .from('transfers')
    .insert({
      sender_id: input.senderId,
      sender_email: input.senderEmail,
      recipient_id: input.recipientId,
      recipient_email: input.recipientEmail,
      amount: input.amount,
      status: input.status,
      note: input.note,
      tx_hash: input.txHash,
      asset: 'USDC',
      ...(input.sourceChain ? { source_chain: input.sourceChain } : {}),
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[TransferRow] insert failed:', error?.message);
    return null;
  }
  return { id: data.id, outcome: 'inserted' };
}
