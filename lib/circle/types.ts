/**
 * Circle API Types
 *
 * TypeScript interfaces for Circle Gateway and Paymaster.
 */

// ===========================================
// GATEWAY TYPES (Cross-chain USDC)
// ===========================================

export interface GatewayTransferRequest {
  sourceChain: string;
  destinationChain: string;
  amount: string;
  destinationAddress: string;
}

export interface GatewayTransferResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  sourceChain: string;
  destinationChain: string;
  amount: string;
  destinationAddress: string;
  txHash?: string;
  createdAt: string;
}

// ===========================================
// PAYMASTER TYPES (USDC Gas Fees)
// ===========================================

export interface PaymasterConfig {
  chainId: number;
  paymasterAddress: string;
  entryPointAddress: string;
}

// Supported chains for Circle Paymaster
export const PAYMASTER_CHAINS: Record<string, PaymasterConfig> = {
  // Note: Circle Paymaster is ERC-4337 and works on EVM chains
  // For Solana, we use BlockRadar's native gasless feature instead
  arbitrum: {
    chainId: 42161,
    paymasterAddress: '0x...',
    entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  },
  base: {
    chainId: 8453,
    paymasterAddress: '0x...',
    entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  },
};

// ===========================================
// CLIENT OPTIONS
// ===========================================

export interface CircleClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}
