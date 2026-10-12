import { toUserSafeMessage } from '@/lib/errors/sanitize';
import {
  PaycrestCurrencyDetail,
  PaycrestInstitution,
  PaycrestOrderRequest,
  PaycrestOrderResponse,
  PaycrestRateResponse,
  PaycrestVerifyAccountResponse,
} from './types';

export class PaycrestClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.PAYCREST_API_KEY || '';
    this.baseUrl =
      process.env.NEXT_PUBLIC_PAYCREST_API_URL || 'https://api.paycrest.io';
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    // Only failures are logged. Successful calls happen on every rate lookup and page load,
    // and a line per request buried the ones that mattered. Bodies are never logged: an
    // off-ramp order carries the customer's bank account number and name.
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const error = await res.text();
      let detail = '';
      try {
        const parsed = JSON.parse(error) as { message?: string; detail?: string };
        detail = (parsed.message || parsed.detail || '').trim();
      } catch {
        /* not JSON: gateway failures arrive as a full Cloudflare HTML page */
      }
      // One line with the reason. An HTML error page is reduced to its status, never echoed.
      console.error(
        `[Paycrest] ${options.method || 'GET'} ${path} failed (${res.status})` +
          (detail ? `: ${detail}` : error.trimStart().startsWith('<') ? '' : `: ${error.slice(0, 200)}`),
      );
      if (res.status >= 500) {
        throw Object.assign(
          new Error('That service is temporarily unavailable. Please try again shortly.'),
          { status: res.status },
        );
      }
      throw Object.assign(
        new Error(
          toUserSafeMessage(detail) ?? "We couldn't complete that request. Please try again shortly.",
        ),
        { status: res.status },
      );
    }

    return (await res.json()) as T;
  }

  /**
   * Creates a payment order (On-ramp or Off-ramp)
   */
  async createOrder(
    order: PaycrestOrderRequest,
  ): Promise<PaycrestOrderResponse> {
    const res = await this.request<{ data: PaycrestOrderResponse }>(
      '/v2/sender/orders',
      {
        method: 'POST',
        body: JSON.stringify(order),
      },
    );
    return res.data;
  }

  /**
   * Fetches real-time exchange rates
   */
  async getRates(
    network: string,
    token: string,
    amount: number,
    fiat: string,
  ): Promise<PaycrestRateResponse> {
    return this.request<PaycrestRateResponse>(
      `/v2/rates/${network}/${token}/${amount}/${fiat}`,
    );
  }

  /**
   * Verifies a bank account and retrieves the owner's name
   */
  async verifyAccount(
    institution: string,
    accountIdentifier: string,
    currency: string = 'NGN',
  ): Promise<PaycrestVerifyAccountResponse> {
    return this.request<PaycrestVerifyAccountResponse>('/v2/verify-account', {
      method: 'POST',
      body: JSON.stringify({ institution, accountIdentifier, currency }),
    });
  }

  /**
   * Retrieves status of an existing order
   */
  async getOrder(orderId: string): Promise<PaycrestOrderResponse> {
    const res = await this.request<{ data: PaycrestOrderResponse }>(
      `/v2/sender/orders/${orderId}`,
    );
    return res.data;
  }

  /**
   * Fetches supported fiat currencies
   */
  async getCurrencies(): Promise<{ data: PaycrestCurrencyDetail[] }> {
    return this.request<{ data: PaycrestCurrencyDetail[] }>('/v2/currencies');
  }

  /**
   * Fetches supported institutions (banks) for a currency
   */
  async getInstitutions(
    currencyCode: string = 'NGN',
  ): Promise<{ data: PaycrestInstitution[] }> {
    return this.request<{ data: PaycrestInstitution[] }>(
      `/v2/institutions/${currencyCode}`,
    );
  }
}

let clientInstance: PaycrestClient | null = null;
export function getPaycrestClient() {
  if (!clientInstance) clientInstance = new PaycrestClient();
  return clientInstance;
}
