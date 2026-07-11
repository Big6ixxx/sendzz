/**
 * Ramp router — the single entry point the app uses for fiat on/off-ramp.
 *
 * Strategy: Bitnob is primary, Paycrest is the fallback. For each capability we try the
 * primary first and fall back when it either (a) declares the capability unsupported, or
 * (b) throws at runtime (RampUnsupportedError or any error/timeout). This implements the
 * "auto fallback on error OR unsupported" policy.
 *
 * The app never imports a concrete provider — only `getRamp()`.
 */
import { BitnobProvider } from "./providers/bitnob";
import { PaycrestProvider } from "./providers/paycrest";
import { RampUnsupportedError, type RampProvider } from "./provider";
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

// ── Provider registry ────────────────────────────────────────────────────────
// To add or remove a ramp provider, change ONLY this list (in fallback-priority order:
// primary first, last = default fallback). Everything else — routing, name lookup, and
// ledger-row → provider resolution — reads from here, so call sites don't need touching.
const REGISTRY: Array<new () => RampProvider> = [BitnobProvider, PaycrestProvider];

let instances: RampProvider[] | null = null;
function allProviders(): RampProvider[] {
  if (!instances) instances = REGISTRY.map((Ctor) => new Ctor());
  return instances;
}

function providers(): { primary: RampProvider; fallback: RampProvider } {
  const all = allProviders();
  return { primary: all[0], fallback: all[all.length - 1] };
}

function byName(name: RampProviderName): RampProvider {
  return allProviders().find((p) => p.name === name) ?? providers().fallback;
}

/** Every registered provider name (source of truth for "is this a known provider"). */
export function rampProviderNames(): RampProviderName[] {
  return allProviders().map((p) => p.name);
}

/**
 * Resolve which provider owns a ledger row (withdrawal/deposit) — used by status polling so it
 * queries the right provider. Trusts a stored `provider`, else lets a provider claim a legacy
 * row via `ownsLedgerRow`, else falls back to the default provider. Adding/removing a provider
 * needs no change here.
 */
export function resolveLedgerProvider(row: LedgerRowRef): RampProviderName {
  const all = allProviders();
  if (row.provider && all.some((p) => p.name === row.provider)) {
    return row.provider as RampProviderName;
  }
  const owner = all.find((p) => p.ownsLedgerRow?.(row));
  return (owner ?? providers().fallback).name;
}

/**
 * Run `op` on the primary if it supports `capability`, else the fallback; and if the
 * primary throws, retry on the fallback. Logs which provider served the request.
 */
async function withFallback<T>(
  capability: keyof RampCapabilities,
  op: (p: RampProvider) => Promise<T>,
): Promise<T> {
  const { primary, fallback } = providers();

  if (primary.capabilities[capability]) {
    try {
      return await op(primary);
    } catch (err) {
      if (err instanceof RampUnsupportedError) {
        console.warn(`[Ramp] ${primary.name} unsupported for ${capability} → ${fallback.name}`);
      } else {
        console.error(`[Ramp] ${primary.name} failed for ${capability}, falling back to ${fallback.name}:`, err);
      }
    }
  }
  return op(fallback);
}

/** Normalise a bank name for cross-provider matching (drop "bank/plc/ltd", punctuation). */
function normalizeBankName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\b(bank|plc|ltd|limited|nigeria|microfinance|mfb|company)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Best-effort match a canonical bank name to a provider's institution → its bank_code. */
function matchBank(
  institutions: RampInstitution[],
  bankName: string,
): { code: string; name: string } | null {
  const target = normalizeBankName(bankName);
  if (!target) return null;
  const exact = institutions.find((b) => normalizeBankName(b.name) === target);
  if (exact) return { code: exact.code, name: exact.name };
  const partial = institutions.find((b) => {
    const n = normalizeBankName(b.name);
    return n.length > 2 && (n.includes(target) || target.includes(n));
  });
  return partial ? { code: partial.code, name: partial.name } : null;
}

export const Ramp = {
  createOnRampOrder(params: CreateOnRampParams): Promise<RampOrderResponse> {
    return withFallback("onRamp", (p) => p.createOnRampOrder(params));
  },

  // ── Pinned-provider off-ramp ────────────────────────────────────────────────
  // The bank-committed off-ramp flow pins ONE provider (banks + verify + order + status
  // all consistent). Fallback is handled by the caller re-resolving the bank code for the
  // next provider — NOT by per-call switching (which breaks because bank codes differ).

  /** Ordered off-ramp providers to try for a currency (capable + supports first). */
  async offRampProviderOrder(currency: RampCurrency): Promise<RampProviderName[]> {
    const { primary, fallback } = providers();
    const order: RampProviderName[] = [];
    if (primary.capabilities.offRamp) {
      const supports = await primary.supportsCurrency(currency).catch(() => true);
      if (supports) order.push(primary.name);
    }
    if (!order.includes(fallback.name)) order.push(fallback.name);
    return order;
  },

  institutionsFor(provider: RampProviderName, currency: RampCurrency) {
    return byName(provider).getInstitutions(currency);
  },

  verifyAccountFor(
    provider: RampProviderName,
    institution: string,
    accountNumber: string,
    currency?: RampCurrency,
  ): Promise<RampVerifyAccountResponse> {
    return byName(provider).verifyAccount(institution, accountNumber, currency);
  },

  createOffRampOrderFor(provider: RampProviderName, params: CreateOffRampParams) {
    return byName(provider).createOffRampOrder(params);
  },

  settlementNetworksFor(provider: RampProviderName): Promise<string[]> {
    return byName(provider).getSettlementNetworks();
  },

  /** Resolve a provider-specific bank_code from a canonical bank name (best match). */
  async resolveBankCode(
    provider: RampProviderName,
    bankName: string,
    currency: RampCurrency,
  ): Promise<{ code: string; name: string } | null> {
    const { data } = await byName(provider).getInstitutions(currency);
    return matchBank(data, bankName);
  },

  createOffRampOrder(params: CreateOffRampParams): Promise<RampOrderResponse> {
    return withFallback("offRamp", (p) => p.createOffRampOrder(params));
  },

  /** Status lookups MUST go to the provider that created the order. */
  getOrder(orderId: string, provider: RampProviderName): Promise<RampOrderResponse> {
    return byName(provider).getOrder(orderId);
  },

  getRates(amount: number, fiat: RampCurrency): Promise<RampRateResponse> {
    return withFallback("rates", (p) => p.getRates(amount, fiat));
  },

  verifyAccount(
    institution: string,
    accountNumber: string,
    currency?: RampCurrency,
  ): Promise<RampVerifyAccountResponse> {
    return withFallback("verifyAccount", (p) =>
      p.verifyAccount(institution, accountNumber, currency),
    );
  },

  getInstitutions(currency: RampCurrency): Promise<{ data: RampInstitution[] }> {
    return withFallback("institutions", (p) => p.getInstitutions(currency));
  },

  getCurrencies(): Promise<{ data: RampCurrencyDetail[] }> {
    return withFallback("currencies", (p) => p.getCurrencies());
  },

  /** Chains the active off-ramp provider can settle on (drives withdrawal routing). */
  getSettlementNetworks(): Promise<string[]> {
    return withFallback("offRamp", (p) => p.getSettlementNetworks());
  },
};

export type { RampProvider } from "./provider";
export * from "./types";
