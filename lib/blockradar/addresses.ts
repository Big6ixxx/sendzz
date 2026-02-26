/**
 * BlockRadar Addresses API
 *
 * Functions for creating and managing user deposit addresses.
 * Only Solana addresses are used — cross-chain deposits are handled by Circle CCTP.
 */

import { getBlockRadarSolanaClient } from './client';
import type { CreateAddressRequest, CreateAddressResponse } from './types';

/**
 * Create a dedicated Solana deposit address for a user via BlockRadar.
 * Cross-chain USDC deposits use Circle CCTP and are bridged to this address automatically.
 */
export async function createUserAddress(
  userId: string,
  userName?: string,
): Promise<{
  addressId: string;
  solanaAddress: string;
}> {
  const request: CreateAddressRequest = {
    name: userName || `User ${userId.slice(0, 8)}`,
    metadata: {
      user_id: userId,
      created_at: new Date().toISOString(),
    },
    enableGaslessWithdraw: true,
    disableAutoSweep: false,
  };

  const solanaClient = getBlockRadarSolanaClient();
  const solanaWalletId = solanaClient.getWalletId();

  try {
    const solanaResponse = await solanaClient.post<CreateAddressResponse>(
      `/wallets/${solanaWalletId}/addresses`,
      request,
    );
    return {
      addressId: solanaResponse.id,
      solanaAddress: solanaResponse.address,
    };
  } catch (e) {
    throw new Error(`Solana wallet creation failed: ${e}`);
  }
}

/**
 * Get address details by address ID.
 */
export async function getAddressById(
  addressId: string,
): Promise<CreateAddressResponse | null> {
  try {
    const solanaClient = getBlockRadarSolanaClient();
    const solanaWalletId = solanaClient.getWalletId();
    return await solanaClient.get<CreateAddressResponse>(
      `/wallets/${solanaWalletId}/addresses/${addressId}`,
    );
  } catch {
    return null;
  }
}
