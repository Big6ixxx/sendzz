/**
 * Provider-neutral fiat on/off-ramp types.
 *
 * The app talks to ramps through these types only — never to a specific provider's
 * SDK shapes. Each concrete provider (Bitnob, Paycrest) maps its own API into these.
 *
 * These intentionally mirror the shape the UI already consumed (the old Paycrest*
 * types) so the migration is a rename, not a rewrite.
 */

export type RampProviderName = "bitnob" | "paycrest";

/**
 * Minimal shape of a ledger row (withdrawal/deposit) used to route it back to the provider
 * that created it — e.g. for status polling. `resolveLedgerProvider` reads only these fields.
 */
export interface LedgerRowRef {
  provider?: string | null;
  provider_metadata?: unknown;
}

/** Fiat currency code, e.g. "NGN", "KES", "GHS". */
export type RampCurrency = string;

/**
 * Chain a ramp settles USDC on for fiat on/off-ramp. Not a fixed list — the supported
 * set is discovered at runtime from the active provider (see `Ramp.getSettlementNetworks`).
 * Common values: 'base' | 'polygon' | 'ethereum' | 'arbitrum' | 'optimism' | 'avalanche'.
 */
export type RampNetwork = string;

export type RampOrderType = "crypto" | "fiat";

/**
 * Neutral order lifecycle. Provider-specific states are normalised into these by each
 * adapter (e.g. Bitnob SETTLED → "settled", IN_PROGRESS → "settling").
 */
export type RampOrderStatus =
  | "initiated"
  | "pending"
  | "deposited"
  | "validated"
  | "settling"
  | "settled"
  | "refunding"
  | "refunded"
  | "failed"
  | "expired";

export interface RampInstitution {
  name: string;
  code: string;
  institutionCode: string;
  currency: RampCurrency;
}

export interface RampCurrencyDetail {
  code: string;
  name: string;
  country: string;
  symbol: string;
  channels: string[];
}

export interface RampRecipient {
  institution?: string;
  accountIdentifier?: string;
  accountName?: string;
  memo?: string;
  address?: string;
  network?: RampNetwork;
}

/**
 * What the user acts on after an order is created:
 * - off-ramp: `receiveAddress` (+ `network`) — where the user sends USDC.
 * - on-ramp:  `institution`/`accountIdentifier`/`accountName`/`amountToTransfer` — the
 *   bank/virtual account the user funds.
 */
export interface RampProviderAccount {
  // On-ramp (the bank/virtual account to pay into)
  institution?: string;
  accountIdentifier?: string;
  accountName?: string;
  amountToTransfer?: string;
  currency?: string;

  // Off-ramp (the address to send USDC to)
  network?: RampNetwork;
  receiveAddress?: string;

  validUntil: string;
}

export interface RampOrderResponse {
  id: string;
  /** Which provider actually created/owns this order — needed to route status + webhooks. */
  provider: RampProviderName;
  /** Provider-internal id needed for follow-up calls (e.g. Bitnob quote_id for finalize). */
  providerRef?: string;
  status: RampOrderStatus;
  providerAccount: RampProviderAccount;
  source: {
    type: RampOrderType;
    currency: RampCurrency;
    network?: RampNetwork;
  };
  destination: {
    type: RampOrderType;
    currency: RampCurrency;
  };
  amount: string;
  createdAt: string;
  txHash?: string;
  settlementTxHash?: string;
  transactionHash?: string;
}

export interface RampRate {
  rate: number;
  provider_id: string;
  validUntil?: string;
}

export interface RampRateResponse {
  data: {
    buy?: RampRate; // Fiat -> Crypto
    sell?: RampRate; // Crypto -> Fiat
  };
}

export interface RampVerifyAccountResponse {
  status: "success" | "OK";
  message?: string;
  data: string | { accountName: string };
}

export interface CreateOnRampParams {
  amountFiat: number;
  userId: string;
  userAddress: string;
  userEmail: string;
  refundAccount: {
    institution: string;
    accountIdentifier: string;
    accountName: string;
  };
  fiatCurrency: RampCurrency;
  /** Chain the purchased USDC is delivered to (the user's home chain). */
  network: RampNetwork;
}

export interface CreateOffRampParams {
  amountUsdc: number;
  /** When the user typed a fiat target, the fiat amount they want to receive. */
  fiatAmount?: number;
  inputMode: "fiat" | "usdc";
  bank: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  };
  userRefundAddress: string;
  userEmail: string;
  fiatCurrency: RampCurrency;
  /** Paycrest-style: the chain the user will send USDC from. */
  network: RampNetwork;
}

/**
 * Per-capability support flags. The router uses these to fall back to another provider
 * for capabilities the primary doesn't support (e.g. Bitnob has no bank-name lookup).
 */
export interface RampCapabilities {
  onRamp: boolean;
  offRamp: boolean;
  verifyAccount: boolean;
  institutions: boolean;
  currencies: boolean;
  rates: boolean;
}
