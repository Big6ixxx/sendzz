interface BitnobQuoteRequest {
  fromAsset: 'usdc';
  toCurrency: 'ngn';
  amount: number;
}

interface BitnobFinalizeRequest {
  bankDetails: {
    accountNumber: string;
    bankCode: string;
  };
}

interface BitnobCheckoutRequest {
  amount: number;
  reference: string;
  description?: string;
  customerEmail?: string;
  callbackUrl?: string;
  successUrl?: string;
}

export class BitnobClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.BITNOB_API_KEY || '';
    const isSimulation = process.env.NEXT_PUBLIC_SIMULATION_MODE === 'true';
    this.baseUrl = isSimulation
      ? 'https://sandboxapi.bitnob.co/api/v1'
      : 'https://api.bitnob.co/api/v1';
  }

  /**
   * Creates a checkout payment link.
   */
  async createCheckout(req: BitnobCheckoutRequest) {
    const res = await fetch(`${this.baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const errorText = await res.text();
      if (res.status === 403) {
        throw new Error(
          `Bitnob 403 Forbidden: Your IP may not be whitelisted or your API key lacks permissions. Check your Bitnob Dashboard Settings. Details: ${errorText}`,
        );
      }
      throw new Error(`Bitnob checkout failed (${res.status}): ${errorText}`);
    }
    return res.json();
  }

  /**
   * Retrieves a fixed-rate quote for moving USDC to NGN.
   */
  async createOfframpQuote(req: BitnobQuoteRequest) {
    const res = await fetch(`${this.baseUrl}/payouts/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      throw new Error(`Bitnob quote failed: ${await res.text()}`);
    }
    return res.json();
  }

  /**
   * Finalizes the quote, submitting Nigerian bank details.
   * In a real flow, this triggers the off-ramp execution and supplies a deposit address.
   */
  async finalizeQuote(quoteId: string, details: BitnobFinalizeRequest) {
    const res = await fetch(`${this.baseUrl}/payouts/${quoteId}/finalize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(details),
    });

    if (!res.ok) {
      throw new Error(`Bitnob finalize failed: ${await res.text()}`);
    }
    return res.json();
  }
}

let clientInstance: BitnobClient | null = null;
export function getBitnobClient() {
  if (!clientInstance) clientInstance = new BitnobClient();
  return clientInstance;
}
