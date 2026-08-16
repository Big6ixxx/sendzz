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
    return mapOrder(order);
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
