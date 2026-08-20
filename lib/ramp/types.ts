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
  /**
   * Fiat the beneficiary receives, per the provider quote this order was created from — the
   * ONLY authoritative payout figure. The ledger records it and the receipt shows it, so what
   * the user is promised, what the provider pays, and what the receipt says are one number.
   *
   * Absent when the provider does not report a destination amount (Paycrest settles the rate
   * it quoted, so the caller's rate × amount stands in).
   */
  fiatAmount?: string;
  /** Fiat per 1 USDC that `fiatAmount` was struck at. */
  fiatRate?: number;
  createdAt: string;
  txHash?: string;
  settlementTxHash?: string;
  transactionHash?: string;
  /**
   * Platform fee for this order, resolved server-side from the fee config so the client can
   * execute it without reading secret env. `usdc` is the fee amount on top of `amount` (base).
   * `onchain` collection carries the treasury `address`; `provider` collection is skimmed by
   * the provider (client just sends base + fee to the single receive address).
   */
  fee?: {
    percent: number;
    usdc: string;
    collection: "provider" | "onchain";
    address?: string;
  };
  /** Bitnob corridor fee in USDC (e.g. "0.3" for RWF mobile money, "0" for NGN). */
  bitnobFee?: string;
  /**
   * True when the provider has a quote but no payout yet: the beneficiary is attached only
   * after the user's deposit is verified. The client must call the deferred-settle action once
   * its transfer confirms, or nothing will pay out.
   */
  deferredInitialize?: boolean;
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
  /**
   * Did the provider confirm the account HOLDER, or only that the identifier is well-formed?
   *
   * False for mobile-money rails, where no name-enquiry endpoint exists — the UI must not
   * present those as a verified account holder.
   */
  nameVerified?: boolean;
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
    memo?: string;
  };
  userRefundAddress: string;
  userEmail: string;
  fiatCurrency: RampCurrency;
  /** Paycrest-style: the chain the user will send USDC from. */
  network: RampNetwork;
  /**
   * A quote already struck for this withdrawal (see `quoteOffRamp`), to settle at the exact
   * rate the user was shown rather than re-quoting at whatever the rate has since moved to.
   * Ignored — and a fresh quote taken — if it has expired or no longer matches the amount.
   */
  quoteId?: string;
  /**
   * The order reference that quote was created under. Reusing a quote MUST reuse its
   * reference, or the payout is initialized under a reference the quote never carried.
   */
  quoteReference?: string;
}

/** Ask a provider what it will actually pay out, before any order exists. */
export interface QuoteOffRampParams {
  amountUsdc: number;
  fiatCurrency: RampCurrency;
  /** Chain the USDC will settle on — providers can price per chain. */
  network: RampNetwork;
}

/**
 * A provider's answer to "what does the beneficiary get for this much USDC".
 *
 * `binding: true` means it came from a real payout quote and is the figure that will settle.
 * `binding: false` means it is an indicative mid-market rate — better than nothing for a
 * provider with no quote endpoint, but it must never be presented as a guarantee.
 */
export interface RampPayoutQuote {
  provider: RampProviderName;
  /** Fiat per 1 USDC. */
  rate: number;
  /** Fiat the beneficiary receives for `amountUsdc`. */
  payoutAmount: number;
  binding: boolean;
  /** Provider quote id, when the quote is a real one that order creation can reuse. */
  quoteId?: string;
  /** Order reference the quote was struck under — must travel with `quoteId`. */
  reference?: string;
  expiresAt?: string;
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
