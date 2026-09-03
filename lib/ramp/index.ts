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
  QuoteOffRampParams,
  RampPayoutQuote,
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

function normalizeBankName(s: string): string {
  const normalized = (s || "")
    .toLowerCase()
    .replace(/\b(bank|plc|ltd|limited|nigeria|microfinance|mfb|company)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

  // Map common abbreviations and aliases to a single canonical term
  if (
    normalized === "gtb" ||
    normalized === "gt" ||
    normalized === "gtbank" ||
    normalized === "guarantytrust" ||
    normalized === "guarantytrustbank"
  ) {
    return "gtb";
  }
  if (normalized === "uba" || normalized === "unitedbankforafrica") {
    return "uba";
  }
  if (normalized === "fcmb" || normalized === "firstcitymonument") {
    return "fcmb";
  }
  if (normalized === "first" || normalized === "firstbank" || normalized === "fbn") {
    return "firstbank";
  }
  if (normalized === "stanbic" || normalized === "stanbicibtc" || normalized === "ibtc") {
    return "stanbic";
  }
  if (normalized === "access" || normalized === "accessbank") {
    return "access";
  }
  if (normalized === "zenith" || normalized === "zenithbank") {
    return "zenith";
  }
  if (normalized === "sterling" || normalized === "sterlingbank") {
    return "sterling";
  }
  if (normalized === "wema" || normalized === "wemabank") {
    return "wema";
  }
  if (normalized === "union" || normalized === "unionbank") {
    return "union";
  }
  if (normalized === "keystone" || normalized === "keystonebank") {
    return "keystone";
  }
  if (normalized === "polaris" || normalized === "polarisbank") {
    return "polaris";
  }
  if (normalized === "fidelity" || normalized === "fidelitybank") {
    return "fidelity";
  }
  if (normalized === "ecobank") {
    return "ecobank";
  }

  return normalized;
}

/** Best-effort match a canonical bank name to a provider's institution → its bank_code. */
/**
 * Resolve what the user picked into the code a payout is addressed with.
 *
 * Exported for tests: this is the step that, when it guesses, addresses a payout to the wrong
 * institution — and nothing catches that until the provider rejects it, with the money already
 * deposited. Its refusals matter as much as its matches.
 */
export function matchBank(
  institutions: RampInstitution[],
  bankName: string,
): { code: string; name: string } | null {
  const raw = (bankName || "").trim();
  if (!raw) return null;

  // Callers pass `bankName || bankCode`, so what arrives is sometimes a CODE. Recognise that
  // first: a code is an exact identifier and matching it by name is both unnecessary and
  // dangerous — see the fuzzy guard below.
  const asCode = raw.toUpperCase();
  const byCode = institutions.find(
    (b) =>
      b.code?.trim().toUpperCase() === asCode ||
      b.institutionCode?.trim().toUpperCase() === asCode,
  );
  if (byCode) return { code: byCode.code, name: byCode.name };

  const target = normalizeBankName(bankName);
  if (!target) return null;

  const exact = institutions.find((b) => normalizeBankName(b.name) === target);
  if (exact) return { code: exact.code, name: exact.name };

  // Fuzzy matching is for human spellings ("GTB" → "Guaranty Trust Bank"), not identifiers. An
  // unrecognised code reaching here would substring-match *some* institution and hand back a
  // plausible code for the wrong bank — which the provider only rejects at payout, once the
  // user's money has already arrived. Refusing to guess turns that into a clean failure.
  const looksLikeCode = /\d/.test(target) || !/[a-z]/.test(target);
  if (looksLikeCode) return null;

  const partial = institutions.find((b) => {
    const n = normalizeBankName(b.name);
    return n.length > 2 && (n.includes(target) || target.includes(n));
  });
  return partial ? { code: partial.code, name: partial.name } : null;
}

/**
 * Corridors a provider must not be offered for, whatever its own API claims it supports.
 *
 * A provider's capability list says what it serves in general. This says what it is serving
 * *correctly right now* — which is not the same thing, and only we can know it.
 *
 * KES/bitnob: Bitnob began rejecting `network: "SAFARICOM"` on `KE mobile_money` around
 * 2026-08-29 with `Invalid beneficiary destination`. It fails at `initialize`, which under
 * deferred settlement happens AFTER the user's USDC has left — so every attempt strands money
 * rather than merely failing. Three withdrawals and 213 USDC were stranded before it was
 * caught. Bitnob's API exposes no network enum to correct against (`/payouts/banks/KE` returns
 * nothing), so there is no fix to make on our side until they answer.
 *
 * Overridable at runtime so a corridor can be restored, or another blocked, with a restart
 * rather than a deploy: `RAMP_OFFRAMP_BLOCK="KES:bitnob,GHS:bitnob"`.
 */
const OFFRAMP_BLOCKED: Record<string, RampProviderName[]> = {
  // Empty. KES lived here from 2026-09-02 while Bitnob rejected `network: "SAFARICOM"` on
  // Kenyan payouts; the value is now `mpesa`, taken from their published enum, and initialize
  // runs before the user signs again — so a wrong value costs an error rather than a deposit.
};

function blockedProviders(currency: string): Set<string> {
  const fromEnv = process.env.RAMP_OFFRAMP_BLOCK;
  const wanted = currency.toUpperCase();

  // `!== undefined`, not truthy: an empty string is how an operator clears the list, and
  // treating it as "unset" would silently reinstate the hardcoded default — leaving a corridor
  // blocked after someone had explicitly unblocked it, with the logs insisting it was cleared.
  const names =
    fromEnv !== undefined
      ? fromEnv
          .split(",")
          .map((pair) => pair.split(":").map((x) => x?.trim()))
          .filter(([cur, provider]) => cur?.toUpperCase() === wanted && provider)
          .map(([, provider]) => provider!)
      : (OFFRAMP_BLOCKED[wanted] ?? []);

  return new Set(names.map((n) => n.toLowerCase()));
}

/**
 * A blocked corridor is worth saying once, not on every quote.
 *
 * `offRampProviderOrder` runs for each quote refresh, each order and each network lookup, so a
 * warning inside the loop repeats several times a minute for as long as the block stands. Noise
 * at that rate is how a real error goes unread — which is exactly how the KES failure sat in
 * the logs unnoticed.
 */
const announcedBlocks = new Set<string>();

function announceBlock(provider: string, currency: string) {
  const key = `${currency}:${provider}`;
  if (announcedBlocks.has(key)) return;
  announcedBlocks.add(key);
  console.warn(
    `[Ramp] ${provider} is blocked for ${currency} and will not be offered. ` +
      `See OFFRAMP_BLOCKED in lib/ramp/index.ts, or RAMP_OFFRAMP_BLOCK to change it.`,
  );
}

export const Ramp = {
  createOnRampOrder(params: CreateOnRampParams): Promise<RampOrderResponse> {
    return withFallback("onRamp", (p) => p.createOnRampOrder(params));
  },

  // ── Pinned-provider off-ramp ────────────────────────────────────────────────
  // The bank-committed off-ramp flow pins ONE provider (banks + verify + order + status
  // all consistent). Fallback is handled by the caller re-resolving the bank code for the
  // next provider — NOT by per-call switching (which breaks because bank codes differ).

  /**
   * Ordered off-ramp providers to try for a currency, optionally constrained to those that can
   * settle on `network`. When a network is given, a provider that can't settle there is dropped
   * entirely — so e.g. a Solana-settled withdrawal returns only Bitnob and never falls back to
   * Paycrest (which can't settle on Solana).
   */
  async offRampProviderOrder(
    currency: RampCurrency,
    network?: string,
  ): Promise<RampProviderName[]> {
    const wanted = network?.toLowerCase();
    const out: RampProviderName[] = [];

    // Bitnob first, everything else after it in its existing order.
    //
    // Written as a rank rather than `a.name === "bitnob" ? -1 : 1`, which ignored `b` entirely
    // and never returned 0 — so for any two non-Bitnob providers it claimed the first was
    // greater, which is not a consistent ordering and is left to the engine to interpret.
    const rank = (name: string) => (name === "bitnob" ? 0 : 1);
    const sorted = [...allProviders()].sort((a, b) => rank(a.name) - rank(b.name));

    const blocked = blockedProviders(currency);

    for (const p of sorted) {
      if (!p.capabilities.offRamp) continue;
      if (blocked.has(p.name.toLowerCase())) {
        announceBlock(p.name, currency);
        continue;
      }
      const supportsCurrency = await p.supportsCurrency(currency).catch(() => true);
      if (!supportsCurrency) continue;
      if (wanted) {
        const nets = await p.getSettlementNetworks().catch(() => [] as string[]);
        if (!nets.some((n) => n.toLowerCase() === wanted)) continue;
      }
      out.push(p.name);
    }
    return out;
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

  /**
   * A binding payout quote from `provider`, or null when it cannot strike one.
   *
   * Null is a real answer, not an error: the caller falls back to the indicative rate and says
   * so. Silently substituting the rate here is what made an estimate look like a guarantee.
   */
  async quoteOffRampFor(
    provider: RampProviderName,
    params: QuoteOffRampParams,
  ): Promise<RampPayoutQuote | null> {
    const p = byName(provider);
    if (!p.quoteOffRamp) return null;
    try {
      return await p.quoteOffRamp(params);
    } catch (e) {
      console.warn(`[Ramp] ${provider} could not quote ${params.fiatCurrency}:`, e);
      return null;
    }
  },

  settlementNetworksFor(provider: RampProviderName): Promise<string[]> {
    return byName(provider).getSettlementNetworks();
  },

  /**
   * Chains a withdrawal in `currency` can actually settle on — the union across every provider
   * still eligible for that corridor.
   *
   * Not the same as asking the primary provider what it supports. Once KES stopped routing to
   * Bitnob, Bitnob's list still advertised Stellar and Solana, but the only provider left for
   * KES settles on EVM alone. Offering Stellar would send a user's funds to a chain no provider
   * could pay out from — failing at order creation if we are lucky, and stranding the deposit
   * if we are not.
   */
  async settlementNetworksForCurrency(currency: RampCurrency): Promise<string[]> {
    const names = await Ramp.offRampProviderOrder(currency);
    const lists = await Promise.all(
      names.map((n) => byName(n).getSettlementNetworks().catch(() => [] as string[])),
    );
    return [...new Set(lists.flat().map((n) => n.toLowerCase()))];
  },

  /**
   * The reverse of `resolveBankCode`: a provider's bank_code back to the bank's display name.
   *
   * Receipts hold the code, because that is what a payout is addressed with — but "000013" tells
   * a user nothing about where their money went. The name is derived here, from the provider's
   * own institution list, rather than stored: the list is already fetched and cached for the
   * withdraw form, and a stored copy would be one more thing to migrate and keep true.
   *
   * Returns null when the code is unknown, so callers fall back to showing the code rather than
   * inventing a bank.
   */
  async resolveBankName(
    provider: RampProviderName,
    code: string,
    currency: RampCurrency,
  ): Promise<string | null> {
    if (!code) return null;
    const wanted = code.trim().toUpperCase();
    try {
      const { data } = await byName(provider).getInstitutions(currency);
      const hit = data.find(
        (i) =>
          i.code?.trim().toUpperCase() === wanted ||
          i.institutionCode?.trim().toUpperCase() === wanted,
      );
      return hit?.name?.trim() || null;
    } catch (e) {
      console.warn(`[Ramp] could not resolve bank name for ${code} (${currency}):`, e);
      return null;
    }
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

  async getInstitutions(currency: RampCurrency): Promise<{ data: RampInstitution[] }> {
    const combined: RampInstitution[] = [];
    const seen = new Set<string>();

    for (const p of allProviders()) {
      if (!p.capabilities.institutions) continue;
      try {
        const res = await p.getInstitutions(currency);
        if (res.data && res.data.length > 0) {
          for (const inst of res.data) {
            const key = (inst.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            if (!key || seen.has(key)) continue;
            seen.add(key);
            combined.push(inst);
          }
        }
      } catch (err) {
        console.warn(
          `[Ramp] ${p.name} failed to getInstitutions for ${currency}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return { data: combined };
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
