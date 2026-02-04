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
}

/**
 * Create a new deposit record
 */
export async function createDeposit({
  userId,
  amount,
  status = 'pending',
}: CreateDepositParams) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('deposits')
    .insert({
      user_id: userId,
      amount_usdc: amount,
      status,
      // For simulation, we can add a dummy Paycrest TX ID if needed,
      // or leave it null since it's unique but nullable in schema?
      // Actually schema says: paycrest_tx_id text unique. Unique allows multiple nulls in Postgres.
    })
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
