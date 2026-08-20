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
  hasSharedDepositAddress,
  quotedSettlement,
  type BitnobBeneficiary,
  type BitnobCountry,
  type BitnobPayoutQuote,
} from "@/lib/bitnob/client";
import { getCurrencySymbol } from "@/lib/currency-config";
import { getCorridorFee } from "../fees";
import { RampUnsupportedError, type RampProvider } from "../provider";
import {
  isMobileMoneyCode,
  toInternationalMsisdn,
  validateMobileMoneyNumber,
} from "../msisdn";
import type {
  CreateOffRampParams,
  LedgerRowRef,
  QuoteOffRampParams,
  RampPayoutQuote,
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
  UGX: "UG",
  XOF: "CI",
  XAF: "CM",
  RWF: "RW",
  GMD: "GM",
};

/** Known mobile money operators for countries where bank lookup returns empty. */
function getMobileMoneyOperators(country: string, currency: RampCurrency): RampInstitution[] {
  const code = currency.toUpperCase();
  switch (code) {
    case "KES":
      return [
        { name: "M-PESA", code: "SAFAKEPC", institutionCode: "SAFAKEPC", currency: "KES" },
        { name: "AIRTEL MONEY", code: "AIRTKEPC", institutionCode: "AIRTKEPC", currency: "KES" },
      ];
    case "GHS":
      return [
        { name: "MTN Mobile Money", code: "MTNGHPC", institutionCode: "MTNGHPC", currency: "GHS" },
        { name: "Vodafone Cash", code: "VODAGHPC", institutionCode: "VODAGHPC", currency: "GHS" },
        { name: "AirtelTigo Money", code: "ATGHPC", institutionCode: "ATGHPC", currency: "GHS" },
      ];
    case "UGX":
      return [
        { name: "MTN Mobile Money Uganda", code: "MTNUGPC", institutionCode: "MTNUGPC", currency: "UGX" },
        { name: "Airtel Money Uganda", code: "AIRTUGPC", institutionCode: "AIRTUGPC", currency: "UGX" },
      ];
    case "XOF":
      return [
        { name: "Orange Money", code: "ORANGEXOF", institutionCode: "ORANGEXOF", currency: "XOF" },
        { name: "MTN Mobile Money", code: "MTNXOF", institutionCode: "MTNXOF", currency: "XOF" },
        { name: "Wave", code: "WAVEXOF", institutionCode: "WAVEXOF", currency: "XOF" },
      ];
    case "XAF":
      return [
        { name: "MTN Mobile Money Cameroon", code: "MTNXAF", institutionCode: "MTNXAF", currency: "XAF" },
        { name: "Orange Money Cameroon", code: "ORANGEXAF", institutionCode: "ORANGEXAF", currency: "XAF" },
      ];
    case "RWF":
      return [
        { name: "MTN Mobile Money Rwanda", code: "MTNRWF", institutionCode: "MTNRWF", currency: "RWF" },
        { name: "Airtel Money Rwanda", code: "AIRTRWF", institutionCode: "AIRTRWF", currency: "RWF" },
      ];
    case "GMD":
      return [
        { name: "QMoney", code: "QMONEYGMD", institutionCode: "QMONEYGMD", currency: "GMD" },
        { name: "AfriMoney", code: "AFRIGMD", institutionCode: "AFRIGMD", currency: "GMD" },
      ];
    default:
      return [];
  }
}

/**
 * How Bitnob funds the fiat leg: `onchain` backs the payout with the user's own deposit,
 * `offchain` debits our pooled USDC balance and lets the deposit land separately.
 *
 * `onchain` is the default because it is the only mode that does not cap a withdrawal at our own
 * float — offchain 422s INSUFFICIENT_FUNDS the moment a user withdraws more than we hold. It
 * cannot work on a shared-address chain, though (see `hasSharedDepositAddress`): Bitnob funds an
 * onchain payout by watching that payout's own address, and there isn't one. Those chains use
 * float funding, with the deposit verified and credited first — see `createOffRampOrder`.
 *
 * Env-overridable towards `offchain` because it decides where real money comes from — reverting
 * should take a restart, not a deploy. It cannot force `onchain` onto a shared-address chain,
 * since that combination simply does not settle.
 */
export function payoutSource(network: string): "onchain" | "offchain" {
  if (hasSharedDepositAddress(network)) return "offchain";
  return process.env.BITNOB_PAYOUT_SOURCE === "offchain" ? "offchain" : "onchain";
}

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
 * Chains this app can settle an off-ramp on — EVM chains, Solana, and Stellar (direct settlement).
 */
const APP_SETTLEMENT_CHAINS = new Set([...APP_EVM_CHAINS, "solana", "stellar"]);

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

/**
 * How much of a quote's life must remain for order creation to reuse it.
 *
 * Reuse is what keeps the reviewed figure and the paid figure identical, but it spends quote
 * life: minutes can pass between review and order while 2FA is entered and — the slow one — a
 * CCTP consolidation bridges funds onto the settlement chain. The quote then has to outlive not
 * just `initialize` but the user's transfer landing, since an expired payout cannot be finalized.
 *
 * So the margin is sized for that whole tail, not for the initialize call. Below it the quote is
 * dropped and re-struck, which is simply the old behaviour — and the user is shown the fresh
 * figure on the confirm screen before sending anything. A moved rate shown up front is fine; a
 * payout that expires holding the user's USDC is not.
 */
const QUOTE_REUSE_MARGIN_MS = 3 * 60_000;

/** Is `quote` still usable to settle `amountUsdc` of `currency`? */
export function isQuoteReusable(
  quote: BitnobPayoutQuote,
  amountUsdc: number,
  currency: string,
): boolean {
  // Already has a payout attached — reusing it would double-initialize.
  if ((quote as { trip?: { initialized_at?: string } }).trip?.initialized_at) return false;
  if (/expired|failed|cancel/i.test(quote.status ?? "")) return false;
  if ((quote.to_currency ?? "").toUpperCase() !== currency.toUpperCase()) return false;
  // Amounts must agree — a quote struck for a different size settles a different payout.
  if (Math.abs(Number(quote.amount) - amountUsdc) > 1e-6) return false;
  if (quote.expires_at) {
    const expiry = Date.parse(quote.expires_at);
    if (Number.isFinite(expiry) && expiry - Date.now() < QUOTE_REUSE_MARGIN_MS) return false;
  }
  return true;
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
   * Resolve the (country, payout rail) to use for `currency` and the institution the user chose.
   *
   * The rail MUST follow the institution, not a fixed preference. It used to always prefer
   * `bank` where a corridor offered one — so a payout to M-PESA was built as a bank transfer
   * carrying a mobile-money operator code, and the provider rejected it as an invalid
   * beneficiary. On a deferred payout that rejection lands *after* the user's deposit has
   * arrived, which is how a withdrawal ends up funded with no payout.
   *
   * `bankCode` is optional only so the currency-level callers (which have no institution yet)
   * still work; when it is given, it decides the rail.
   */
  private async resolveCorridor(
    currency: RampCurrency,
    bankCode?: string,
  ): Promise<{ country: string; destinationType: string } | null> {
    const code = currency.toUpperCase();
    // A mobile-money operator code can only be paid over a mobile-money rail, and vice versa.
    const prefer = bankCode && isMobileMoneyCode(bankCode)
      ? ["mobile_money", "paybill", "paytill"]
      : ["bank", "mobile_money", "paybill", "paytill"];
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
    userEmail?: string,
  ): BitnobBeneficiary {
    const base = { destination_type: destinationType, country, account_name: bank.accountName };
    switch (destinationType) {
      case "bank":
        return { ...base, account_number: bank.accountNumber, bank_code: bank.bankCode };
      case "mobile_money":
      case "paybill":
      case "paytill":
        // Mobile-money rails require `network` and `sender` identity details.
        // Sent as an international MSISDN — the settlement form — so the payout
        // matches the number the format check normalised.
        const code = (bank.bankCode || "").toUpperCase();
        let network = "MTN";
        if (code.includes("AIRT")) network = "AIRTEL";
        else if (code.includes("VODA")) network = "VODAFONE";
        else if (code.includes("SAFA") || code.includes("MPESA")) network = "SAFARICOM";
        else if (code.includes("ORANGE")) network = "ORANGE";
        else if (code.includes("WAVE")) network = "WAVE";
        else if (code.includes("QMONEY")) network = "QMONEY";
        else if (code.includes("AFRI")) network = "AFRIMONEY";

        const senderName = userEmail ? userEmail.split("@")[0] : bank.accountName || "Sendzz User";
        return {
          ...base,
          account_number:
            toInternationalMsisdn(bank.accountNumber, country) ?? bank.accountNumber,
          bank_code: bank.bankCode,
          network,
          sender: {
            account_name: senderName,
            country: country,
            address: `${country} Region`,
          },
        };
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

  /**
   * What Bitnob will actually pay the beneficiary — a real payout quote, not the indicative
   * `/api/exchange-rates` figure.
   *
   * The quote is returned with its id and reference so `createOffRampOrder` can settle on this
   * very quote: the number shown at review is then the number that pays out, with no rate
   * re-strike in between. The quote is priced per chain and per funding source, so both are
   * passed exactly as order creation will pass them.
   */
  async quoteOffRamp(params: QuoteOffRampParams): Promise<RampPayoutQuote> {
    const corridor = await this.resolveCorridor(params.fiatCurrency);
    if (!corridor) {
      throw new RampUnsupportedError(
        "bitnob",
        "offRamp",
        `Bitnob has no serviceable corridor for ${params.fiatCurrency}`,
      );
    }

    const reference = `offramp_${Date.now()}`;
    const quote = await getBitnobClient().createPayoutQuote({
      amount: String(params.amountUsdc),
      country: corridor.country,
      from_asset: "USDC",
      to_currency: params.fiatCurrency,
      source: payoutSource(params.network),
      chain: params.network,
      reference,
    });

    const settlement = quotedSettlement(quote, params.amountUsdc);
    if (!settlement) {
      // No settlement figure means we cannot say what the user gets. Refusing sends the caller
      // to the indicative rate, clearly labelled — better than presenting a guess as a quote.
      throw new RampUnsupportedError(
        "bitnob",
        "rates",
        `Bitnob quote ${quote.quote_id} reported no settlement amount`,
      );
    }

    return {
      provider: "bitnob",
      rate: settlement.rate,
      payoutAmount: settlement.amount,
      binding: true,
      quoteId: quote.quote_id,
      reference,
      expiresAt: quote.expires_at,
    };
  }

  async createOffRampOrder(params: CreateOffRampParams): Promise<RampOrderResponse> {
    const corridor = await this.resolveCorridor(params.fiatCurrency, params.bank.bankCode);
    if (!corridor) {
      throw new RampUnsupportedError(
        "bitnob",
        "offRamp",
        `Bitnob has no serviceable corridor for ${params.fiatCurrency}`,
      );
    }
    const { country, destinationType } = corridor;

    const bitnob = getBitnobClient();

    // 1. Settle on the quote the user was actually shown, when it is still good.
    //
    // Re-quoting here is what let the review screen and the payout disagree: the user approves
    // one rate and the payout is struck at another moments later. Reusing the reviewed quote
    // removes the gap entirely. Its reference travels with it — `initialize` must run under the
    // reference the quote was created with, not a fresh one.
    let quote: BitnobPayoutQuote | null = null;
    let reference = params.quoteReference ?? `offramp_${Date.now()}`;

    if (params.quoteId && params.quoteReference) {
      const existing = await bitnob
        .getPayoutQuote(params.quoteId)
        .catch((e) => {
          console.warn(`[Bitnob] could not read quote ${params.quoteId} for reuse:`, e);
          return null;
        });
      if (existing && isQuoteReusable(existing as BitnobPayoutQuote, params.amountUsdc, params.fiatCurrency)) {
        quote = existing as BitnobPayoutQuote;
      } else {
        console.log(
          `[Bitnob] quote ${params.quoteId} no longer usable (expired, spent, or amount ` +
            `changed) — re-quoting. The order carries the fresh payout figure.`,
        );
      }
    }

    if (!quote) {
      reference = `offramp_${Date.now()}`;
      quote = await bitnob.createPayoutQuote({
        amount: String(params.amountUsdc),
        country,
        from_asset: "USDC",
        to_currency: params.fiatCurrency,
        source: payoutSource(params.network),
        chain: params.network,
        reference,
      });
    }

    // 2. Generate the deposit address the user funds. On Stellar this is NOT per-payout —
    // Bitnob returns one static company account and discards our `reference`, so the deposit
    // is traceable back to this order only via `metadata.address` / `metadata.tx_hash`.
    const address = await bitnob.createAddress(params.network, {
      customer_email: params.userEmail,
      label: "USDC-Offramp",
      reference,
    });

    // 3. Attach the rail-specific beneficiary — the payout enters `pending_address_deposit`.
    //
    // DEFERRED on a shared-address chain: Bitnob checks our float at `initialize`, so attaching a
    // beneficiary before the user's money arrives caps every withdrawal at what we happen to be
    // holding. Letting the deposit land first makes the user's own USDC the funding, which is what
    // backs the payout in substance anyway. `lib/ramp/deferred-settle` verifies it and initializes.
    const deferInitialize = hasSharedDepositAddress(params.network);

    let receiveAddress = address.address;
    if (!deferInitialize) {
      const initialized = await bitnob.initializePayout(quote.quote_id, {
        quote_id: quote.quote_id,
        reference,
        payment_reason: params.bank.memo || "user_withdrawal",
        beneficiary: this.buildBeneficiary(destinationType, country, params.bank, params.userEmail),
      });
      // Prefer an address returned by initialize (payout-bound); otherwise use the one above.
      receiveAddress = depositAddressOf(initialized) ?? address.address;
    }

    // Sent on top of the quote amount so Bitnob's deduction comes out of the user's deposit
    // and not our float. Configured, not reported by the API — see `getCorridorFee`.
    const corridorFee = getCorridorFee("bitnob", params.fiatCurrency);
    const bitnobFee = String(corridorFee);

    if (corridorFee > 0) {
      console.log(
        `[Bitnob] ${params.fiatCurrency}/${destinationType} corridor fee ${corridorFee} USDC ` +
          `on top of ${params.amountUsdc}`,
      );
    }

    // What the beneficiary is actually getting, straight off the quote this order settles on.
    // The ledger records it and the receipt shows it — one number for the whole withdrawal.
    const settlement = quotedSettlement(quote, params.amountUsdc);
    if (!settlement) {
      console.warn(
        `[Bitnob] quote ${quote.quote_id} reported no settlement amount — the receipt will ` +
          `fall back to the caller's rate estimate.`,
      );
    }

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
      fiatAmount: settlement ? String(settlement.amount) : undefined,
      fiatRate: settlement?.rate,
      bitnobFee,
      deferredInitialize: deferInitialize,
      createdAt: quote.created_at ?? new Date().toISOString(),
    };
  }

  /**
   * Attach the beneficiary to a quote whose `initialize` was deferred, once its deposit has been
   * verified. Rebuilds the beneficiary from the same inputs order creation used, so nothing
   * about the destination has to be held anywhere in the meantime.
   */
  async initializeDeferredPayout(params: {
    quoteId: string;
    reference: string;
    fiatCurrency: RampCurrency;
    bank: CreateOffRampParams["bank"];
    userEmail?: string;
  }): Promise<void> {
    const corridor = await this.resolveCorridor(params.fiatCurrency, params.bank.bankCode);
    if (!corridor) {
      throw new RampUnsupportedError(
        "bitnob",
        "offRamp",
        `Bitnob has no serviceable corridor for ${params.fiatCurrency}`,
      );
    }
    await getBitnobClient().initializePayout(params.quoteId, {
      quote_id: params.quoteId,
      reference: params.reference,
      payment_reason: params.bank.memo || "user_withdrawal",
      beneficiary: this.buildBeneficiary(
        corridor.destinationType,
        corridor.country,
        params.bank,
        params.userEmail,
      ),
    });
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
    // Mobile money has no name enquiry to call.
    //
    // Bitnob's account-lookup is enabled for Nigerian BANK accounts only — confirmed against
    // the live API, where every Rwandan operator code and every number format returned 400
    // VALIDATION_ERROR. Calling it here produced a validation error the UI reported as a bad
    // account number, when in fact the number was fine and the endpoint simply doesn't serve
    // that rail. So don't call it: check the number's shape instead, and be explicit that the
    // holder's name is not confirmed. Bitnob validates the wallet at payout and refunds if it
    // can't be reached.
    if (isMobileMoneyCode(institution)) {
      const operatorName = getMobileMoneyOperators(country, currency).find(
        (o) => o.code.toUpperCase() === institution.toUpperCase(),
      )?.name;

      const check = validateMobileMoneyNumber({
        institutionCode: institution,
        country,
        accountNumber,
        operatorName,
      });
      if (!check.ok) throw new Error(check.reason ?? "That mobile money number isn't valid.");

      return {
        status: "success",
        message: "format_checked",
        data: { accountName: operatorName ?? "Mobile Money" },
        nameVerified: false,
      };
    }

    const r = await getBitnobClient().accountLookup(country, institution, accountNumber);
    if (!r.account_name || r.is_verified === false) {
      throw new Error(
        "Unable to verify bank details. Please check the bank and account information.",
      );
    }
    return { status: "success", data: { accountName: r.account_name }, nameVerified: true };
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
    try {
      const banks = await getBitnobClient().getBanks(country).catch(() => []);
      if (banks && banks.length > 0) {
        return {
          data: banks.map((b) => {
            const name = b.name ?? b.bank_name ?? "";
            const code = b.code ?? b.bank_code ?? "";
            return { name, code, institutionCode: code, currency };
          }),
        };
      }
      const operators = getMobileMoneyOperators(country, currency);
      if (operators.length > 0) {
        return { data: operators };
      }
      throw new RampUnsupportedError(
        "bitnob",
        "institutions",
        `No institutions returned by Bitnob for ${country} (${currency})`,
      );
    } catch (err) {
      if (err instanceof RampUnsupportedError) throw err;
      throw new RampUnsupportedError(
        "bitnob",
        "institutions",
        `Failed to fetch Bitnob banks for ${currency}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
