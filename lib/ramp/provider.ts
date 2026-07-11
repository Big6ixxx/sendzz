/**
 * The contract every ramp provider implements. The app (lib/actions/ramp.ts) only ever
 * talks to this interface via the router in ./index.ts.
 */
import type {
  CreateOffRampParams,
  CreateOnRampParams,
  LedgerRowRef,
  RampCapabilities,
  RampCurrency,
  RampCurrencyDetail,
  RampInstitution,
  RampOrderResponse,
  RampProviderName,
  RampRateResponse,
  RampVerifyAccountResponse,
} from "./types";

export interface RampProvider {
  readonly name: RampProviderName;
  /** Which capabilities this provider can serve. The router falls back for the rest. */
  readonly capabilities: RampCapabilities;

  /**
   * Optional: claim a ledger row that predates the stored `provider` column, so
   * `resolveLedgerProvider` can still route legacy rows to the right provider (e.g. for status
   * polling). Return true if this provider recognises the row as its own. Rows written by
   * current code always carry `provider`, so this only matters for historical data.
   */
  ownsLedgerRow?(row: LedgerRowRef): boolean;

  /** True if this provider can serve the given fiat currency. */
  supportsCurrency(currency: RampCurrency): Promise<boolean>;

  /** Fiat → USDC. Returns the bank/virtual account the user funds. */
  createOnRampOrder(params: CreateOnRampParams): Promise<RampOrderResponse>;

  /** USDC → fiat. Returns the address the user sends USDC to. */
  createOffRampOrder(params: CreateOffRampParams): Promise<RampOrderResponse>;

  /** Look up an order this provider created. */
  getOrder(orderId: string): Promise<RampOrderResponse>;

  /** Live buy/sell rates for `amount` of USDC ↔ `fiat`. */
  getRates(amount: number, fiat: RampCurrency): Promise<RampRateResponse>;

  /** Resolve a bank account number to its owner's name. */
  verifyAccount(
    institution: string,
    accountNumber: string,
    currency?: RampCurrency,
  ): Promise<RampVerifyAccountResponse>;

  /** Supported banks/institutions for a currency. */
  getInstitutions(currency: RampCurrency): Promise<{ data: RampInstitution[] }>;

  /** Supported fiat currencies. */
  getCurrencies(): Promise<{ data: RampCurrencyDetail[] }>;

  /**
   * Chains this provider can settle USDC on for fiat off-ramp (dynamic, not hardcoded).
   * Used to drive withdrawal routing instead of a static network list.
   */
  getSettlementNetworks(): Promise<string[]>;
}

/** Thrown by a provider when it structurally cannot serve a request (→ router falls back). */
export class RampUnsupportedError extends Error {
  constructor(
    public readonly provider: RampProviderName,
    public readonly capability: keyof RampCapabilities,
    message?: string,
  ) {
    super(message ?? `${provider} does not support ${capability}`);
    this.name = "RampUnsupportedError";
  }
}
