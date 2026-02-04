/**
 * Paycrest Orders API
 *
 * Endpoints for managing sender payment orders (payouts).
 */

import { getPaycrestClient } from './client';
import type {
    CreateOrderRequest,
    Order,
    OrdersListResponse,
    SenderStats,
} from './types';

/**
 * Create a new payout order
 * POST /sender/orders
 */
export async function createPayoutOrder(
  request: CreateOrderRequest,
): Promise<Order> {
  const client = getPaycrestClient();
  return client.post<Order>('/sender/orders', request);
}

/**
 * Get a single payout order by ID
 * GET /sender/orders/{id}
 */
export async function getPayoutOrder(orderId: string): Promise<Order> {
  const client = getPaycrestClient();
  return client.get<Order>(`/sender/orders/${orderId}`);
}

/**
 * List payout orders with optional pagination
 * GET /sender/orders
 */
export async function listPayoutOrders(options?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<OrdersListResponse> {
  const client = getPaycrestClient();
  const params = new URLSearchParams();

  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.status) params.set('status', options.status);

  const query = params.toString();
  const endpoint = query ? `/sender/orders?${query}` : '/sender/orders';

  return client.get<OrdersListResponse>(endpoint);
}

/**
 * Get sender statistics
 * GET /sender/stats
 */
export async function getSenderStats(): Promise<SenderStats> {
  const client = getPaycrestClient();
  return client.get<SenderStats>('/sender/stats');
}
