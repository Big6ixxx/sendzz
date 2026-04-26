import { 
  PaycrestOrderRequest, 
  PaycrestOrderResponse, 
  PaycrestRateResponse, 
  PaycrestVerifyAccountResponse,
  PaycrestInstitution
} from './types';

export class PaycrestClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.PAYCREST_API_KEY || '';
    this.baseUrl = process.env.NEXT_PUBLIC_PAYCREST_API_URL || 'https://api.paycrest.io';
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    console.log(`[Paycrest] Request: ${options.method || 'GET'} ${path}`);
    if (options.body) {
      console.log(`[Paycrest] Body:`, options.body);
    }

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
      console.error(`[Paycrest] Error (${res.status}): ${error}`);
      throw new Error(`Paycrest API Error (${res.status}): ${error}`);
    }

    const data = await res.json();
    console.log(`[Paycrest] Response:`, data);
    return data;
  }

  /**
   * Creates a payment order (On-ramp or Off-ramp)
   */
  async createOrder(order: PaycrestOrderRequest): Promise<PaycrestOrderResponse> {
    const res = await this.request<{ data: PaycrestOrderResponse }>('/v2/sender/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    });
    return res.data;
  }

  /**
   * Fetches real-time exchange rates
   */
  async getRates(
    network: string, 
    token: string, 
    amount: number, 
    fiat: string
  ): Promise<PaycrestRateResponse> {
    return this.request<PaycrestRateResponse>(`/v2/rates/${network}/${token}/${amount}/${fiat}`);
  }

  /**
   * Verifies a bank account and retrieves the owner's name
   */
  async verifyAccount(
    institution: string, 
    accountIdentifier: string, 
    currency: string = 'NGN'
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
    const res = await this.request<{ data: PaycrestOrderResponse }>(`/v2/sender/orders/${orderId}`);
    return res.data;
  }

  /**
   * Fetches supported institutions (banks) for a currency
   */
  async getInstitutions(currencyCode: string = 'NGN'): Promise<{ data: PaycrestInstitution[] }> {
    return this.request<{ data: PaycrestInstitution[] }>(`/v2/institutions/${currencyCode}`);
  }
}

let clientInstance: PaycrestClient | null = null;
export function getPaycrestClient() {
  if (!clientInstance) clientInstance = new PaycrestClient();
  return clientInstance;
}
