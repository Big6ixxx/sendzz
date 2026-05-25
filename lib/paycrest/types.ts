export type PaycrestCurrency = string;

export interface PaycrestCurrencyDetail {
  code: string;
  name: string;
  country: string;
  symbol: string;
  channels: string[];
}
export type PaycrestNetwork = 'base' | 'polygon' | 'ethereum';
export type PaycrestOrderType = 'crypto' | 'fiat';
export type PaycrestOrderStatus =
  | 'initiated'
  | 'pending'
  | 'deposited'
  | 'validated'
  | 'settling'
  | 'settled'
  | 'refunding'
  | 'refunded'
  | 'expired';

export interface PaycrestInstitution {
  name: string;
  code: string;
  institutionCode: string;
  currency: PaycrestCurrency;
}

export interface PaycrestRecipient {
  institution?: string; // e.g. "GTBINGLA"
  accountIdentifier?: string; // Account number
  accountName?: string;
  memo?: string;
  address?: string; // Crypto wallet address
  network?: PaycrestNetwork;
}

export interface PaycrestOrderRequest {
  amount: string;
  amountIn?: 'fiat' | 'crypto';
  source: {
    type: PaycrestOrderType;
    currency: PaycrestCurrency;
    network?: PaycrestNetwork;
    refundAddress?: string;
    refundAccount?: {
      institution: string;
      accountIdentifier: string;
      accountName: string;
    };
  };
  destination: {
    type: PaycrestOrderType;
    currency: PaycrestCurrency;
    recipient: PaycrestRecipient;
  };
  reference: string;
}

export interface PaycrestProviderAccount {
  // Onramp fields
  institution?: string;
  accountIdentifier?: string;
  accountName?: string;
  amountToTransfer?: string;
  currency?: string;

  // Offramp fields
  network?: PaycrestNetwork;
  receiveAddress?: string;

  validUntil: string;
}

export interface PaycrestOrderResponse {
  id: string;
  status: PaycrestOrderStatus;
  providerAccount: PaycrestProviderAccount;
  source: {
    type: PaycrestOrderType;
    currency: PaycrestCurrency;
    network?: PaycrestNetwork;
  };
  destination: {
    type: PaycrestOrderType;
    currency: PaycrestCurrency;
  };
  amount: string;
  createdAt: string;
  txHash?: string;
  settlementTxHash?: string;
  transactionHash?: string;
}

export interface PaycrestRate {
  rate: number;
  provider_id: string;
  validUntil?: string;
}

export interface PaycrestRateResponse {
  data: {
    buy?: PaycrestRate; // Fiat -> Crypto
    sell?: PaycrestRate; // Crypto -> Fiat
  };
}

export interface PaycrestVerifyAccountResponse {
  status: 'success' | 'OK';
  message?: string;
  data: string | { accountName: string };
}
