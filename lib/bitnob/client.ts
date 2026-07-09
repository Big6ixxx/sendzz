/**
 * Bitnob API client (https://bitnob.dev/api-reference).
 *
 * Covers the endpoints Sendzz uses for off-ramp + rates + status + deposit addresses.
 * On-ramp (fiat virtual accounts), bank verification, and institutions lists are not
 * exposed by Bitnob here — those capabilities fall back to Paycrest (see lib/ramp).
 *
 * Auth: HMAC-SHA256 request signing (https://bitnob.dev/api-reference/authentication).
 * Four headers — x-auth-client (CLIENT_ID), x-auth-timestamp (unix SECONDS), x-auth-nonce
 * (16-byte hex), x-auth-signature — where the signature is
 * hex( HMAC-SHA256(SECRET, `${CLIENT_ID}:${TIMESTAMP}:${NONCE}:${BODY}`) ).
 * BODY is the raw request body (empty string for GET). Method and path are NOT signed.
 * (Per Bitnob's official JS sample: colon-separated, seconds, hex, body included.)
 */
import crypto from "crypto";

// ── Request/response shapes (subset we use) ──────────────────────────────────
export interface BitnobPayoutQuoteRequest {
  amount: string;
  country: string;
  from_asset: "USDC";
  to_currency: string;
  source: "offchain" | "onchain";
  chain: string; // e.g. "erc20" / network token standard
  reference: string;
}

export interface BitnobExchangeRate {
  rate?: string;
  currency?: string;
}

export interface BitnobPayoutQuote {
  id: string;
  quote_id: string;
  status: string;
  from_asset: string;
  to_currency: string;
  amount: string;
  settlement_amount?: string;
  fees?: string;
  exchange_rate?: BitnobExchangeRate;
  expires_at?: string;
  created_at?: string;
}

/**
 * Beneficiary schema is destination-type specific (bank → account/bank_code,
 * mobile_money → phone/provider, swift → swift_code/bank address + sender KYC, …).
 * Kept open so each rail can supply its own fields.
 */
export interface BitnobBeneficiary {
  destination_type: string;
  country: string;
  account_name: string;
  account_number?: string;
  bank_code?: string;
  [key: string]: unknown;
}

export interface BitnobPayout {
  id: string;
  quote_id: string;
  status: string;
  from_asset?: string;
  to_currency?: string;
  amount?: string;
  settlement_amount?: string;
  reference?: string;
  expires_at?: string;
  created_at?: string;
  provider_settlement_id?: string;
  // The on-chain deposit address the user must fund is returned by `initialize`
  // itself (per Bitnob's live payout example). Exact key is unconfirmed against a
  // live payload, so read defensively via `depositAddressOf()`.
  address?: string;
  deposit_address?: string;
  payment_address?: string;
  onchain_address?: string;
  chain?: string;
}

/** Pull the fundable deposit address out of an initialize/payout response, whatever it's keyed as. */
export function depositAddressOf(p: BitnobPayout): string | undefined {
  return p.address || p.deposit_address || p.payment_address || p.onchain_address || undefined;
}

export interface BitnobAddress {
  id: string;
  chain: string;
  address: string;
  status: string;
  label?: string;
  reference?: string;
}

export interface BitnobTransaction {
  transaction_id: string;
  reference: string;
  type: string;
  state: "PENDING" | "IN_PROGRESS" | "SETTLED" | "FAILED" | "REVERSED";
  amount: string;
  currency: string;
  created_at: string;
}

export interface BitnobRatesResponse {
  base_currency?: string;
  target_currency?: string;
  buy_rate?: string | number;
  sell_rate?: string | number;
  mid_rate?: string | number;
}

export interface BitnobCorridor {
  currency: string;
  destination_types: string[];
}

export interface BitnobCountry {
  code: string;
  name: string;
  flag?: string;
  dial_code?: string;
  corridors: BitnobCorridor[];
}

export interface BitnobChain {
  chain: string;
  name?: string;
  native_token?: { symbol?: string; decimals?: number };
  stablecoins?: { symbol: string }[] | string[];
}

export interface BitnobBank {
  name?: string;
  bank_name?: string;
  code?: string;
  bank_code?: string;
}

export interface BitnobAccountLookup {
  account_name?: string;
  account_number?: string;
  bank_code?: string;
  bank_name?: string;
  country?: string;
  is_verified?: boolean;
}

export class BitnobClient {
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;

  constructor() {
    this.clientId = process.env.BITNOB_CLIENT_ID || "";
    // Bitnob's "Secret Key" (a.k.a. CLIENT_SECRET). Legacy var names accepted as fallback.
    this.clientSecret =
      process.env.BITNOB_SECRET_KEY ||
      process.env.BITNOB_API_SECRET ||
      process.env.BITNOB_API_KEY ||
      "";
    // Sandbox and production share one base URL; only the key pair differs.
    this.baseUrl = process.env.BITNOB_API_URL || "https://api.bitnob.com";
  }

  /** hex( HMAC-SHA256(SECRET, `${CLIENT_ID}:${TIMESTAMP_S}:${NONCE}:${BODY}`) ). */
  private authHeaders(body: string): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000).toString(); // seconds
    const nonce = crypto.randomBytes(16).toString("hex");
    const stringToSign = `${this.clientId}:${ts}:${nonce}:${body}`;
    const signature = crypto
      .createHmac("sha256", this.clientSecret)
      .update(stringToSign)
      .digest("hex");
    return {
      "x-auth-client": this.clientId,
      "x-auth-timestamp": ts,
      "x-auth-nonce": nonce,
      "x-auth-signature": signature,
    };
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    // The signed payload is the exact raw body sent (empty string for GET).
    const body = typeof options.body === "string" ? options.body : "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.authHeaders(body),
      ...(options.headers as Record<string, string> | undefined),
    };

    const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Bitnob ${options.method || "GET"} ${path} failed (${res.status}): ${errorText}`);
    }
    const json = await res.json();
    return json as T;
  }

  /** Unwraps Bitnob's `{ success, data }` envelope when present. */
  private unwrap<T>(res: unknown): T {
    if (res && typeof res === "object" && "data" in res) {
      return (res as { data: T }).data;
    }
    return res as T;
  }

  async getRates(from: string, to: string): Promise<BitnobRatesResponse> {
    const res = await this.request<unknown>(
      `/api/exchange-rates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    return this.unwrap<BitnobRatesResponse>(res);
  }

  async createPayoutQuote(req: BitnobPayoutQuoteRequest): Promise<BitnobPayoutQuote> {
    const res = await this.request<unknown>(`/api/payouts/quotes`, {
      method: "POST",
      body: JSON.stringify(req),
    });
    // The quote is nested under `data.payout` (see live response), not `data` directly.
    const data = this.unwrap<{ payout?: BitnobPayoutQuote }>(res);
    return (data?.payout ?? (data as unknown)) as BitnobPayoutQuote;
  }

  async initializePayout(
    quoteId: string,
    body: {
      quote_id: string;
      reference: string;
      payment_reason?: string;
      callback_url?: string;
      beneficiary: BitnobBeneficiary;
    },
  ): Promise<BitnobPayout> {
    const res = await this.request<{ data?: { payout: BitnobPayout } }>(
      `/api/payouts/${quoteId}/initialize`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return res.data?.payout ?? this.unwrap<BitnobPayout>(res);
  }

  /**
   * Finalize a payout AFTER its on-chain deposit has been confirmed. This transitions
   * the payout out of `pending_address_deposit` and settles the fiat leg.
   *
   * Timing matters: called while the payout is still `pending_address_deposit` (deposit
   * not yet confirmed) Bitnob returns 400 "Cannot transition from pending_address_deposit
   * to pending". So this is driven from the `deposit.success` webhook with retry until the
   * deposit confirms and the transition is allowed. Endpoint is the `/{quoteId}/finalize`
   * path form (the no-path `/api/payouts/finalize` form 405s on this API version).
   */
  async finalizePayout(quoteId: string): Promise<BitnobPayout> {
    const res = await this.request<{ data?: { payout: BitnobPayout } }>(
      `/api/payouts/${quoteId}/finalize`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return res.data?.payout ?? this.unwrap<BitnobPayout>(res);
  }

  /** Generate a stablecoin deposit address on a chain for the user to send USDC to. */
  async createAddress(chain: string, opts?: { customer_email?: string; label?: string; reference?: string }): Promise<BitnobAddress> {
    const res = await this.request<unknown>(`/api/addresses`, {
      method: "POST",
      body: JSON.stringify({ chain, ...opts }),
    });
    return this.unwrap<BitnobAddress>(res);
  }

  async getTransaction(idOrReference: string): Promise<BitnobTransaction> {
    const res = await this.request<unknown>(
      `/api/transactions/${encodeURIComponent(idOrReference)}`,
    );
    return this.unwrap<BitnobTransaction>(res);
  }

  /** Every country payouts are supported in, with its currency corridors. */
  async getSupportedCountries(): Promise<{ countries: BitnobCountry[] }> {
    const res = await this.request<unknown>(`/api/payouts/supported-countries`);
    const data = this.unwrap<{ countries?: BitnobCountry[] } | BitnobCountry[]>(res);
    const countries = Array.isArray(data) ? data : data.countries ?? [];
    return { countries };
  }

  /** Authoritative list of supported stablecoin chains for this environment. */
  async getSupportedChains(): Promise<BitnobChain[]> {
    const res = await this.request<unknown>(`/api/stablecoins/supported-chains`);
    const data = this.unwrap<{ chains?: BitnobChain[] } | BitnobChain[]>(res);
    return Array.isArray(data) ? data : data.chains ?? [];
  }

  /** Banks/institutions available for a country (ISO 3166-1 alpha-2 code). */
  async getBanks(countryCode: string): Promise<BitnobBank[]> {
    const res = await this.request<unknown>(
      `/api/payouts/banks/${encodeURIComponent(countryCode)}`,
    );
    const data = this.unwrap<{ banks?: BitnobBank[] } | BitnobBank[]>(res);
    return Array.isArray(data) ? data : data.banks ?? [];
  }

  /** Name-enquiry: resolve an account holder's name before a payout. */
  async accountLookup(
    country: string,
    bankCode: string,
    accountNumber: string,
  ): Promise<BitnobAccountLookup> {
    const qs = new URLSearchParams({
      country,
      bank_code: bankCode,
      account_number: accountNumber,
    }).toString();
    const res = await this.request<unknown>(`/api/payouts/account-lookup?${qs}`);
    return this.unwrap<BitnobAccountLookup>(res);
  }
}

let clientInstance: BitnobClient | null = null;
export function getBitnobClient() {
  if (!clientInstance) clientInstance = new BitnobClient();
  return clientInstance;
}
