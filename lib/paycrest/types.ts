/**
 * Paycrest API Types
 * Based on: https://api.paycrest.io/v1
 */

// ===========================================
// COMMON TYPES
// ===========================================

export interface PaycrestError {
  status: 'error';
  message: string;
  code?: string;
}

export interface PaycrestSuccess<T> {
  status: 'success';
  data: T;
}

export type PaycrestResponse<T> = PaycrestSuccess<T> | PaycrestError;

// ===========================================
// CURRENCIES
// ===========================================

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  minAmount: number;
  maxAmount: number;
}

export interface CurrenciesResponse {
  currencies: Currency[];
}

// ===========================================
// INSTITUTIONS (BANKS)
// ===========================================

export interface Institution {
  code: string;
  name: string;
  type: 'bank' | 'mobile_money' | 'other';
}

export interface InstitutionsResponse {
  institutions: Institution[];
}

// ===========================================
// SENDER ORDERS (PAYOUTS)
// ===========================================

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'settled'
  | 'failed'
  | 'refunded';

export interface RecipientDetails {
  /** Bank institution code */
  institutionCode: string;
  /** Bank account number */
  accountNumber: string;
  /** Account holder name (optional for name verification) */
  accountName?: string;
}

export interface CreateOrderRequest {
  /** Amount in stablecoin (USDC) */
  amount: string;
  /** Stablecoin token (e.g., 'USDC') */
  token: string;
  /** Blockchain network (e.g., 'base', 'polygon', 'arbitrum') */
  network?: string;
  /** Target fiat currency code (e.g., 'NGN', 'KES') */
  currency: string;
  /** Recipient bank/mobile money details */
  recipient: RecipientDetails;
  /** Unique reference for idempotency */
  reference?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface Order {
  id: string;
  reference: string;
  status: OrderStatus;
  token: string;
  amount: string;
  amountReceived?: string;
  currency: string;
  fiatAmount?: string;
  rate?: string;
  fee?: string;
  recipient: RecipientDetails;
  settlementAddress?: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface OrdersListResponse {
  orders: Order[];
  total: number;
  page: number;
  limit: number;
}

export interface SenderStats {
  totalOrders: number;
  pendingOrders: number;
  settledOrders: number;
  failedOrders: number;
  totalVolume: string;
  totalFees: string;
}

// ===========================================
// WEBHOOKS
// ===========================================

export type WebhookEventType =
  | 'order.pending'
  | 'order.processing'
  | 'order.settled'
  | 'order.failed'
  | 'order.refunded';

export interface WebhookPayload {
  eventId: string;
  eventType: WebhookEventType;
  timestamp: string;
  data: Order;
}

// ===========================================
// API CLIENT OPTIONS
// ===========================================

export interface PaycrestClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}
