/**
 * BlockRadar Withdrawals API
 *
 * Functions for initiating withdrawals from the master wallet.
 */

import { getBlockRadarClient } from './client';
import type { WithdrawalRequest, WithdrawalResponse } from './types';

/**
 * Initiate a withdrawal from the BlockRadar master wallet.
 *
 * This is used to send USDC to Paycrest for fiat conversion.
 *
 * @param destinationAddress - The Paycrest receive address
 * @param amount - Amount in USDC to withdraw
 * @param metadata - Optional metadata for the withdrawal
 */
export async function initiateWithdrawal(
  destinationAddress: string,
  amount: string,
  metadata?: Record<string, unknown>,
): Promise<{ withdrawalId: string; status: string }> {
  // Production mode: call BlockRadar API
  const client = getBlockRadarClient();
  const walletId = client.getWalletId();

  const request: WithdrawalRequest = {
    address: destinationAddress,
    amount,
    asset: 'USDC',
    metadata,
  };

  const response = await client.post<WithdrawalResponse>(
    `/wallets/${walletId}/withdraw`,
    request,
  );

  return {
    withdrawalId: response.id,
    status: response.status,
  };
}

/**
 * Get withdrawal status by ID.
 */
export async function getWithdrawalStatus(
  withdrawalId: string,
): Promise<WithdrawalResponse | null> {
  try {
    const client = getBlockRadarClient();
    const walletId = client.getWalletId();
    return await client.get<WithdrawalResponse>(
      `/wallets/${walletId}/withdrawals/${withdrawalId}`,
    );
  } catch {
    return null;
  }
}
