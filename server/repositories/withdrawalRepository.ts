/**
 * Withdrawal Repository
 *
 * Database operations for withdrawals (stablecoin → fiat payouts via Paycrest).
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { Database, WithdrawalStatus } from '@/types/database';

type Withdrawal = Database['public']['Tables']['withdrawals']['Row'];
type WithdrawalInsert = Database['public']['Tables']['withdrawals']['Insert'];

export interface CreateWithdrawalParams {
  userId: string;
  amountUsdc: number;
  fiatCurrency: string;
  institutionCode: string;
  bankAccountMasked: string;
  verificationTokenHash: string;
  verificationExpiresAt: Date;
}

/**
 * Create a new withdrawal request
 */
export async function createWithdrawal(
  params: CreateWithdrawalParams,
): Promise<Withdrawal | null> {
  const supabase = createAdminClient();

  const insert: WithdrawalInsert = {
    user_id: params.userId,
    amount_usdc: params.amountUsdc,
    fiat_currency: params.fiatCurrency.toUpperCase(),
    institution_code: params.institutionCode,
    bank_account_masked: params.bankAccountMasked,
    verification_token_hash: params.verificationTokenHash,
    verification_expires_at: params.verificationExpiresAt.toISOString(),
    status: 'awaiting_verification',
    verification_status: 'pending',
  };

  const { data, error } = await supabase
    .from('withdrawals')
    .insert(insert)
    .select()
    .single();

  if (error) {
    console.error('[WithdrawalRepo] create error:', error);
    return null;
  }
  return data;
}

/**
 * Find withdrawal by ID
 */
export async function findWithdrawalById(
  id: string,
): Promise<Withdrawal | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[WithdrawalRepo] findById error:', error);
    return null;
  }
  return data;
}

/**
 * Find withdrawal by verification token hash
 */
export async function findWithdrawalByVerificationToken(
  tokenHash: string,
): Promise<Withdrawal | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('verification_token_hash', tokenHash)
    .eq('verification_status', 'pending')
    .maybeSingle();

  if (error) {
    console.error('[WithdrawalRepo] findByVerificationToken error:', error);
    return null;
  }
  return data;
}

/**
 * Find withdrawal by Paycrest order ID
 */
export async function findWithdrawalByPaycrestOrderId(
  orderId: string,
): Promise<Withdrawal | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('paycrest_order_id', orderId)
    .maybeSingle();

  if (error) {
    console.error('[WithdrawalRepo] findByPaycrestOrderId error:', error);
    return null;
  }
  return data;
}

/**
 * Mark withdrawal as verified and set Paycrest order ID
 */
export async function markWithdrawalVerified(
  withdrawalId: string,
  paycrestOrderId: string,
): Promise<Withdrawal | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('withdrawals')
    .update({
      verification_status: 'verified',
      verification_token_hash: null, // Invalidate token
      paycrest_order_id: paycrestOrderId,
      status: 'processing',
    })
    .eq('id', withdrawalId)
    .eq('verification_status', 'pending')
    .select()
    .single();

  if (error) {
    console.error('[WithdrawalRepo] markVerified error:', error);
    return null;
  }
  return data;
}

/**
 * Update withdrawal status
 */
export async function updateWithdrawalStatus(
  withdrawalId: string,
  status: WithdrawalStatus,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('withdrawals')
    .update({ status })
    .eq('id', withdrawalId);

  if (error) {
    console.error('[WithdrawalRepo] updateStatus error:', error);
    return false;
  }
  return true;
}

/**
 * Update withdrawal status by Paycrest order ID
 */
export async function updateWithdrawalStatusByPaycrestId(
  paycrestOrderId: string,
  status: WithdrawalStatus,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('withdrawals')
    .update({ status })
    .eq('paycrest_order_id', paycrestOrderId);

  if (error) {
    console.error('[WithdrawalRepo] updateStatusByPaycrestId error:', error);
    return false;
  }
  return true;
}

/**
 * Get user's withdrawals
 */
export async function getWithdrawalsByUser(
  userId: string,
  limit: number = 50,
): Promise<Withdrawal[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[WithdrawalRepo] getByUser error:', error);
    return [];
  }
  return data || [];
}

/**
 * Expire old unverified withdrawals
 */
export async function expireUnverifiedWithdrawals(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('withdrawals')
    .update({
      verification_status: 'expired',
      verification_token_hash: null,
      status: 'failed',
    })
    .eq('verification_status', 'pending')
    .lt('verification_expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('[WithdrawalRepo] expireUnverified error:', error);
    return 0;
  }
  return data?.length || 0;
}
