/**
 * Paycrest adapter. Wraps the existing PaycrestClient and maps Paycrest's API into the
 * neutral Ramp* types. This is the fallback provider (and still primary for capabilities
 * Bitnob doesn't expose: bank verification, institutions list, fiat on-ramp).
 */
import { getPaycrestClient } from "@/lib/paycrest/client";
import { calculatePaycrestBaseAmount } from "@/lib/paycrest/config";
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

  async supportsCurrency(currency: RampCurrency): Promise<boolean> {
    try {
      const { data } = await this.getCurrencies();
      return data.some((c) => c.code === currency);
    } catch {
      // If we can't list currencies, assume Paycrest can try (it's the safety net).
      return true;
    }
  }

  async createOnRampOrder(params: CreateOnRampParams): Promise<RampOrderResponse> {
    const paycrest = getPaycrestClient();
    const baseAmount = calculatePaycrestBaseAmount(params.amountFiat);
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
