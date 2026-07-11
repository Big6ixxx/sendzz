/**
 * Bitnob adapter — the PRIMARY provider.
 *
 * Bitnob exposes: off-ramp payouts (quote → initialize → finalize), stablecoin deposit
 * addresses, exchange rates, and transaction status. It does NOT (in the public docs)
 * expose fiat on-ramp virtual accounts, bank-name verification, or an institutions list,
 * so those throw RampUnsupportedError and the router falls back to Paycrest.
 *
 * Off-ramp note: Bitnob's payout settles differently from Paycrest (it doesn't auto-detect
 * a deposit-and-settle against a returned receive address the same way).
 */
import {
  depositAddressOf,
  getBitnobClient,
  type BitnobBeneficiary,
  type BitnobCountry,
} from "@/lib/bitnob/client";
import { getCurrencySymbol } from "@/lib/currency-config";
import { RampUnsupportedError, type RampProvider } from "../provider";
import type {
  CreateOffRampParams,
  LedgerRowRef,
  RampCapabilities,
  RampCurrency,
  RampCurrencyDetail,
  RampInstitution,
  RampOrderResponse,
  RampOrderStatus,
  RampRateResponse,
  RampVerifyAccountResponse,
} from "../types";

/**
 * Payout rails this app's withdraw UX can actually fulfil (it collects an account/phone
 * identifier + an institution code). Corridors that ONLY offer swift/wire/ach/sepa/
 * domestic_gbp/alipay/wechatpay need different field schemas we don't capture, so they're
 * not surfaced as supported currencies.
 */
const SERVICEABLE_DESTINATIONS = new Set([
  "bank",
  "mobile_money",
  "paybill",
  "paytill",
]);

function isServiceable(destinationTypes: string[] | undefined): boolean {
  return !!destinationTypes?.some((d) => SERVICEABLE_DESTINATIONS.has(d));
}

/** Small fallback map used only if the live country list can't be fetched. */
const FALLBACK_CURRENCY_COUNTRY: Record<string, string> = {
  NGN: "NG",
  KES: "KE",
  GHS: "GH",
};

/** EVM chains this app can move USDC on (smart-account capable). */
const APP_EVM_CHAINS = new Set([
  "base",
  "polygon",
  "ethereum",
  "arbitrum",
  "optimism",
  "avalanche",
]);

/**
 * Chains this app can settle an off-ramp on — the EVM chains plus Solana (direct SPL settle).
 * Stellar is coming soon (settle path not built yet), so it's intentionally excluded until then.
 */
const APP_SETTLEMENT_CHAINS = new Set([...APP_EVM_CHAINS, "solana"]);

let currencyNames: Intl.DisplayNames | null | undefined;
function currencyName(code: string): string {
  if (currencyNames === undefined) {
    try {
      currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
    } catch {
      currencyNames = null;
    }
  }
  return currencyNames?.of(code) ?? code;
}

function mapState(state: string): RampOrderStatus {
  switch (state?.toUpperCase()) {
    case "SETTLED":
    case "COMPLETED":
    case "SUCCESS":
      return "settled";
    case "FAILED":
    case "EXPIRED":
      return "failed";
    case "REVERSED":
    case "REFUNDED":
      return "refunded";
    case "IN_PROGRESS":
    case "PROCESSING":
      return "settling";
    case "PENDING":
    case "PENDING_ADDRESS_DEPOSIT":
    case "QUOTE":
    default:
      return "pending";
  }
}

export class BitnobProvider implements RampProvider {
  readonly name = "bitnob" as const;
  readonly capabilities: RampCapabilities = {
    onRamp: false, // no fiat virtual-account endpoint in Bitnob docs → Paycrest
    offRamp: true,
    verifyAccount: true, // GET /api/payouts/account-lookup (name-enquiry)
    institutions: true, // GET /api/payouts/banks/:country
    currencies: true, // derived from GET /api/payouts/supported-countries
    rates: true,
    // (read-only; safe to be primary)
  };

  /** Cached supported-countries response (currency catalogue + corridor → country map). */
  private countriesCache: Promise<{ countries: BitnobCountry[] }> | null = null;

  private countries() {
    if (!this.countriesCache) {
      this.countriesCache = getBitnobClient()
        .getSupportedCountries()
        .catch((e) => {
          this.countriesCache = null; // allow retry on next call
          throw e;
        });
    }
    return this.countriesCache;
  }

  /** Resolve the country code to use for a payout in `currency` (first serviceable corridor). */
  private async resolveCountry(currency: RampCurrency): Promise<string | null> {
    const code = currency.toUpperCase();
    try {
      const { countries } = await this.countries();
      const match = countries.find((c) =>
        c.corridors?.some(
          (corr) => corr.currency?.toUpperCase() === code && isServiceable(corr.destination_types),
        ),
      );
      if (match) return match.code;
    } catch {
      // fall through to the static fallback
    }
    return FALLBACK_CURRENCY_COUNTRY[code] ?? null;
  }

  /**
   * Resolve the (country, payout rail) to use for `currency`. Picks the first country
   * offering a serviceable corridor, and within it the preferred rail
   * (bank → mobile_money → paybill → paytill).
   */
  private async resolveCorridor(
    currency: RampCurrency,
  ): Promise<{ country: string; destinationType: string } | null> {
    const code = currency.toUpperCase();
    const prefer = ["bank", "mobile_money", "paybill", "paytill"];
    try {
      const { countries } = await this.countries();
      for (const c of countries) {
        const corr = c.corridors?.find(
          (x) => x.currency?.toUpperCase() === code && isServiceable(x.destination_types),
        );
        if (!corr) continue;
        const destinationType =
          prefer.find((p) => corr.destination_types.includes(p)) ??
          corr.destination_types[0];
        return { country: c.code, destinationType };
      }
    } catch {
      // fall through
    }
    const fallback = FALLBACK_CURRENCY_COUNTRY[code];
    return fallback ? { country: fallback, destinationType: "bank" } : null;
  }

  /** Build the rail-specific beneficiary from the account fields the app collects. */
  private buildBeneficiary(
    destinationType: string,
    country: string,
    bank: CreateOffRampParams["bank"],
  ): BitnobBeneficiary {
    const base = { destination_type: destinationType, country, account_name: bank.accountName };
    switch (destinationType) {
      case "bank":
        return { ...base, account_number: bank.accountNumber, bank_code: bank.bankCode };
      case "mobile_money":
      case "paybill":
      case "paytill":
        // Mobile-money rails: account_number carries the phone/till number, bank_code the
        // provider. (Exact field names for these rails are unconfirmed against a live payload.)
        return { ...base, account_number: bank.accountNumber, bank_code: bank.bankCode };
      default:
        // swift/wire/ach/sepa/domestic_gbp need field schemas the app doesn't collect.
        throw new RampUnsupportedError(
          "bitnob",
          "offRamp",
          `Unsupported payout rail '${destinationType}' for this app's withdraw form`,
        );
    }
  }

  /** Legacy rows (no `provider` column) are recognised as Bitnob's by their payout quote_id. */
  ownsLedgerRow(row: LedgerRowRef): boolean {
    return !!(row.provider_metadata as { quote_id?: string } | null)?.quote_id;
  }

  async supportsCurrency(currency: RampCurrency): Promise<boolean> {
    return (await this.resolveCountry(currency)) !== null;
  }

  async createOnRampOrder(): Promise<RampOrderResponse> {
    throw new RampUnsupportedError("bitnob", "onRamp", "Bitnob fiat on-ramp not wired");
  }

  async createOffRampOrder(params: CreateOffRampParams): Promise<RampOrderResponse> {
    const corridor = await this.resolveCorridor(params.fiatCurrency);
    if (!corridor) {
      throw new RampUnsupportedError(
        "bitnob",
        "offRamp",
        `Bitnob has no serviceable corridor for ${params.fiatCurrency}`,
      );
    }
    const { country, destinationType } = corridor;

    const bitnob = getBitnobClient();
    const reference = `offramp_${Date.now()}`;

    // 1. Quote the USDC → fiat conversion.
    const quote = await bitnob.createPayoutQuote({
      amount: String(params.amountUsdc),
      country,
      from_asset: "USDC",
      to_currency: params.fiatCurrency,
      source: "onchain",
      chain: params.network,
      reference,
    });

    // 2. Generate the deposit address the user funds. It shares this payout's `reference`,
    // which is how Bitnob associates the incoming USDC with the payout (deposit.success
    // fires against it). Kept BEFORE initialize to preserve the linkage that works.
    const address = await bitnob.createAddress(params.network, {
      customer_email: params.userEmail,
      label: "USDC-Offramp",
      reference,
    });

    // 3. Attach the rail-specific beneficiary — the payout enters `pending_address_deposit`.
    const initialized = await bitnob.initializePayout(quote.quote_id, {
      quote_id: quote.quote_id,
      reference,
      payment_reason: "user_withdrawal",
      beneficiary: this.buildBeneficiary(destinationType, country, params.bank),
    });

    // Finalize is NOT called here — the payout can only be finalized AFTER its on-chain
    // deposit confirms (otherwise Bitnob 400s "cannot transition to pending"). It's driven
    // from the deposit.success webhook instead.

    // Prefer an address returned by initialize (payout-bound); otherwise use the one above.
    const receiveAddress = depositAddressOf(initialized) ?? address.address;

    return {
      // Store OUR reference as the order id — that's what appears in webhooks and the
      // transactions endpoint (Bitnob's quote_id is only used internally for init/finalize).
      id: reference,
      provider: "bitnob",
      providerRef: quote.quote_id, // needed to finalize after the deposit lands
      status: mapState(quote.status),
      providerAccount: {
        network: params.network,
        receiveAddress,
        validUntil: quote.expires_at ?? "",
      },
      source: { type: "crypto", currency: "USDC", network: params.network },
      destination: { type: "fiat", currency: params.fiatCurrency },
      amount: String(params.amountUsdc),
      createdAt: quote.created_at ?? new Date().toISOString(),
    };
  }

  async getOrder(orderId: string): Promise<RampOrderResponse> {
    const pending: RampOrderResponse = {
      id: orderId,
      provider: "bitnob",
      status: "pending",
      providerAccount: { validUntil: "" },
      source: { type: "crypto", currency: "USDC" },
      destination: { type: "fiat", currency: "" },
      amount: "",
      createdAt: new Date().toISOString(),
    };
    try {
      const tx = await getBitnobClient().getTransaction(orderId);
      return {
        ...pending,
        id: tx.reference || tx.transaction_id,
        status: mapState(tx.state),
        destination: { type: "fiat", currency: tx.currency },
        amount: tx.amount,
        createdAt: tx.created_at,
      };
    } catch {
      // Not indexed under this id yet (we key by quote_id; the transaction has its own
      // id/reference). Report pending and rely on the webhook for the terminal status.
      return pending;
    }
  }

  async getRates(_amount: number, fiat: RampCurrency): Promise<RampRateResponse> {
    const bitnob = getBitnobClient();
    const r = await bitnob.getRates("USDC", fiat);
    const buy = r.buy_rate != null ? Number(r.buy_rate) : undefined;
    const sell = r.sell_rate != null ? Number(r.sell_rate) : undefined;
    return {
      data: {
        buy: buy != null ? { rate: buy, provider_id: "bitnob" } : undefined,
        sell: sell != null ? { rate: sell, provider_id: "bitnob" } : undefined,
      },
    };
  }

  async verifyAccount(
    institution: string,
    accountNumber: string,
    currency: RampCurrency = "NGN",
  ): Promise<RampVerifyAccountResponse> {
    const country = await this.resolveCountry(currency);
    if (!country) {
      throw new RampUnsupportedError(
        "bitnob",
        "verifyAccount",
        `No serviceable country for ${currency}`,
      );
    }
    const r = await getBitnobClient().accountLookup(country, institution, accountNumber);
    if (!r.account_name || r.is_verified === false) {
      throw new Error(
        "Unable to verify bank details. Please check the bank and account information.",
      );
    }
    return { status: "success", data: { accountName: r.account_name } };
  }

  async getInstitutions(currency: RampCurrency): Promise<{ data: RampInstitution[] }> {
    const country = await this.resolveCountry(currency);
    if (!country) {
      throw new RampUnsupportedError(
        "bitnob",
        "institutions",
        `No serviceable country for ${currency}`,
      );
    }
    const banks = await getBitnobClient().getBanks(country);
    return {
      data: banks.map((b) => {
        const name = b.name ?? b.bank_name ?? "";
        const code = b.code ?? b.bank_code ?? "";
        return { name, code, institutionCode: code, currency };
      }),
    };
  }

  async getCurrencies(): Promise<{ data: RampCurrencyDetail[] }> {
    const { countries } = await this.countries();
    const seen = new Map<string, RampCurrencyDetail>();
    for (const c of countries) {
      for (const corr of c.corridors ?? []) {
        // Only surface corridors our withdraw UX can fulfil (bank / mobile money).
        if (!isServiceable(corr.destination_types)) continue;
        const code = corr.currency?.toUpperCase();
        if (!code || seen.has(code)) continue;
        seen.set(code, {
          code,
          name: currencyName(code),
          country: c.code,
          symbol: getCurrencySymbol(code),
          channels: corr.destination_types,
        });
      }
    }
    return { data: Array.from(seen.values()) };
  }

  async getSettlementNetworks(): Promise<string[]> {
    const chains = await getBitnobClient().getSupportedChains();
    return chains
      .map((c) => c.chain?.toLowerCase())
      .filter((c): c is string => !!c && APP_SETTLEMENT_CHAINS.has(c));
  }
}
