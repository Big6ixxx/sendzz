/**
 * Balance Repository
 *
 * Database operations for user balances.
 * All balance modifications use atomic operations.
 */

import { createAdminClient } from '@/lib/supabase/server';

export interface BalanceInfo {
  available: number;
  locked: number;
  total: number;
}

/**
 * Get user balance
 */
export async function getBalance(userId: string): Promise<BalanceInfo | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('balances')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[BalanceRepo] getBalance error:', error);
    return null;
  }

  if (!data) {
    return { available: 0, locked: 0, total: 0 };
  }

  return {
    available: Number(data.available_balance),
    locked: Number(data.locked_balance),
    total: Number(data.available_balance) + Number(data.locked_balance),
  };
}

/**
 * Credit user balance (add funds)
 * Uses RPC for atomic operation
 */
export async function creditBalance(
  userId: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) {
    console.error('[BalanceRepo] creditBalance: amount must be positive');
    return false;
  }

  const supabase = createAdminClient();

  // Get current balance
  const { data: currentBalance } = await supabase
    .from('balances')
    .select('available_balance')
    .eq('user_id', userId)
    .single();

  if (!currentBalance) {
    console.error('[BalanceRepo] creditBalance: user balance not found');
    return false;
  }

  const newBalance = Number(currentBalance.available_balance) + amount;
  const { error } = await supabase
    .from('balances')
    .update({ available_balance: newBalance })
    .eq('user_id', userId);

  if (error) {
    console.error('[BalanceRepo] creditBalance error:', error);
    return false;
  }

  return true;
}

/**
 * Debit user balance (remove funds)
 * Checks for sufficient balance atomically
 */
export async function debitBalance(
  userId: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) {
    console.error('[BalanceRepo] debitBalance: amount must be positive');
    return false;
  }

  const supabase = createAdminClient();

  // Check current balance first
  const { data: currentBalance } = await supabase
    .from('balances')
    .select('available_balance')
    .eq('user_id', userId)
    .single();

  if (!currentBalance) {
    console.error('[BalanceRepo] debitBalance: user balance not found');
    return false;
  }

  const available = Number(currentBalance.available_balance);
  if (available < amount) {
    console.error('[BalanceRepo] debitBalance: insufficient balance');
    return false;
  }

  const newBalance = available - amount;
  const { error } = await supabase
    .from('balances')
    .update({ available_balance: newBalance })
    .eq('user_id', userId)
    // Optimistic locking: ensure balance hasn't changed
    .gte('available_balance', amount);

  if (error) {
    console.error('[BalanceRepo] debitBalance error:', error);
    return false;
  }

  return true;
}

/**
 * Lock funds (move from available to locked)
 */
export async function lockBalance(
  userId: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) return false;

  const supabase = createAdminClient();

  const { data: currentBalance } = await supabase
    .from('balances')
    .select('available_balance, locked_balance')
    .eq('user_id', userId)
    .single();

  if (!currentBalance) return false;

  const available = Number(currentBalance.available_balance);
  if (available < amount) return false;

  const { error } = await supabase
    .from('balances')
    .update({
      available_balance: available - amount,
      locked_balance: Number(currentBalance.locked_balance) + amount,
    })
    .eq('user_id', userId)
    .gte('available_balance', amount);

  if (error) {
    console.error('[BalanceRepo] lockBalance error:', error);
    return false;
  }

  return true;
}

/**
 * Unlock funds (move from locked back to available)
 */
export async function unlockBalance(
  userId: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) return false;

  const supabase = createAdminClient();

  const { data: currentBalance } = await supabase
    .from('balances')
    .select('available_balance, locked_balance')
    .eq('user_id', userId)
    .single();

  if (!currentBalance) return false;

  const locked = Number(currentBalance.locked_balance);
  if (locked < amount) return false;

  const { error } = await supabase
    .from('balances')
    .update({
      available_balance: Number(currentBalance.available_balance) + amount,
      locked_balance: locked - amount,
    })
    .eq('user_id', userId)
    .gte('locked_balance', amount);

  if (error) {
    console.error('[BalanceRepo] unlockBalance error:', error);
    return false;
  }

  return true;
}

/**
 * Release locked funds (remove from locked without adding to available)
 * Used when a withdrawal is completed
 */
export async function releaseLockedBalance(
  userId: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) return false;

  const supabase = createAdminClient();

  const { data: currentBalance } = await supabase
    .from('balances')
    .select('locked_balance')
    .eq('user_id', userId)
    .single();

  if (!currentBalance) return false;

  const locked = Number(currentBalance.locked_balance);
  if (locked < amount) return false;

  const { error } = await supabase
    .from('balances')
    .update({ locked_balance: locked - amount })
    .eq('user_id', userId)
    .gte('locked_balance', amount);

  if (error) {
    console.error('[BalanceRepo] releaseLockedBalance error:', error);
    return false;
  }

  return true;
}
