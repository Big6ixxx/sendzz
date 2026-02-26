/**
 * Circle Paymaster (ERC-4337)
 *
 * USDC gas fee handling using Circle Paymaster (ERC-4337).
 * Provides the `paymasterAndData` needed for a UserOperation to be sponsored.
 */

import { PAYMASTER_CHAINS } from './types';

// Simplified ERC-4337 UserOperation type for the Paymaster service
export interface UserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  signature: string;
}

export interface PaymasterResult {
  paymasterAndData: string;
  preVerificationGas: string;
  verificationGasLimit: string;
  callGasLimit: string;
}

/**
 * Request gas sponsorship from Circle's Paymaster API.
 *
 * @param userOp The unsigned ERC-4337 UserOperation
 * @param chainName The EVM chain (e.g. 'base', 'arbitrum', 'polygon')
 */
export async function getPaymasterAndData(
  userOp: UserOperation,
  chainName: string,
): Promise<PaymasterResult> {
  const config = PAYMASTER_CHAINS[chainName.toLowerCase()];
  if (!config) {
    throw new Error(`Paymaster not configured for chain: ${chainName}`);
  }

  // Uses Circle's Gas Station / Paymaster API RPC interface
  const paymasterUrl = `https://api.circle.com/v1/w3s/developer/transactions/sponsor`;
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error('Missing CIRCLE_API_KEY environment variable');
  }

  const response = await fetch(paymasterUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'pm_sponsorUserOperation',
      params: [userOp, config.entryPointAddress],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to fetch paymasterAndData: ${err}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Paymaster RPC Error: ${data.error.message}`);
  }

  return {
    paymasterAndData: data.result.paymasterAndData,
    preVerificationGas: data.result.preVerificationGas,
    verificationGasLimit: data.result.verificationGasLimit,
    callGasLimit: data.result.callGasLimit,
  };
}

/**
 * Check if Paymaster is available for a given chain.
 */
export function isPaymasterAvailable(chainName: string): boolean {
  return chainName.toLowerCase() in PAYMASTER_CHAINS;
}

/**
 * Note: For Solana transactions, we use BlockRadar's gasless feature
 * which is enabled per-address. This module is specifically for EVM.
 */
export function getSolanaGasHandling(): {
  method: 'blockradar-gasless';
  description: string;
} {
  return {
    method: 'blockradar-gasless',
    description:
      'Solana gas fees are handled by BlockRadar gasless transactions. ' +
      'The master wallet covers gas fees for user withdrawals.',
  };
}

/**
 * Check if the system is configured for gasless transactions globally.
 */
export function isGaslessEnabled(): boolean {
  return true; // We enable gasless by default in production
}
