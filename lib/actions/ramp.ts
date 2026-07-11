"use server";

import { Ramp } from "@/lib/ramp";
import { applyFee, getProviderFee, resolveFeeTreasury } from "@/lib/ramp/fees";
import type {
  RampCurrency,
  RampNetwork,
  RampOrderResponse,
  RampProviderName,
} from "@/lib/ramp";

/**
 * Platform fee percentage for a provider — for UI (fee line, balance math). The actual fee
 * amount + treasury address are resolved server-side and embedded in the order (see below).
 */
export async function getProviderFeePercent(
  provider: RampProviderName,
): Promise<number> {
  return getProviderFee(provider).percent;
}

/**
 * Fiat on/off-ramp server actions.
 *
 * These are provider-neutral: they delegate to the Ramp router (Bitnob primary, Paycrest
 * fallback) and never reference a specific provider's SDK. The router decides which
 * provider serves each call and which provider owns each created order.
 */

/**
 * ON-RAMP — buy USDC with fiat. Returns the bank/virtual account the user funds.
 */
export async function initiateOnRamp({
  amountFiat,
  userId,
  userAddress,
  userEmail,
  refundAccount,
  fiatCurrency = "NGN",
  network = "base",
}: {
  amountFiat: number;
  userId: string;
  userAddress: string;
  userEmail: string;
  refundAccount: {
    institution: string;
    accountIdentifier: string;
    accountName: string;
  };
  fiatCurrency?: RampCurrency;
  /** Chain the purchased USDC is delivered to (the user's home chain). */
  network?: RampNetwork;
}): Promise<RampOrderResponse> {
  try {
    const order = await Ramp.createOnRampOrder({
      amountFiat,
      userId,
      userAddress,
      userEmail,
      refundAccount,
      fiatCurrency,
      network,
    });

    // Record in internal ledger
    const { recordDeposit } = await import("@/lib/supabase/transactions");
    await recordDeposit({
      userEmail,
      amountFiat: Number(order.providerAccount?.amountToTransfer || amountFiat),
      currencyFiat: fiatCurrency,
      amountUsdc: Number(order.amount),
      status: "pending",
      paycrestTxId: order.id,
      network,
      provider: order.provider,
    });

    return order;
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`Error initiating on-ramp for ${fiatCurrency}:`, err.message || error);
    throw error;
  }
}

/**
 * Live fiat→USDC buy rate.
 */
export async function getOnRampRate(fiat: string = "NGN"): Promise<number | null> {
  try {
    const rates = await Ramp.getRates(1, fiat);
    const buyRate = rates.data.buy?.rate;
    return buyRate ? Number(buyRate) : null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) return null;
    throw error;
  }
}

/**
 * Current status of an order. `provider` must match the provider that created it
 * (defaults to paycrest for legacy orders recorded before provider tracking).
 */
export async function getOrderStatus(
  orderId: string,
  provider: RampProviderName = "paycrest",
) {
  return Ramp.getOrder(orderId, provider);
}

/**
 * Resume helper — fetch an order by id for a status page.
 */
export async function checkOrderById(
  orderId: string,
  provider: RampProviderName = "paycrest",
) {
  try {
    return await Ramp.getOrder(orderId, provider);
  } catch {
    return null;
  }
}

export async function getOffRampRate(fiat: string = "NGN"): Promise<number> {
  const rates = await Ramp.getRates(1, fiat);
  const sellRate = rates.data.sell?.rate;
  if (!sellRate) throw new Error(`Could not fetch offramp rate for ${fiat}`);
  return Number(sellRate);
}

/**
 * OFF-RAMP QUOTE
 */
export async function getOffRampQuote(amountUsdc: number, fiat: string = "NGN") {
  try {
    const rates = await Ramp.getRates(amountUsdc, fiat);
    const rate = rates.data.sell?.rate || 0;
    return {
      rate,
      payoutAmount: amountUsdc * rate,
      provider: rates.data.sell?.provider_id || "ramp",
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`Error fetching off-ramp rates for ${fiat}:`, err.message || error);
    throw error;
  }
}

/**
 * OFF-RAMP EXECUTION — sell USDC for fiat. Returns the order (incl. receive address).
 */
export async function finalizeOffRamp(
  amountUsdc: number,
  accountNumber: string,
  bankCode: string,
  accountName: string,
  userRefundAddress: string,
  userEmail: string,
  fiat: RampCurrency = "NGN",
  fiatAmount?: number,
  exchangeRate?: number,
  inputMode: "fiat" | "usdc" = "usdc",
  network: RampNetwork = "base",
  /** True when funds were spread across chains and auto-bridged onto `network` first. */
  consolidated: boolean = false,
): Promise<RampOrderResponse> {
  try {
    const order = await Ramp.createOffRampOrder({
      amountUsdc,
      fiatAmount,
      inputMode,
      bank: { accountNumber, bankCode, accountName },
      userRefundAddress,
      userEmail,
      fiatCurrency: fiat,
      network,
    });

    const isFiat = inputMode === "fiat" && !!fiatAmount;
    const finalAmountUsdc = isFiat ? Number(order.amount || amountUsdc) : amountUsdc;

    // Record in internal ledger
    const { recordWithdrawal } = await import("@/lib/supabase/transactions");
    await recordWithdrawal({
      userEmail,
      amountUsdc: finalAmountUsdc,
      fiatCurrency: fiat,
      fiatAmount: isFiat ? fiatAmount : fiatAmount || amountUsdc * (exchangeRate || 1),
      exchangeRate,
      bankAccountMasked: accountNumber.replace(/.(?=.{4})/g, "*"),
      institutionCode: bankCode,
      status: "processing",
      paycrestOrderId: order.id,
      sourceChain: network,
      consolidated,
      provider: order.provider,
      bitnobQuoteId: order.providerRef,
      bitnobDepositAddress: order.providerAccount?.receiveAddress,
    });

    return order;
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`Error finalizing off-ramp for ${fiat}:`, err.message || error);
    throw error;
  }
}

/**
 * Create an off-ramp order using the pinned-provider model with canonical bank identity.
 *
 * Tries off-ramp providers in order; for each it RESOLVES that provider's bank_code from
 * the canonical bank name (codes differ per provider), then creates the order. On failure
 * it moves to the next provider and re-resolves — which is why the caller passes a bank
 * NAME, never a raw code. The winning provider is pinned; its receive address is returned
 * for the USDC transfer, and the withdrawal is recorded against that provider.
 */
export async function executeOffRamp(params: {
  amountUsdc: number;
  fiatAmount?: number;
  exchangeRate?: number;
  inputMode: "fiat" | "usdc";
  bank: { accountNumber: string; accountName: string; bankName: string };
  userRefundAddress: string;
  userEmail: string;
  fiatCurrency: RampCurrency;
  network: RampNetwork;
  consolidated?: boolean;
}): Promise<{ order: RampOrderResponse; provider: RampProviderName }> {
  // Constrain to providers that can settle on the chosen network — so a Solana withdrawal
  // never falls back to Paycrest (which can't settle on Solana).
  const providersToTry = await Ramp.offRampProviderOrder(params.fiatCurrency, params.network);
  let lastError: unknown =
    providersToTry.length === 0
      ? new Error(`No off-ramp provider can settle ${params.fiatCurrency} on ${params.network}`)
      : new Error("No off-ramp provider available");

  for (const provider of providersToTry) {
    try {
      // Fee config for this provider. For on-chain collection, resolve the treasury address
      // for the settlement chain BEFORE creating an order — fail-closed on a misconfig so we
      // never create a payout we can't take our fee on (this just moves to the next provider).
      const feeCfg = getProviderFee(provider);
      const feeAddress =
        feeCfg.collection === "onchain" && feeCfg.percent > 0
          ? resolveFeeTreasury(provider, params.network)
          : undefined;

      const resolved = await Ramp.resolveBankCode(
        provider,
        params.bank.bankName,
        params.fiatCurrency,
      );
      if (!resolved) {
        lastError = new Error(`${provider} has no bank matching "${params.bank.bankName}"`);
        console.warn(`[Action] executeOffRamp: ${(lastError as Error).message}`);
        continue;
      }

      const created = await Ramp.createOffRampOrderFor(provider, {
        amountUsdc: params.amountUsdc,
        fiatAmount: params.fiatAmount,
        inputMode: params.inputMode,
        bank: {
          accountNumber: params.bank.accountNumber,
          bankCode: resolved.code,
          accountName: params.bank.accountName,
        },
        userRefundAddress: params.userRefundAddress,
        userEmail: params.userEmail,
        fiatCurrency: params.fiatCurrency,
        network: params.network,
      });

      const isFiat = params.inputMode === "fiat" && !!params.fiatAmount;
      const finalAmountUsdc = isFiat ? Number(created.amount || params.amountUsdc) : params.amountUsdc;

      // Platform fee on the base amount (resolved server-side so the client can execute it
      // without reading secret env). Embedded in the order for the transfer step.
      const { fee } = applyFee(finalAmountUsdc, provider);
      if (feeCfg.percent > 0) {
        created.fee = {
          percent: feeCfg.percent,
          usdc: fee.toFixed(6),
          collection: feeCfg.collection,
          address: feeAddress,
        };
      }

      const { recordWithdrawal } = await import("@/lib/supabase/transactions");
      await recordWithdrawal({
        userEmail: params.userEmail,
        amountUsdc: finalAmountUsdc,
        fiatCurrency: params.fiatCurrency,
        fiatAmount: isFiat
          ? params.fiatAmount
          : params.fiatAmount ?? params.amountUsdc * (params.exchangeRate ?? 1),
        exchangeRate: params.exchangeRate,
        bankAccountMasked: params.bank.accountNumber.replace(/.(?=.{4})/g, "*"),
        institutionCode: resolved.code,
        status: "processing",
        paycrestOrderId: created.id,
        sourceChain: params.network,
        consolidated: params.consolidated,
        provider: created.provider,
        bitnobQuoteId: created.provider === "bitnob" ? created.providerRef : undefined,
        bitnobDepositAddress:
          created.provider === "bitnob" ? created.providerAccount?.receiveAddress : undefined,
        feeUsdc: feeCfg.percent > 0 ? fee : undefined,
        feePercent: feeCfg.percent > 0 ? feeCfg.percent : undefined,
      });

      console.log(`[Action] executeOffRamp: order ${created.id} created on ${provider}`);
      return { order: created, provider };
    } catch (e) {
      lastError = e;
      console.error(`[Action] executeOffRamp: ${provider} failed, trying next:`, e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Verify a bank account (account number → account name).
 */
export async function verifyBankAccount(
  institution: string,
  accountNumber: string,
  currency?: string,
  provider?: RampProviderName,
) {
  console.log(
    `[Action] verifyBankAccount: ${institution} / ${accountNumber} / ${currency ?? "NGN"} / ${provider ?? "auto"}`,
  );
  try {
    const result = provider
      ? await Ramp.verifyAccountFor(provider, institution, accountNumber, currency)
      : await Ramp.verifyAccount(institution, accountNumber, currency);
    console.log(`[Action] verifyBankAccount result:`, result);
    return result;
  } catch (error) {
    console.error(`[Action] verifyBankAccount failed:`, error);
    throw error;
  }
}

/**
 * Ordered list of off-ramp providers to try for a currency (pinned flow). The withdraw
 * flow uses the first; on failure it re-resolves the bank for the next via resolveBankCode.
 */
export async function getOffRampProviderOrder(
  currency: string = "NGN",
): Promise<RampProviderName[]> {
  return Ramp.offRampProviderOrder(currency);
}

/**
 * Resolve a provider-specific bank code from a canonical bank name — the primitive that
 * makes saved accounts + provider fallback portable (bank codes differ per provider).
 */
export async function resolveBankCode(
  provider: RampProviderName,
  bankName: string,
  currency: string = "NGN",
): Promise<{ code: string; name: string } | null> {
  return Ramp.resolveBankCode(provider, bankName, currency);
}

/**
 * UTILITIES
 */
export async function getInstitutions(
  currency: string = "NGN",
  provider?: RampProviderName,
) {
  return provider
    ? await Ramp.institutionsFor(provider, currency)
    : await Ramp.getInstitutions(currency);
}

export async function getCurrencies() {
  return await Ramp.getCurrencies();
}

/**
 * Chains the active off-ramp provider can settle USDC on. Drives withdrawal routing
 * dynamically instead of a hardcoded network list.
 */
export async function getRampNetworks(): Promise<string[]> {
  try {
    const networks = await Ramp.getSettlementNetworks();
    return networks.length > 0 ? networks : ["base", "polygon", "ethereum"];
  } catch {
    return ["base", "polygon", "ethereum"];
  }
}
