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
import { toUserSafeMessage } from '@/lib/errors/sanitize';

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
  /** Lifecycle timestamps. `initialized_at` is absent until a beneficiary is attached. */
  trip?: {
    quote_at?: string;
    initialized_at?: string;
    processing_start?: string;
    completion_time?: string;
  };
  beneficiary?: unknown;
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

/**
 * A row from the company ledger (`/api/transactions`). Amounts are integer minor units as
 * strings — USDC is 6dp, so "1050000" is 1.05 USDC — and are negative on the debit side.
 */
export interface BitnobLedgerTx {
  currency: string;
  /** DEPOSIT_CONFIRMED | PAYOUT | REVERSAL | … */
  type: string;
  /** SETTLED | FAILED | … */
  state: string;
  amount: string;
  reference: string;
  metadata?: {
    /** Where the deposit landed, and the on-chain hash that put it there. */
    address?: string;
    tx_hash?: string;
    [key: string]: unknown;
  };
}

/** A deposit positively matched to one of our payouts. */
export interface SettledDeposit {
  reference: string;
  amountUsdc: number;
  /** Chain the deposit arrived on, per the ledger row. */
  chain?: string;
  /** On-chain hash Bitnob recorded for it — what ties it to the user's transfer. */
  txHash?: string;
}

/** One currency account on the company ledger. */
export interface BitnobBalance {
  account_id: string;
  currency: string;
  /** Minor units as a string — USDC is 6dp, so "67083686" is 67.083686 USDC. */
  available_balance: string;
  ledger_balance: string;
}

const USDC_MINOR = 1_000_000;

/**
 * Chains where Bitnob returns ONE static company deposit address rather than a per-payout one.
 *
 * On these the address identifies nothing — every payout we have ever made on Stellar shares
 * `GDZDVVL4…` — so a deposit can only be tied to its payout by tx hash. Everywhere else the
 * address is unique per payout and is a safe identifier on its own.
 */
export function hasSharedDepositAddress(network?: string | null): boolean {
  return (network || "").toLowerCase() === "stellar";
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
      // The full envelope goes to the log; the user gets, at most, the provider's own `detail`
      // sentence. Throwing the raw text put a JSON blob — request ids, URLs, the provider's
      // name — straight into a toast.
      console.error(
        `[Bitnob] ${options.method || "GET"} ${path} failed (${res.status}): ${errorText}`,
      );
      let detail = "";
      try {
        const parsed = JSON.parse(errorText) as { detail?: string; message?: string };
        detail = (parsed.detail || parsed.message || "").trim();
      } catch {
        /* not JSON — fall through to the generic message below */
      }
      throw new Error(
        toUserSafeMessage(detail) ??
          "We couldn't complete that request. Please try again shortly.",
      );
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

  /**
   * Read a quote back, including whether a payout was ever attached to it.
   *
   * `trip.initialized_at` is the authoritative "does a payout exist" flag: an uninitialized quote
   * carries only `quote_at` and no beneficiary, and eventually reports EXPIRED. That difference is
   * what lets the reconcile cron tell "deposit landed, payout never created — recoverable" apart
   * from "payout exists, just waiting".
   */
  async getPayoutQuote(quoteId: string): Promise<BitnobPayout> {
    const res = await this.request<{ data?: { payout: BitnobPayout } }>(
      `/api/payouts/quotes/${encodeURIComponent(quoteId)}`,
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

  /** Recent rows from the company ledger, newest first. */
  async listTransactions(limit = 50): Promise<BitnobLedgerTx[]> {
    const res = await this.request<unknown>(`/api/transactions?limit=${limit}`);
    const data = this.unwrap<{ transactions?: BitnobLedgerTx[] } | BitnobLedgerTx[]>(res);
    return Array.isArray(data) ? data : data.transactions ?? [];
  }

  /**
   * The SETTLED deposit backing a payout, or null if it hasn't landed yet — the check that
   * stops us releasing a payout for money we haven't received.
   *
   * Bitnob is not a sufficient guard on its own: it accepts `finalize` as soon as a deposit is
   * *detected*, which is why payouts used to settle ahead of their deposits.
   *
   * Matching prefers the tx hash and falls back to the address only when there is no hash.
   * Address alone is not safe — Stellar returns one static company-wide account, so same-sized
   * concurrent withdrawals would cross-match. The `reference` is useless here: deposits carry
   * an auto-generated `RCV_USDC_*`, never the `offramp_*` we pass to `createAddress`.
   */
  async findSettledDeposit(opts: {
    address?: string;
    txHash?: string;
    /** Reject a deposit smaller than what the payout will debit. */
    minAmountUsdc?: number;
    /** Reject a deposit that arrived on a different chain than the withdrawal settles on. */
    chain?: string;
  }): Promise<SettledDeposit | null> {
    const address = opts.address?.trim().toLowerCase();
    const txHash = opts.txHash?.trim().toLowerCase();
    if (!address && !txHash) return null;

    const rows = await this.listTransactions();

    for (const tx of rows) {
      if (tx.type !== "DEPOSIT_CONFIRMED") continue;
      if ((tx.state || "").toUpperCase() !== "SETTLED") continue;

      const rowAddress = tx.metadata?.address?.trim().toLowerCase();
      const rowTxHash = tx.metadata?.tx_hash?.trim().toLowerCase();
      // A supplied hash is authoritative — never widen to the address, which is shared.
      const matches = txHash
        ? !!rowTxHash && rowTxHash === txHash
        : !!address && !!rowAddress && rowAddress === address;
      if (!matches) continue;

      // A deposit short of the payout still leaves us out of pocket for the difference.
      const amountUsdc = Math.abs(Number(tx.amount) || 0) / USDC_MINOR;
      if (opts.minAmountUsdc != null && amountUsdc + 1e-9 < opts.minAmountUsdc) {
        console.warn(
          `[Bitnob] deposit ${tx.reference} is ${amountUsdc} USDC but the payout needs ` +
            `${opts.minAmountUsdc} — treating as not yet settled.`,
        );
        continue;
      }

      // A deposit that arrived on another chain is another payout's money.
      const rowChain = (tx.metadata?.chain as string | undefined)?.toLowerCase();
      if (opts.chain && rowChain && rowChain !== opts.chain.toLowerCase()) {
        console.warn(
          `[Bitnob] deposit ${tx.reference} arrived on ${rowChain}, not ${opts.chain} — skipping.`,
        );
        continue;
      }

      return { reference: tx.reference, amountUsdc, chain: rowChain, txHash: rowTxHash };
    }
    return null;
  }

  /**
   * Company balances, per currency account.
   *
   * This is what an `offchain` payout is debited from — Bitnob checks it at `initialize` and
   * 422s INSUFFICIENT_FUNDS when the payout exceeds it, which is why a withdrawal larger than
   * our float used to fail outright.
   */
  async getBalances(): Promise<BitnobBalance[]> {
    const res = await this.request<unknown>(`/api/balances`);
    const data = this.unwrap<{ accounts?: BitnobBalance[] } | BitnobBalance[]>(res);
    return Array.isArray(data) ? data : data.accounts ?? [];
  }

  /** Available USDC on the company ledger, in whole USDC. */
  async getAvailableUsdc(): Promise<number> {
    const accounts = await this.getBalances();
    const usdc = accounts.find((a) => (a.currency || "").toUpperCase() === "USDC");
    if (!usdc) return 0;
    return (Number(usdc.available_balance) || 0) / USDC_MINOR;
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
