/**
 * Deposit Repository
 *
 * Database operations for deposits.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { DepositStatus } from '@/types/database';

export interface CreateDepositParams {
  userId: string;
  amount: number;
  status?: DepositStatus;
  txHash?: string;
  paymentReference?: string; // For Paystack payment tracking
}

/**
 * Create a new deposit record
 */
export async function createDeposit({
  userId,
  amount,
  status = 'pending',
  txHash,
  paymentReference,
}: CreateDepositParams) {
  const supabase = createAdminClient();

  const insertData: Record<string, unknown> = {
    user_id: userId,
    amount_usdc: amount,
    status,
    tx_hash: txHash,
  };

  // Add payment_reference if provided (may need DB migration)
  if (paymentReference) {
    insertData.payment_reference = paymentReference;
  }

  const { data, error } = await supabase
    .from('deposits')
    .insert(insertData as Record<string, unknown> & { user_id: string })
    .select()
    .single();

  if (error) {
    console.error('[DepositRepo] createDeposit error:', error);
    throw error;
  }

  return data;
}

/**
 * Update deposit status
 */
export async function updateDepositStatus(
  depositId: string,
  status: DepositStatus,
) {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('deposits')
    .update({ status })
    .eq('id', depositId);

  if (error) {
    console.error('[DepositRepo] updateDepositStatus error:', error);
    throw error;
  }

  return true;
}

/**
 * Find deposit by payment reference
 */
export async function findDepositByReference(reference: string) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('deposits')
    .select('*')
    .eq('payment_reference' as string, reference)
    .maybeSingle();

  if (error) {
    console.error('[DepositRepo] findByReference error:', error);
    return null;
  }

  return data;
}

/**
 * Get deposits by user
 */
export async function getDepositsByUser(userId: string, limit = 10) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('deposits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[DepositRepo] getDepositsByUser error:', error);
    return [];
  }

  return data;
}
