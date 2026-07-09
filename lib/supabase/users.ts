'use server';

import { supabaseAdmin } from './adminClient';

export async function getUserAddressByEmail(
  email: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('smart_account_address')
    .eq('email', email)
    .single();

  if (error || !data) return null;
  return data.smart_account_address;
}

export async function registerUserAddress(
  email: string,
  address: string,
  solanaAddress?: string,
): Promise<void> {
  const row: { email: string; smart_account_address: string; solana_address?: string } = {
    email,
    smart_account_address: address,
  };
  if (solanaAddress) row.solana_address = solanaAddress;

  const { error } = await supabaseAdmin
    .from('users')
    .upsert(row, { onConflict: 'email' });

  if (error) throw new Error(`Failed to map address: ${error.message}`);
}
