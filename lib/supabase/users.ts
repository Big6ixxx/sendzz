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
  stellarAddress?: string,
  stellarWalletId?: string,
  stellarSignerGranted?: boolean,
): Promise<void> {
  const row: {
    email: string;
    smart_account_address: string;
    solana_address?: string;
    stellar_address?: string;
    stellar_wallet_id?: string;
    stellar_signer_granted?: boolean;
  } = {
    email,
    smart_account_address: address,
  };
  if (solanaAddress) row.solana_address = solanaAddress;
  if (stellarAddress) row.stellar_address = stellarAddress;
  if (stellarWalletId) row.stellar_wallet_id = stellarWalletId;
  if (stellarSignerGranted !== undefined) row.stellar_signer_granted = stellarSignerGranted;

  const { error } = await supabaseAdmin
    .from('users')
    .upsert(row, { onConflict: 'email' });

  if (error) throw new Error(`Failed to map address: ${error.message}`);
}

export async function registerStellarAddress(
  email: string,
  stellarAddress: string,
  stellarWalletId: string,
  stellarSignerGranted?: boolean,
  privyUserId?: string,
): Promise<void> {
  const row: {
    email: string;
    stellar_address: string;
    stellar_wallet_id: string;
    stellar_signer_granted?: boolean;
  } = {
    email,
    stellar_address: stellarAddress,
    stellar_wallet_id: stellarWalletId,
  };
  if (stellarSignerGranted !== undefined) {
    row.stellar_signer_granted = stellarSignerGranted;
  }

  const { error } = await supabaseAdmin
    .from('users')
    .upsert(row, { onConflict: 'email' });

  if (error) throw new Error(`Failed to map Stellar address: ${error.message}`);
}

export async function getUserAddresses(
  email: string,
  privyUserId?: string,
): Promise<{
  smart_account_address: string | null;
  solana_address: string | null;
  stellar_address: string | null;
  stellar_wallet_id: string | null;
  stellar_signer_granted: boolean;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('smart_account_address, solana_address, stellar_address, stellar_wallet_id, stellar_signer_granted')
    .eq('email', email)
    .maybeSingle();

  if (error || !data) return null;

  return {
    smart_account_address: data.smart_account_address,
    solana_address: data.solana_address,
    stellar_address: data.stellar_address,
    stellar_wallet_id: data.stellar_wallet_id,
    stellar_signer_granted: !!data.stellar_signer_granted,
  };
}
