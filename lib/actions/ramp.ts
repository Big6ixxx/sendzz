"use server";

import { requireUserId } from "@/lib/auth/session";
import { toUserSafeMessage } from "@/lib/errors/sanitize";
import { Ramp } from "@/lib/ramp";
import { isBridgeable } from "@/lib/circle/gateway";
import { applyFee, getCorridorFee, getProviderFee, resolveFeeTreasury } from "@/lib/ramp/fees";
import { kycGuard } from "@/lib/kyc/guard";
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
 * The provider's per-corridor fee in USDC, added on top of the base amount. 0 for Paycrest.
 *
 * Needed client-side BEFORE the order exists — the balance check, route planner and
 * consolidation amount all have to size on base + platform fee + corridor fee.
 */
export async function getCorridorFeeAction(
  provider: RampProviderName,
  currency: string,
): Promise<number> {
  return getCorridorFee(provider, currency);
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
  userAddress,
  refundAccount,
  fiatCurrency = "NGN",
  network = "base",
  accessToken,
}: {
  amountFiat: number;
  userAddress: string;
  accessToken?: string;
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
    // Identity from the session — see the note in executeOffRamp. A caller-supplied id here
    // would let a deposit (and its KYC-limit consumption) be booked to another account.
    const session = await requireUserId(accessToken);
    const userId = session.userId;
    const userEmail = session.email;

    // KYC limit guard for on-ramps.
    // Convert fiat amount → USD equivalent using the live buy rate before
    // checking limits. USDC is pegged 1:1 to USD, so amountUsdc ≈ amountUsd.
    // If the rate fetch fails we still enforce the guard using a conservative
    // fallback of 1 (treats fiat amount as USD — safe to over-enforce briefly).
    let amountUsd: number;
    try {
      const rates = await Ramp.getRates(amountFiat, fiatCurrency);
      const buyRate = rates.data.buy?.rate;
      amountUsd = buyRate && buyRate > 0 ? amountFiat / buyRate : amountFiat;
    } catch {
      console.warn(`[KYC onRamp] Could not fetch ${fiatCurrency} rate — using raw fiat amount as conservative USD estimate`);
      amountUsd = amountFiat;
    }

    const guard = await kycGuard(userId, amountUsd);
    if (!guard.allowed) {
      throw Object.assign(
        new Error(guard.message),
        { reason: guard.reason, bindingPeriod: guard.bindingPeriod },
      );
    }

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
  memo?: string,
): Promise<RampOrderResponse> {
  try {
    const order = await Ramp.createOffRampOrder({
      amountUsdc,
      fiatAmount,
      inputMode,
      bank: { accountNumber, bankCode, accountName, memo },
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
      memo,
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
  bank: { accountNumber: string; accountName: string; bankName: string; memo?: string };
  userRefundAddress: string;
  fiatCurrency: RampCurrency;
  network: RampNetwork;
  consolidated?: boolean;
  accessToken?: string;
}): Promise<{ order: RampOrderResponse; provider: RampProviderName }> {
  // ── Identity ────────────────────────────────────────────────────────────
  // Taken from the session, never from `params`. This action moves money and records it
  // against an account, so a caller-supplied userId/userEmail would let someone charge a
  // withdrawal to another account — and, because the KYC guard is keyed on that id, evade
  // their own spending limit by naming a fresh one.
  const session = await requireUserId(params.accessToken);
  const userId = session.userId;
  const userEmail = session.email;

  // ── KYC & Limit Guard ───────────────────────────────────────────────────
  const guard = await kycGuard(userId, params.amountUsdc);
  if (!guard.allowed) {
    throw Object.assign(
      new Error(guard.message),
      { reason: guard.reason, bindingPeriod: guard.bindingPeriod },
    );
  }
  // Constrain to providers that can settle on the chosen network
  const providersToTry = await Ramp.offRampProviderOrder(params.fiatCurrency, params.network);
  let lastError: unknown =
    providersToTry.length === 0
      ? new Error(`No off-ramp provider can settle ${params.fiatCurrency} on ${params.network}`)
      : new Error("No off-ramp provider available");

  const skipped: string[] = [];

  for (const provider of providersToTry) {
    try {
      // Fee config for this provider. For on-chain collection, resolve the treasury address
      // for the settlement chain BEFORE creating an order — fail-closed on a misconfig so we
      // never create a payout we can't take our fee on (this just moves to the next provider).
      //
      // This is the quietest way a provider drops out: with no treasury configured, the
      // provider is skipped before an order exists, so nothing appears in the ledger and the
      // only trace is this log line. Name it explicitly — an unconfigured treasury looks
      // exactly like "the provider doesn't support this corridor" from the outside.
      const feeCfg = getProviderFee(provider);
      let feeAddress: string | undefined;
      if (feeCfg.collection === "onchain" && feeCfg.percent > 0) {
        try {
          feeAddress = resolveFeeTreasury(provider, params.network);
        } catch (feeErr) {
          const detail = feeErr instanceof Error ? feeErr.message : String(feeErr);
          skipped.push(`${provider}: ${detail}`);
          console.error(
            `[Action] executeOffRamp: SKIPPING ${provider} — fee treasury not configured for ` +
              `${params.network}. Set ${provider.toUpperCase()}_FEE_TREASURY_${params.network.toUpperCase()}. ${detail}`,
          );
          continue;
        }
      }

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
          memo: params.bank.memo,
        },
        userRefundAddress: params.userRefundAddress,
        userEmail: userEmail,
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
        userEmail: userEmail,
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
        memo: params.bank.memo || undefined,
      });

      console.log(`[Action] executeOffRamp: order ${created.id} created on ${provider}`);
      return { order: created, provider };
    } catch (e) {
      lastError = e;
      console.error(`[Action] executeOffRamp: ${provider} failed, trying next:`, e);
    }
  }
  // Every capable provider dropped out. Log why (config vs. genuine failure) so an
  // unconfigured corridor is distinguishable from a provider outage.
  if (skipped.length > 0) {
    console.error(
      `[Action] executeOffRamp: no provider could settle ${params.fiatCurrency} on ` +
        `${params.network}. Skipped for configuration:\n` +
        skipped.map((sk) => `  • ${sk}`).join("\n"),
    );
  }

  const rawMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    toUserSafeMessage(rawMessage) ??
      `Withdrawals to ${params.fiatCurrency} are unavailable right now. Please try again later.`,
  );
}

/**
 * Verify a bank account (account number → account name).
 *
 * Providers are tried in the order that can actually serve this currency. The generic router
 * fallback isn't currency-aware, so an RWF lookup was being sent to a provider that doesn't
 * cover Rwanda, where it hung until the gateway timed out — and because that fallback's last
 * call is unguarded, the error escaped and took the page down with a 500 instead of showing
 * as a failed verification.
 */
export async function verifyBankAccount(
  institution: string,
  accountNumber: string,
  currency?: string,
  provider?: RampProviderName,
) {
  const fiat = currency ?? "NGN";

  // The caller's pinned provider first (the withdraw flow resolved the bank code against it),
  // then everything else that supports this currency.
  const ordered = await Ramp.offRampProviderOrder(fiat).catch(() => [] as RampProviderName[]);
  const candidates = [
    ...(provider ? [provider] : []),
    ...ordered.filter((p) => p !== provider),
  ];
  if (candidates.length === 0) candidates.push("paycrest");

  const failures: { provider: RampProviderName; message: string }[] = [];
  for (const p of candidates) {
    try {
      const result = await Ramp.verifyAccountFor(p, institution, accountNumber, fiat);
      const name =
        typeof result?.data === "string" ? result.data : result?.data?.accountName;
      if (name) return result;
      failures.push({ provider: p, message: "no account name returned" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ provider: p, message });
    }
  }

  console.error(
    `[Action] verifyBankAccount failed for ${fiat} / ${institution}:\n` +
      failures.map((f) => `  • ${f.provider}: ${f.message}`).join("\n"),
  );

  // Prefer a specific failure over a vague one. "temporarily unavailable" is true but useless,
  // and when it came from a provider tried *after* the right one it actively hid the answer.
  const isVague = (m: string) =>
    /temporarily unavailable|didn't respond|couldn't reach|unexpected response|try again shortly/i.test(m);
  const chosen = failures.find((f) => !isVague(f.message)) ?? failures[0];

  throw new Error(
    toUserSafeMessage(chosen?.message) ??
      "We couldn't verify this account. Check the details and try again.",
  );
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
  if (provider) {
    try {
      const res = await Ramp.institutionsFor(provider, currency);
      if (res.data && res.data.length > 0) return res;
    } catch (err) {
      console.warn(
        `[Action] getInstitutions: ${provider} failed for ${currency}, attempting fallback`,
        err,
      );
    }
  }
  return await Ramp.getInstitutions(currency);
}

export async function getCurrencies() {
  return await Ramp.getCurrencies();
}

/**
 * Chains the active off-ramp provider can settle USDC on. Drives withdrawal routing
 * dynamically instead of a hardcoded network list.
 *
 * The provider's list states what *it* supports; the filter states what *we* enable.
 * Ethereum L1 is off (see BRIDGE_DISABLED_CHAINS in lib/circle/gateway), and since we
 * no longer track L1 balances it must not reach the withdrawal source picker either.
 */
export async function getRampNetworks(): Promise<string[]> {
  const FALLBACK = ["base", "polygon" /* , "ethereum" */];
  try {
    const networks = (await Ramp.getSettlementNetworks()).filter(isBridgeable);
    return networks.length > 0 ? networks : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * Finalize a Bitnob payout, but ONLY once its on-chain deposit has actually settled.
 *
 * Bitnob accepts `finalize` as soon as a deposit is *detected*, so calling it on transaction
 * broadcast released payouts before the money arrived. We verify settlement ourselves first.
 *
 * With no address or tx hash there is nothing to verify against, so we refuse rather than
 * guess; the webhook and reconcile cron re-drive it later from `provider_metadata`.
 */
export async function finalizeBitnobPayoutAction(
  quoteId: string,
  deposit?: {
    address?: string;
    txHash?: string;
    /** What the payout will debit — base + Bitnob corridor fee. */
    amountUsdc?: number;
  },
): Promise<boolean> {
  if (!quoteId) return false;
  const { getBitnobClient } = await import("@/lib/bitnob/client");
  const client = getBitnobClient();

  if (!deposit?.address && !deposit?.txHash) {
    console.error(
      `[Action] finalizeBitnobPayoutAction: REFUSING to finalize ${quoteId} — no deposit ` +
        `address or tx hash to verify against. Payout stays pending_address_deposit; the ` +
        `webhook/reconcile cron will re-drive it.`,
    );
    return false;
  }

  for (let attempt = 1; attempt <= 15; attempt++) {
    const settled = await client
      .findSettledDeposit({
        address: deposit.address,
        txHash: deposit.txHash,
        minAmountUsdc: deposit.amountUsdc,
      })
      .catch((e) => {
        console.warn(`[Action] finalizeBitnobPayoutAction: deposit lookup failed:`, e);
        return null;
      });

    if (!settled) {
      console.log(
        `[Action] finalizeBitnobPayoutAction: deposit for ${quoteId} not settled yet ` +
          `(attempt ${attempt}/15) — holding payout.`,
      );
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }

    console.log(
      `[Action] finalizeBitnobPayoutAction: deposit ${settled.reference} settled ` +
        `(${settled.amountUsdc} USDC) — finalizing ${quoteId}.`,
    );
    try {
      await client.finalizePayout(quoteId);
      console.log(`[Action] finalizeBitnobPayoutAction: payout finalized for ${quoteId}`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/pending_address_deposit|cannot transition/i.test(msg)) {
        // Deposit is settled on our side but Bitnob hasn't opened the transition yet.
        console.log(`[Action] finalizeBitnobPayoutAction: ${quoteId} not transitionable yet (attempt ${attempt}/15)...`);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      console.error(`[Action] finalizeBitnobPayoutAction failed for ${quoteId}:`, msg);
      return false;
    }
  }
  console.warn(
    `[Action] finalizeBitnobPayoutAction: gave up waiting on the deposit for ${quoteId} — ` +
      `NOT finalized. Reconcile cron will retry.`,
  );
  return false;
}


