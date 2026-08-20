/**
 * Paycrest adapter. Wraps the existing PaycrestClient and maps Paycrest's API into the
 * neutral Ramp* types. This is the fallback provider (and still primary for capabilities
 * Bitnob doesn't expose: bank verification, institutions list, fiat on-ramp).
 */
import { getPaycrestClient } from "@/lib/paycrest/client";
import { calculatePaycrestBaseAmount } from "@/lib/paycrest/config";
import { getProviderFee } from "../fees";
import type { PaycrestNetwork, PaycrestOrderResponse } from "@/lib/paycrest/types";
import type { RampProvider } from "../provider";
import type {
  CreateOffRampParams,
  CreateOnRampParams,
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

function mapStatus(s: string): RampOrderStatus {
  const v = s?.toLowerCase();
  switch (v) {
    case "initiated":
    case "pending":
    case "deposited":
    case "validated":
    case "settling":
    case "settled":
    case "refunding":
    case "refunded":
    case "expired":
      return v;
    case "completed":
      return "settled";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * The fiat payout Paycrest states on an order, if it states one.
 *
 * Paycrest's documented contract is that it settles the amount it quoted, and its rate endpoint
 * is amount-scoped — so the order need not restate the payout, and often doesn't. Read what is
 * there rather than assuming a shape; the caller falls back to Paycrest's own rate for the
 * amount when this returns null, so the figure recorded is always Paycrest's, never the
 * provider the user happened to be quoted by first.
 */
function statedPayout(o: PaycrestOrderResponse): { amount?: number; rate?: number } {
  const raw = o as unknown as Record<string, unknown>;
  const pick = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const n = Number(raw[k]);
      if (raw[k] != null && raw[k] !== "" && Number.isFinite(n) && n > 0) return n;
    }
    return undefined;
  };
  return {
    amount: pick("settlementAmount", "amountInFiat", "fiatAmount", "receiveAmount"),
    rate: pick("rate", "exchangeRate"),
  };
}

function mapOrder(o: PaycrestOrderResponse): RampOrderResponse {
  return {
    id: o.id,
    provider: "paycrest",
    status: mapStatus(o.status),
    providerAccount: {
      institution: o.providerAccount?.institution,
      accountIdentifier: o.providerAccount?.accountIdentifier,
      accountName: o.providerAccount?.accountName,
      amountToTransfer: o.providerAccount?.amountToTransfer,
      currency: o.providerAccount?.currency,
      network: o.providerAccount?.network,
      receiveAddress: o.providerAccount?.receiveAddress,
      validUntil: o.providerAccount?.validUntil,
    },
    source: o.source,
    destination: o.destination,
    amount: o.amount,
    createdAt: o.createdAt,
    txHash: o.txHash,
    settlementTxHash: o.settlementTxHash,
    transactionHash: o.transactionHash,
  };
}

export class PaycrestProvider implements RampProvider {
  readonly name = "paycrest" as const;
  readonly capabilities: RampCapabilities = {
    onRamp: true,
    offRamp: true,
    verifyAccount: true,
    institutions: true,
    currencies: true,
    rates: true,
  };

  /**
   * Does Paycrest actually serve this currency?
   *
   * This used to answer `true` for everything, which made currency-aware routing a no-op: an
   * RWF request was handed to Paycrest, which doesn't cover Rwanda, and hung until the gateway
   * timed out. Ask Paycrest for its own currency list instead.
   *
   * Cached, since it's consulted on every routing decision and the list rarely changes. An
   * unreachable list returns the cached answer if we have one, otherwise `false` — guessing
   * "yes" is precisely what sent a payout to a provider that couldn't settle it.
   */
  async supportsCurrency(currency: RampCurrency): Promise<boolean> {
    if (!currency) return false;
    const supported = await this.supportedCurrencyCodes();
    if (!supported) return false;
    return supported.has(currency.toUpperCase());
  }

  private static currencyCache: { codes: Set<string>; at: number } | null = null;
  private static readonly CURRENCY_TTL_MS = 10 * 60 * 1000;

  private async supportedCurrencyCodes(): Promise<Set<string> | null> {
    const cached = PaycrestProvider.currencyCache;
    if (cached && Date.now() - cached.at < PaycrestProvider.CURRENCY_TTL_MS) {
      return cached.codes;
    }
    try {
      const { data } = await this.getCurrencies();
      const codes = new Set(
        (data ?? []).map((c) => String(c.code || "").toUpperCase()).filter(Boolean),
      );
      if (codes.size > 0) {
        PaycrestProvider.currencyCache = { codes, at: Date.now() };
        return codes;
      }
    } catch (err) {
      console.warn(
        "[Paycrest] Could not load supported currencies:",
        err instanceof Error ? err.message : err,
      );
    }
    // Serve a stale list through an outage rather than flip-flopping on what's supported.
    return cached?.codes ?? null;
  }

  async createOnRampOrder(params: CreateOnRampParams): Promise<RampOrderResponse> {
    const paycrest = getPaycrestClient();
    // Effective rate — honours PAYCREST_FEE_PERCENT, not just the compiled-in default.
    const baseAmount = calculatePaycrestBaseAmount(
      params.amountFiat,
      getProviderFee('paycrest').percent,
    );
    const safeUserId = params.userId.replace(/[^a-z0-9]/gi, "");
    const order = await paycrest.createOrder({
      amount: baseAmount.toFixed(2),
      amountIn: "fiat",
      source: {
        type: "fiat",
        currency: params.fiatCurrency,
        refundAccount: params.refundAccount,
      },
      destination: {
        type: "crypto",
        currency: "USDC",
        recipient: {
          address: params.userAddress,
          network: params.network as PaycrestNetwork,
        },
      },
      reference: `onramp${Date.now()}${safeUserId}`,
    });
    return mapOrder(order);
  }

  /**
   * What Paycrest will actually pay the beneficiary.
   *
   * Paycrest has no separate quote object to reserve — its rate endpoint is scoped to the
   * amount and it settles the amount it quoted, so the rate IS the quote. That means there is
   * no `quoteId` to carry into order creation; consistency comes instead from order creation
   * pricing the payout the same way, off the same endpoint, for the same amount.
   */
  async quoteOffRamp(params: QuoteOffRampParams): Promise<RampPayoutQuote> {
    const rate = await this.sellRateFor(params.amountUsdc, params.fiatCurrency, params.network);
    if (rate == null) {
      throw new Error(`Paycrest returned no ${params.fiatCurrency} sell rate`);
    }
    return {
      provider: "paycrest",
      rate,
      payoutAmount: params.amountUsdc * rate,
      binding: true,
    };
  }

  /** Paycrest's sell rate for this exact size — amount-scoped, so it is a price, not an index. */
  private async sellRateFor(
    amountUsdc: number,
    fiat: RampCurrency,
    network: string,
  ): Promise<number | null> {
    const res = await getPaycrestClient()
      .getRates(network, "USDC", amountUsdc, fiat)
      .catch((e) => {
        console.warn(`[Paycrest] rate lookup failed for ${fiat} on ${network}:`, e);
        return null;
      });
    const rate = Number(res?.data?.sell?.rate);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  async createOffRampOrder(params: CreateOffRampParams): Promise<RampOrderResponse> {
    const paycrest = getPaycrestClient();
    const isFiat = params.inputMode === "fiat" && !!params.fiatAmount;
    const order = await paycrest.createOrder({
      amount: isFiat ? String(params.fiatAmount) : String(params.amountUsdc),
      amountIn: isFiat ? "fiat" : "crypto",
      source: {
        type: "crypto",
        currency: "USDC",
        network: params.network as PaycrestNetwork,
        refundAddress: params.userRefundAddress,
      },
      destination: {
        type: "fiat",
        currency: params.fiatCurrency,
        recipient: {
          institution: params.bank.bankCode,
          accountIdentifier: params.bank.accountNumber,
          accountName: params.bank.accountName,
          memo: params.bank.memo,
        },
      },
      reference: `offramp_${Date.now()}`,
    });

    const mapped = mapOrder(order);

    // ── The payout figure, priced by Paycrest ───────────────────────────
    // Attached here rather than left to the caller because the caller's estimate may have come
    // from a DIFFERENT provider — this order can be a fallback after the primary went down, and
    // recording the primary's price against a Paycrest payout is exactly the mismatch the whole
    // quoting path exists to prevent.
    const stated = statedPayout(order);
    let fiatAmount = stated.amount;
    let fiatRate = stated.rate;

    if (fiatAmount == null) {
      // In fiat mode the order was placed FOR a fiat target, so that target is the payout.
      if (isFiat && params.fiatAmount) {
        fiatAmount = params.fiatAmount;
      } else {
        fiatRate = fiatRate ?? (await this.sellRateFor(
          params.amountUsdc,
          params.fiatCurrency,
          params.network,
        )) ?? undefined;
        if (fiatRate != null) fiatAmount = params.amountUsdc * fiatRate;
      }
    }

    if (fiatAmount != null && fiatRate == null && params.amountUsdc > 0) {
      fiatRate = fiatAmount / params.amountUsdc;
    }
    if (fiatAmount == null) {
      console.warn(
        `[Paycrest] order ${mapped.id} has no payout figure and no rate to derive one — the ` +
          `receipt will fall back to the caller's estimate.`,
      );
    }

    return {
      ...mapped,
      fiatAmount: fiatAmount != null ? String(fiatAmount) : undefined,
      fiatRate,
    };
  }

  async getOrder(orderId: string): Promise<RampOrderResponse> {
    const paycrest = getPaycrestClient();
    return mapOrder(await paycrest.getOrder(orderId));
  }

  async getRates(amount: number, fiat: RampCurrency): Promise<RampRateResponse> {
    const paycrest = getPaycrestClient();
    const res = await paycrest.getRates("base", "USDC", amount, fiat);
    return { data: { buy: res.data.buy, sell: res.data.sell } };
  }

  async verifyAccount(
    institution: string,
    accountNumber: string,
    currency: RampCurrency = "NGN",
  ): Promise<RampVerifyAccountResponse> {
    const paycrest = getPaycrestClient();
    return paycrest.verifyAccount(institution, accountNumber, currency);
  }

  async getInstitutions(currency: RampCurrency): Promise<{ data: RampInstitution[] }> {
    const paycrest = getPaycrestClient();
    return paycrest.getInstitutions(currency);
  }

  async getCurrencies(): Promise<{ data: RampCurrencyDetail[] }> {
    const paycrest = getPaycrestClient();
    return paycrest.getCurrencies();
  }

  async getSettlementNetworks(): Promise<string[]> {
    // Paycrest settles off-ramp on these EVM networks (its documented coverage).
    return ["base", "polygon", "ethereum"];
  }
}
