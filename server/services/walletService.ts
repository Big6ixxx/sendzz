/**
 * Wallet Service
 *
 * Manages user wallet creation and BlockRadar Solana address assignment.
 * Cross-chain USDC deposits are handled by Circle CCTP, not per-chain EVM addresses.
 */

import { createUserAddress } from '@/lib/blockradar';
import { createAdminClient } from '@/lib/supabase/server';

export interface CreateWalletResult {
  success: boolean;
  solanaAddress?: string;
  error?: string;
}

/**
 * Create a BlockRadar Solana wallet address for a user.
 *
 * Called when a user first logs in or signs up.
 * EVM chains are handled via Circle CCTP using the same Solana address.
 */
export async function createUserWallet(
  userId: string,
  userEmail?: string,
): Promise<CreateWalletResult> {
  const supabase = createAdminClient();

  const { data: userData, error: fetchError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchError) {
    console.error('[WalletService] Error fetching user:', fetchError);
    return { success: false, error: 'Failed to fetch user' };
  }

  const profile = userData as Record<string, unknown> | null;
  if (profile?.solana_address) {
    return {
      success: true,
      solanaAddress: profile.solana_address as string,
    };
  }

  try {
    const { addressId, solanaAddress } = await createUserAddress(
      userId,
      userEmail,
    );

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        blockradar_address_id: addressId,
        solana_address: solanaAddress,
      } as Record<string, unknown>)
      .eq('id', userId);

    if (updateError) {
      console.error('[WalletService] Error updating user:', updateError);
      return { success: false, error: 'Failed to save wallet info' };
    }

    return { success: true, solanaAddress };
  } catch (error) {
    console.error('[WalletService] Error creating wallet:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a user's Solana deposit address.
 */
export async function getUserWalletAddress(
  userId: string,
): Promise<{ solanaAddress: string | null }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) {
    return { solanaAddress: null };
  }

  const profile = data as Record<string, unknown>;
  return {
    solanaAddress: (profile.solana_address as string) || null,
  };
}
