/**
 * Transfer Repository
 *
 * Database operations for transfers (email-to-email payments).
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { Database, TransferStatus } from '@/types/database';

type Transfer = Database['public']['Tables']['transfers']['Row'];
type TransferInsert = Database['public']['Tables']['transfers']['Insert'];

export interface CreateTransferParams {
  senderId: string;
  recipientEmail: string;
  amount: number;
  note?: string;
  claimTokenHash?: string;
  expiresAt?: Date;
  recipientId?: string;
  status?: TransferStatus;
}

/**
 * Create a new transfer
 */
export async function createTransfer(
  params: CreateTransferParams,
): Promise<Transfer | null> {
  const supabase = createAdminClient();

  const insert: TransferInsert = {
    sender_id: params.senderId,
    recipient_email: params.recipientEmail.toLowerCase(),
    amount: params.amount,
    note: params.note,
    claim_token_hash: params.claimTokenHash,
    expires_at: params.expiresAt?.toISOString(),
    recipient_id: params.recipientId,
    status:
      params.status || (params.recipientId ? 'completed' : 'pending_claim'),
  };

  const { data, error } = await supabase
    .from('transfers')
    .insert(insert)
    .select()
    .single();

  if (error) {
    console.error('[TransferRepo] createTransfer error:', error);
    return null;
  }
  return data;
}

/**
 * Find transfer by ID
 */
export async function findTransferById(id: string): Promise<Transfer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[TransferRepo] findById error:', error);
    return null;
  }
  return data;
}

/**
 * Find pending transfer by claim token hash
 */
export async function findTransferByClaimTokenHash(
  tokenHash: string,
): Promise<Transfer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('claim_token_hash', tokenHash)
    .eq('status', 'pending_claim')
    .maybeSingle();

  if (error) {
    console.error('[TransferRepo] findByClaimTokenHash error:', error);
    return null;
  }
  return data;
}

/**
 * Mark transfer as claimed
 */
export async function markTransferClaimed(
  transferId: string,
  recipientId: string,
): Promise<Transfer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .update({
      status: 'claimed',
      recipient_id: recipientId,
      claim_token_hash: null, // Invalidate token
    })
    .eq('id', transferId)
    .eq('status', 'pending_claim')
    .select()
    .single();

  if (error) {
    console.error('[TransferRepo] markClaimed error:', error);
    return null;
  }
  return data;
}

/**
 * Mark transfer as completed (after balance credited)
 */
export async function markTransferCompleted(
  transferId: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('transfers')
    .update({ status: 'completed' })
    .eq('id', transferId);

  if (error) {
    console.error('[TransferRepo] markCompleted error:', error);
    return false;
  }
  return true;
}

/**
 * Mark transfer as cancelled
 */
export async function cancelTransfer(transferId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('transfers')
    .update({
      status: 'cancelled',
      claim_token_hash: null,
    })
    .eq('id', transferId)
    .eq('status', 'pending_claim');

  if (error) {
    console.error('[TransferRepo] cancel error:', error);
    return false;
  }
  return true;
}

/**
 * Get transfers sent by user
 */
export async function getTransfersBySender(
  senderId: string,
  limit: number = 50,
): Promise<Transfer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('sender_id', senderId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[TransferRepo] getBySender error:', error);
    return [];
  }
  return data || [];
}

/**
 * Get transfers received by user
 */
export async function getTransfersByRecipient(
  recipientId: string,
  limit: number = 50,
): Promise<Transfer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('recipient_id', recipientId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[TransferRepo] getByRecipient error:', error);
    return [];
  }
  return data || [];
}

/**
 * Get all transfers for a user (sent + received)
 */
export async function getAllUserTransfers(
  userId: string,
  limit: number = 50,
): Promise<Transfer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[TransferRepo] getAllUserTransfers error:', error);
    return [];
  }
  return data || [];
}

/**
 * Find pending claims for an email (for when user signs up)
 */
export async function findPendingClaimsForEmail(
  email: string,
): Promise<Transfer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('recipient_email', email.toLowerCase())
    .eq('status', 'pending_claim')
    .gt('expires_at', new Date().toISOString());

  if (error) {
    console.error('[TransferRepo] findPendingClaimsForEmail error:', error);
    return [];
  }
  return data || [];
}

/**
 * Expire old pending transfers
 */
export async function expireOldTransfers(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('transfers')
    .update({
      status: 'expired',
      claim_token_hash: null,
    })
    .eq('status', 'pending_claim')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('[TransferRepo] expireOldTransfers error:', error);
    return 0;
  }
  return data?.length || 0;
}
