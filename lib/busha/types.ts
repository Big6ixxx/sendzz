export interface BushaConfig {
  apiKey: string;
  webhookSecret: string;
}

export interface BushaChargeRequest {
  local_price: {
    amount: number;
    currency: string;
  };
  redirect_url: string;
  cancel_url: string;
  metadata: {
    userId: string;
    amountUsdc: number;
    reference: string;
  };
}

export interface BushaChargeResponse {
  data: {
    id: string;
    hosted_url: string;
    created_at: string;
    local_price: {
      amount: number;
      currency: string;
    };
  };
}

export interface BushaWebhookPayload {
  event: 'charge:confirmed' | 'charge:failed' | 'charge:delayed';
  data: {
    id: string;
    status: string;
    metadata: {
      userId: string;
      amountUsdc: number;
      reference: string;
    };
    pricing: {
      local: {
        amount: number;
        currency: string; // NGN
      };
    };
  };
}
