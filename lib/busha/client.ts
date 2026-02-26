import crypto from 'crypto';
import type {
    BushaChargeRequest,
    BushaChargeResponse,
    BushaConfig,
} from './types';

export class BushaClient {
  private config: BushaConfig;
  private baseUrl = 'https://api.busha.co/v1/commerce/charges';

  constructor(config: BushaConfig) {
    this.config = config;
  }

  /**
   * Create a new charge for fiat deposit
   */
  async createCharge(
    request: BushaChargeRequest,
  ): Promise<BushaChargeResponse> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Busha-Api-Key': this.config.apiKey,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Busha API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Validates the webhook signature from Busha
   */
  validateWebhookSignature(payload: string, signature: string): boolean {
    const hash = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
  }
}

// Singleton instance getter
let bushaClient: BushaClient | null = null;

export function getBushaClient(): BushaClient {
  if (!bushaClient) {
    const apiKey = process.env.BUSHA_API_KEY;
    const webhookSecret = process.env.BUSHA_WEBHOOK_SECRET;

    if (!apiKey || !webhookSecret) {
      console.warn(
        'Busha credentials missing. Ensure BUSHA_API_KEY and BUSHA_WEBHOOK_SECRET are set',
      );
    }

    bushaClient = new BushaClient({
      apiKey: apiKey || 'mock_key',
      webhookSecret: webhookSecret || 'mock_secret',
    });
  }

  return bushaClient;
}
