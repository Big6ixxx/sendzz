/**
 * Brails API client (https://docs.brails.com).
 *
 * Covers what Sendzz uses Brails for: payouts in corridors Bitnob does not serve, funded by
 * USDC the user sends to their Brails deposit address.
 *
 * Two API versions are in play and both are live: fiat (wallets, rates, bank lists, payouts,
 * transactions) is v2, stablecoin deposit addresses and sends are v1. Same key for both.
 *
 * Auth is a Bearer secret key, and Brails also refuses any caller whose IP is not whitelisted
 * in its dashboard — a 403 "No whitelisted IP" / "Connection refused on <ip>" means exactly
 * that, not a bad key.
 *
 * Amounts: requests take MINOR units. For a payout or payout quote that is the PAYOUT currency
 * (₦1 = 100), not USD — sending US cents asks for a hundredth of the payout and falls below the
 * corridor minimum. Responses mix major and minor and say which with paired fields
 * (`amount` / `centAmount`, `sourceAmount` in US cents), so read the field, never assume.
 */
import crypto from 'crypto';
import { toUserSafeMessage } from '@/lib/errors/sanitize';

// ── Response shapes (the subset we read) ─────────────────────────────────────

export interface BrailsRate {
  currency: string;
  /** Local currency per 1 USD when Brails buys USD from us — what a payout converts at. */
  sellRate: number;
  buyRate: number;
}

export interface BrailsBank {
  id: number;
  code: string;
  name: string;
  currency: string;
}

export interface BrailsLookup {
  accountName: string;
  accountNumber: string;
  country: string;
  code?: string;
}

export interface BrailsDepositAddress {
  id: string;
  address: string;
  network: string;
  addressType: string;
  customerEmail: string;
  customerId?: string | null;
  reference?: string;
  active?: boolean;
  /** Stellar only: the memo that tells this customer's deposits apart on a shared address. */
  memo?: string | null;
}

/** A beneficiary as Brails' payout endpoint takes it inline. */
export interface BrailsBeneficiary {
  country: string;
  currency: string;
  destination: {
    type: 'BANK' | 'MOBILEMONEY';
    accountNumber: string;
    accountName?: string;
    bankCode?: string;
    bankName?: string;
    network?: string;
    /** Required in Ethiopia and The Gambia, beside the account number. */
    phoneNumber?: string;
    /** Required on some mobile money corridors (CFA franc countries and others). */
    sender?: { accountName: string; country: string };
  };
}

export interface BrailsQuote {
  quoteId: string;
  /** What the payout costs from our USD wallet, in US cents. */
  sourceAmount: number;
  /** What the recipient receives, in minor units of the payout currency. */
  targetAmount: number;
  rate: number;
  fee: number;
  expiresAt: string;
}

export interface BrailsTransaction {
  id: string;
  reference: string;
  status: string;
  type?: string;
  action?: string;
  channel?: string;
  amount?: string | number;
  centAmount?: string | number;
  fees?: string | number;
  hash?: string;
  /** Deposits: the address the money arrived at, and its chain. */
  address?: string;
  chain?: string;
  payoutAmount?: string | number;
  payoutCurrency?: string;
  exchangeRate?: string | number;
  spotPrice?: string | number;
  customerId?: string | null;
}

interface Envelope<T> {
  status: boolean;
  message?: string;
  data: T;
}

class BrailsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = (process.env.BRAILS_API_URL || 'https://api.onbrails.com/api').replace(/\/$/, '');
    this.apiKey = process.env.BRAILS_API_KEY || '';
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  private async request<T>(
    version: 'v1' | 'v2',
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    if (!this.apiKey) throw new Error('Brails is not configured (BRAILS_API_KEY)');
    const method = options.method ?? 'GET';
    const res = await fetch(`${this.baseUrl}/${version}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const text = await res.text();
    let parsed: Partial<Envelope<T>> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON — an HTML error page or a bare "Not Found" */
    }

    // Brails answers some failures with HTTP 200 and `status: false`, so both are checked.
    if (!res.ok || parsed?.status === false) {
      const detail = (parsed?.message ?? '').trim();
      console.error(
        `[Brails] ${method} /${version}${path} failed (${res.status}): ` +
          `${detail || (text.startsWith('<') ? 'non-JSON response' : text.slice(0, 300))}`,
      );
      throw Object.assign(
        new Error(toUserSafeMessage(detail) ?? "We couldn't complete that request. Please try again shortly."),
        // An HTTP 200 carrying `status: false` is a refusal, not a missing answer — tagged as one
        // so callers do not mistake it for a payout that may have gone through.
        { status: res.ok ? 422 : res.status },
      );
    }
    return (parsed?.data ?? (parsed as T)) as T;
  }

  // ── Rates ──────────────────────────────────────────────────────────────────

  /** Payout rate for one currency, against USD. */
  getPayoutRate(currency: string): Promise<BrailsRate> {
    return this.request<BrailsRate>('v2', `/wallets/payout/rate/${encodeURIComponent(currency.toUpperCase())}`);
  }

  // ── Banks and account lookup ───────────────────────────────────────────────

  getBankList(country: string, currency: string): Promise<BrailsBank[]> {
    return this.request<BrailsBank[]>(
      'v2',
      `/banklist/${encodeURIComponent(country.toUpperCase())}/${encodeURIComponent(currency.toUpperCase())}`,
    );
  }

  /** Name enquiry. Brails supports NG bank accounts and GH MTN mobile money only. */
  lookupBeneficiary(params: {
    country: string;
    accountNumber: string;
    bankCode?: string;
    bankName?: string;
    network?: string;
  }): Promise<BrailsLookup> {
    return this.request<BrailsLookup>('v2', '/beneficiaries/lookup', { method: 'POST', body: params });
  }

  // ── Stablecoin deposit addresses (v1) ──────────────────────────────────────

  /**
   * A new USDC deposit address on `chain` for this customer.
   *
   * Brails mints a fresh address on every call — it does not hand back the customer's existing
   * one — and its list endpoint cannot filter by customer. So the caller remembers the address
   * and only asks for one when it has none (see BrailsProvider.depositAddressFor).
   */
  createDepositAddress(customerEmail: string, chain: string, memo?: string): Promise<BrailsDepositAddress> {
    return this.request<BrailsDepositAddress>('v1', '/wallets/stablecoin/generate-address', {
      method: 'POST',
      body: {
        chain,
        currency: 'usdc',
        customerEmail: customerEmail.trim().toLowerCase(),
        // Required in practice: without it Brails builds a label from our business name, which
        // overruns its 40-character limit on most chains and fails with a 502.
        label: `sendzz-${chain}`.slice(0, 40),
        // Required for Stellar, where one address serves many customers.
        ...(memo ? { memo } : {}),
      },
    });
  }

  // ── Payouts (v2) ───────────────────────────────────────────────────────────

  /**
   * Save a beneficiary, for a payout to reference by id.
   *
   * The live payout API requires `beneficiaryId` — the inline `beneficiary` its docs describe
   * is rejected with "beneficiaryId is required" — so every payout saves one first.
   */
  createBeneficiary(params: BrailsBeneficiary & { reference: string; customerEmail: string }): Promise<{ id: string }> {
    return this.request<{ id: string }>('v2', '/beneficiaries', { method: 'POST', body: params });
  }

  /**
   * Lock a payout rate for 90 seconds.
   *
   * `targetMinor` is what the RECIPIENT receives, in minor units of the payout currency
   * (₦1 = 100). The answer says what that costs from our USD wallet, in US cents.
   */
  createPayoutQuote(params: { targetCurrency: string; targetMinor: number; country: string }): Promise<BrailsQuote> {
    return this.request<BrailsQuote>('v2', '/wallets/quotes', {
      method: 'POST',
      body: {
        purpose: 'payout',
        sourceCurrency: 'USD',
        targetCurrency: params.targetCurrency.toUpperCase(),
        amount: params.targetMinor,
        beneficiaryCountry: params.country.toUpperCase(),
      },
    });
  }

  /**
   * Create AND send a payout in one call, at a locked quote.
   *
   * `amount` is the recipient's amount in minor units of the payout currency — not USD. (The
   * two-step initialize → finalize also exists; one call leaves no created-but-unsent payout to
   * expire.)
   */
  sendPayout(params: {
    reference: string;
    targetMinor: number;
    beneficiaryId: string;
    customerEmail: string;
    description: string;
    quoteId: string;
  }): Promise<BrailsTransaction> {
    return this.request<BrailsTransaction>('v2', '/wallets/payouts', {
      method: 'POST',
      body: {
        reference: params.reference,
        amount: params.targetMinor,
        sourceWalletCurrency: 'USD',
        beneficiaryId: params.beneficiaryId,
        customerEmail: params.customerEmail,
        description: params.description,
        quoteId: params.quoteId,
      },
    });
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  /**
   * The successful USD deposit carrying this on-chain hash, if Brails has one — so a deposit
   * whose webhook found no withdrawal can still be matched later.
   */
  async findDepositByHash(hash: string): Promise<BrailsTransaction | null> {
    const res = await this.request<{ transactions?: BrailsTransaction[] }>(
      'v2',
      `/transactions?limit=10&q=${encodeURIComponent(hash)}`,
    );
    return (
      res.transactions?.find(
        (t) => t.action?.toUpperCase() === 'DEPOSIT_USD' && t.status?.toLowerCase() === 'success',
      ) ?? null
    );
  }

  /**
   * The payout made under our reference, if Brails has one. Asked when a payout call is refused,
   * because a refusal of a repeated call (a duplicate reference) can mean it already exists.
   */
  async findPayoutByReference(reference: string): Promise<BrailsTransaction | null> {
    const res = await this.request<{ transactions?: BrailsTransaction[] }>(
      'v2',
      `/transactions?limit=10&q=${encodeURIComponent(reference)}`,
    );
    return (
      res.transactions?.find(
        (t) => t.reference === reference && !/deposit/i.test(t.action ?? '') && t.status?.toLowerCase() !== 'failed',
      ) ?? null
    );
  }

  /** The authority on any send or receive — used to confirm a webhook before acting on it. */
  getTransaction(id: string): Promise<BrailsTransaction> {
    return this.request<BrailsTransaction>('v1', `/transactions/${encodeURIComponent(id)}`);
  }
}

let clientInstance: BrailsClient | null = null;

export function getBrailsClient(): BrailsClient {
  if (!clientInstance) clientInstance = new BrailsClient();
  return clientInstance;
}

/**
 * Does `signature` match `payload`?
 *
 * Brails signs the event with HMAC-SHA512 (hex) under BRAILS_WEBHOOK_SECRET, sent as
 * `x-brails-signature`. Their example signs `JSON.stringify(body)`, so both the raw bytes and
 * the re-serialised body are accepted — whichever matches proves the sender.
 */
export function verifyBrailsSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.BRAILS_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const candidates = [rawBody];
  try {
    candidates.push(JSON.stringify(JSON.parse(rawBody)));
  } catch {
    /* not JSON — only the raw form can match */
  }
  const given = Buffer.from(signature.trim().toLowerCase());
  return candidates.some((body) => {
    const expected = Buffer.from(crypto.createHmac('sha512', secret).update(body).digest('hex'));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  });
}
