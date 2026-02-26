/**
 * BlockRadar API Types
 *
 * TypeScript interfaces for BlockRadar API requests and responses.
 * API Base URL: https://api.blockradar.co/v1
 */

// ===========================================
// COMMON TYPES
// ===========================================

export interface BlockRadarError {
  statusCode: number;
  message: string;
  error?: string;
}

export interface BlockRadarSuccess<T> {
  statusCode: number;
  message: string;
  data: T;
}

export type BlockRadarResponse<T> = BlockRadarSuccess<T> | BlockRadarError;

export interface BlockRadarMeta {
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  totalPages: number;
  currentPage: number;
}

// ===========================================
// BLOCKCHAIN TYPES
// ===========================================

export interface Blockchain {
  id: string;
  name: string;
  slug: string;
  symbol: string;
  isEvmCompatible: boolean;
  tokenStandard: string;
  logoUrl: string;
  isActive: boolean;
  derivationPath: string;
  createdAt: string;
  updatedAt: string;
}

// ===========================================
// ADDRESS TYPES
// ===========================================

export interface AddressConfiguration {
  disableAutoSweep: boolean;
  enableGaslessWithdraw: boolean;
  showPrivateKey: boolean;
  aml?: {
    status: string;
    message: string;
    provider: string;
  };
}

export interface Address {
  id: string;
  address: string;
  name?: string;
  network: 'testnet' | 'mainnet';
  type: 'INTERNAL' | 'EXTERNAL';
  derivationPath: string;
  blockchain: Blockchain;
  configurations: AddressConfiguration;
  metadata?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAddressRequest {
  name?: string;
  metadata?: Record<string, unknown>;
  disableAutoSweep?: boolean;
  enableGaslessWithdraw?: boolean;
  showPrivateKey?: boolean;
}

export interface CreateAddressResponse {
  address: string;
  id: string;
  name?: string;
  network: 'testnet' | 'mainnet';
  blockchain: Blockchain;
  configurations: AddressConfiguration;
  metadata?: Record<string, unknown>;
  derivationPath: string;
  type: 'INTERNAL';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ===========================================
// WITHDRAWAL TYPES
// ===========================================

export interface WithdrawalRequest {
  address: string;
  amount: string;
  asset: string;
  metadata?: Record<string, unknown>;
}

export interface WithdrawalResponse {
  id: string;
  amount: string;
  fee: string;
  asset: string;
  address: string;
  hash?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  network: 'testnet' | 'mainnet';
  createdAt: string;
}

// ===========================================
// WALLET TYPES
// ===========================================

export interface Wallet {
  id: string;
  name: string;
  blockchain: Blockchain;
  address: string;
  network: 'testnet' | 'mainnet';
  isActive: boolean;
  configurations: {
    autoSweep: boolean;
    autoSweepThreshold: string;
    gaslessTransaction: boolean;
    gaslessThreshold: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ===========================================
// WEBHOOK TYPES
// ===========================================

export type WebhookEventType =
  | 'deposit.success'
  | 'deposit.pending'
  | 'withdrawal.success'
  | 'withdrawal.failed'
  | 'sweep.success'
  | 'sweep.failed';

export interface WebhookPayload {
  event: WebhookEventType;
  data: {
    id: string;
    amount: string;
    asset: string;
    address: string;
    hash: string;
    network: 'testnet' | 'mainnet';
    metadata?: Record<string, unknown>;
    createdAt: string;
  };
}

// ===========================================
// CLIENT OPTIONS
// ===========================================

export interface BlockRadarClientOptions {
  apiKey: string;
  walletId: string;
  baseUrl?: string;
  timeout?: number;
}
