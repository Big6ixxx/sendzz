/**
 * Ramp router — the single entry point the app uses for fiat on/off-ramp.
 *
 * Withdrawals try Brails, then Bitnob, then Paycrest (see `offRampRank`). For the catalogue
 * calls below, Bitnob is primary and Paycrest the fallback. For each capability we try the
 * primary first and fall back when it either (a) declares the capability unsupported, or
 * (b) throws at runtime (RampUnsupportedError or any error/timeout). This implements the
 * "auto fallback on error OR unsupported" policy.
 *
 * The app never imports a concrete provider — only `getRamp()`.
 */
import { DEPOSIT_NETWORKS } from "@/lib/web3/routing";
import { BitnobProvider } from "./providers/bitnob";
import { BrailsProvider, parseBrailsInstitution } from "./providers/brails";
import type { PayoutRail } from "./fees";
import { isMobileMoneyCode } from "./msisdn";
import { PaycrestProvider } from "./providers/paycrest";
import { RampRefusedError, RampUnsupportedError, type RampProvider } from "./provider";
import type {
  CreateOffRampParams,
  CreateOnRampParams,
  LedgerRowRef,
  QuoteOffRampParams,
  RampPayoutQuote,
  RampCapabilities,
  RampCurrency,
  RampCountry,
  RampCurrencyDetail,
  RampInstitution,
  RampOrderResponse,
  RampProviderName,
  RampRateResponse,
  RampVerifyAccountResponse,
} from "./types";

// ── Provider registry ────────────────────────────────────────────────────────
// To add or remove a ramp provider, change this list (catalogue priority: primary first, last
// = default fallback). Name lookup and ledger-row → provider resolution read from here; the
// order withdrawals try providers in is `offRampRank`.
const REGISTRY: Array<new () => RampProvider> = [BitnobProvider, BrailsProvider, PaycrestProvider];

let instances: RampProvider[] | null = null;
function allProviders(): RampProvider[] {
  if (!instances) instances = REGISTRY.map((Ctor) => new Ctor());
  return instances;
}

function providers(): { primary: RampProvider; fallback: RampProvider } {
  const all = allProviders();
  return { primary: all[0], fallback: all[all.length - 1] };
}

/**
 * A provider's institution list, shared for a minute.
 *
 * The withdraw form loads the merged list, then the KYC gate and the order resolve the bank
 * against each provider's list again — each a network call, some slow (Nigeria's is ~370
 * banks). A list does not change in a minute; a failed fetch is not kept.
 */
const institutionCache = new Map<string, { at: number; list: Promise<{ data: RampInstitution[] }> }>();
const INSTITUTION_CACHE_MS = 60_000;
function institutionsOf(provider: RampProvider, currency: RampCurrency, country?: string) {
  const key = `${provider.name}|${currency.toUpperCase()}|${(country ?? "").toUpperCase()}`;
  const hit = institutionCache.get(key);
  if (hit && Date.now() - hit.at < INSTITUTION_CACHE_MS) return hit.list;
  const list = provider.getInstitutions(currency, country);
  institutionCache.set(key, { at: Date.now(), list });
  // Only this request's entry: a newer one may have replaced it while this was failing.
  list.catch(() => {
    if (institutionCache.get(key)?.list === list) institutionCache.delete(key);
  });
  return list;
}

function byName(name: RampProviderName): RampProvider {
  return allProviders().find((p) => p.name === name) ?? providers().fallback;
}

/**
 * Which provider a withdrawal tries first: Brails, then Bitnob, then the rest (Paycrest).
 *
 * Separate from REGISTRY on purpose. REGISTRY[0] is also the primary for catalogue calls
 * (currencies, banks, account checks), and Bitnob's catalogue is the broad one — putting Brails
 * there would shrink the currency list to Brails' corridors and drop Bitnob as a fallback.
 */
export function offRampRank(name: string): number {
  if (name === "brails") return 0;
  if (name === "bitnob") return 1;
  return 2;
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
 * primary throws, retry on the fallback.
 */
// "Primary does not do this, so the fallback does" is routing, not news: it holds for every
// call of that kind. Said once per capability per server start, not on every request.
const announcedFallback = new Set<string>();

async function withFallback<T>(
  capability: keyof RampCapabilities,
  op: (p: RampProvider) => Promise<T>,
): Promise<T> {
  const { primary, fallback } = providers();

  if (primary.capabilities[capability]) {
    try {
      return await op(primary);
    } catch (err) {
      if (err instanceof RampRefusedError) throw err;
      if (err instanceof RampUnsupportedError) {
        if (!announcedFallback.has(capability)) {
          announcedFallback.add(capability);
          console.log(`[Ramp] ${capability} is served by ${fallback.name} (${primary.name} does not support it)`);
        }
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

/** The words a provider adds to a network's name for the country it is in. */
const COUNTRY_WORDS: Record<string, string> = {
  NG: "nigerian", GH: "ghana", UG: "uganda", KE: "kenya", CM: "cameroon", TZ: "tanzania", ZM: "zambia", SN: "senegal",
};

/**
 * A bank's name with what differs between providers removed: the licence type ("FSDH Merchant
 * Bank", "MoMo Payment Service Bank") and, when the payout country is known, that country's own
 * name ("MTN Mobile Money Cameroon" for Cameroon). Only that country's: a network labelled with
 * another country is a different network, and must not match.
 */
function canonicalBankName(name: string, country?: string): string {
  const countryWord = country ? COUNTRY_WORDS[country.toUpperCase()] : undefined;
  const words = ["merchant", "payment", "service", "psb", ...(countryWord ? [countryWord] : [])];
  return normalizeBankName((name || "").replace(new RegExp(`\\b(${words.join("|")})\\b`, "gi"), " "));
}

/** Codes compared without Brails' country prefix: `NG:090273` and `090273` are one NIP code. */
function bareCode(code?: string): string {
  return (code ?? "").trim().toUpperCase().replace(/^[A-Z]{2}:/, "");
}

/**
 * Whether an institution code pays a bank account or a mobile money wallet — the providers
 * price the two differently in some corridors (Ghana). Brails codes carry their rail
 * ("GH:MTN"); the others are told apart by the mobile money operator codes.
 */
export function payoutRailOf(institutionCode: string): PayoutRail {
  const brails = parseBrailsInstitution(institutionCode);
  if (brails) return brails.rail;
  return isMobileMoneyCode(institutionCode) ? "mobile_money" : "bank";
}

/**
 * The bank the user picked, as THIS provider addresses it — or null when it cannot be told
 * exactly which one that is.
 *
 * Each provider codes the same bank differently (Bitnob "000013", Paycrest "GTBINGLA", Brails
 * "NG:000013"), and the list the user picked from may belong to any of them. Two ways to match,
 * both exact:
 *   1. The picked code is in this list (country prefix aside) and the names agree.
 *   2. Exactly one entry here has the same canonical name.
 * Nothing partial. A substring match is how "MoMo PSB" became OPay, "U & C Microfinance" became
 * Auchi and "CIT Microfinance" became Citibank — a payout or a name check against the wrong
 * institution. No match means this provider is skipped for that bank, which is the safe outcome.
 */
export function pickBank(
  institutions: RampInstitution[],
  bank: { code?: string; name?: string },
  /** The payout country, when known — see canonicalBankName. */
  country?: string,
): { code: string; name: string } | null {
  const code = bareCode(bank.code);
  const name = bank.name ? canonicalBankName(bank.name, country) : "";

  if (code) {
    const hit = institutions.find(
      (b) => bareCode(b.code) === code || bareCode(b.institutionCode) === code,
    );
    if (hit) {
      // Without a name the code is only trusted at the provider it came from (an exact match).
      if (!name) {
        const exact = bank.code!.trim().toUpperCase();
        return hit.code.trim().toUpperCase() === exact || hit.institutionCode?.trim().toUpperCase() === exact
          ? { code: hit.code, name: hit.name }
          : null;
      }
      // Same code, and one name is the other plus a qualifier ("AIRTEL" / "AIRTEL MONEY").
      const here = canonicalBankName(hit.name, country);
      if (here && (here === name || here.startsWith(name) || name.startsWith(here))) {
        return { code: hit.code, name: hit.name };
      }
    }
  }

  if (!name) return null;
  const byName = institutions.filter((b) => canonicalBankName(b.name, country) === name);
  if (byName.length !== 1) return null;
  return { code: byName[0].code, name: byName[0].name };
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

    // Brails first, then Bitnob, then everything else in its existing order.
    //
    // Written as a rank rather than `a.name === "bitnob" ? -1 : 1`, which ignored `b` entirely
    // and never returned 0 — so for any two unranked providers it claimed the first was
    // greater, which is not a consistent ordering and is left to the engine to interpret.
    const rank = offRampRank;
    // RAMP_OFFRAMP_ONLY pins every withdrawal to one provider, with no fallback — for testing a
    // provider in isolation. Never set in production: a corridor it cannot serve simply fails.
    const only = process.env.RAMP_OFFRAMP_ONLY?.trim().toLowerCase();
    const sorted = [...allProviders()]
      .filter((p) => !only || p.name === only)
      .sort((a, b) => rank(a.name) - rank(b.name));

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

  institutionsFor(provider: RampProviderName, currency: RampCurrency, country?: string) {
    return institutionsOf(byName(provider), currency, country);
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
   * The reverse of `resolveBank`: a provider's bank_code back to the bank's display name.
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
    // Brails codes name their country (`SN:WAVE`); its lists are per country.
    const country = /^[A-Z]{2}:/.test(wanted) ? wanted.slice(0, 2) : undefined;
    try {
      const { data } = await byName(provider).getInstitutions(currency, country);
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


  /** `pickBank` against this provider's own list. Used by verification and payout alike. */
  async resolveBank(
    provider: RampProviderName,
    bank: { code?: string; name?: string },
    currency: RampCurrency,
    /** The payout country: lists are per country, and XOF/XAF span several. */
    country?: string,
  ): Promise<{ code: string; name: string } | null> {
    const { data } = await institutionsOf(byName(provider), currency, country);
    return pickBank(data, bank, country);
  },

  createOffRampOrder(params: CreateOffRampParams): Promise<RampOrderResponse> {
    return withFallback("offRamp", (p) => p.createOffRampOrder(params));
  },

  /** Status lookups MUST go to the provider that created the order. */
  getOrder(orderId: string, provider: RampProviderName): Promise<RampOrderResponse> {
    return byName(provider).getOrder(orderId);
  },

  getRates(amount: number, fiat: RampCurrency, network?: string): Promise<RampRateResponse> {
    return withFallback("rates", (p) => p.getRates(amount, fiat, network));
  },

  /**
   * Which chain can actually settle this deposit.
   *
   * Deposits used to be pinned to Base, with the chain offered as a picker nobody could answer:
   * the settlement network is a detail of how the provider fills the order, and the only wrong
   * answer is one nobody is quoting. Liquidity moves per chain AND per amount — NGN answers on
   * one and goes quiet on another — so the question is asked rather than assumed.
   *
   * First chain that quotes a buy rate for this size wins; `DEPOSIT_NETWORKS` is in preference
   * order. Falls back to the first entry when none answer, so the order is still attempted and
   * fails with the provider's own reason rather than ours.
   */
  async pickDepositNetwork(amount: number, currency: RampCurrency): Promise<string> {
    for (const network of DEPOSIT_NETWORKS) {
      try {
        const rates = await withFallback("onRamp", (p) => p.getRates(amount, currency, network));
        if (rates.data.buy != null) return network;
      } catch (err) {
        console.warn(`[Ramp] ${network} rate lookup failed for ${currency}:`, err);
      }
    }
    console.warn(`[Ramp] no network quoted ${currency} at ${amount} — trying ${DEPOSIT_NETWORKS[0]}`);
    return DEPOSIT_NETWORKS[0];
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

  async getInstitutions(
    currency: RampCurrency,
    country?: string,
  ): Promise<{ data: RampInstitution[] }> {
    // One row per bank. Providers spell the same bank differently ("GTBank Plc", "Guaranty Trust
    // Bank"), so a later provider's entry is dropped when it names a bank already listed — by
    // the same matching `pickBank` uses, which then maps the pick to whichever provider pays.
    // Only ACROSS providers: two entries in one provider's own list are kept, since that
    // provider distinguishes them.
    const combined: RampInstitution[] = [];
    const listed = new Set<string>();

    // Only providers that could take this withdrawal: one blocked for the currency, or excluded
    // by RAMP_OFFRAMP_ONLY, would list institutions no order can reach. Fetched in parallel and
    // merged in priority order.
    const only = process.env.RAMP_OFFRAMP_ONLY?.trim().toLowerCase();
    const blocked = blockedProviders(currency);
    const eligible = allProviders().filter(
      (p) => p.capabilities.institutions && !blocked.has(p.name) && (!only || p.name === only),
    );
    const lists = await Promise.all(
      eligible.map((p) =>
        institutionsOf(p, currency, country).catch((err) => {
          console.warn(
            `[Ramp] ${p.name} failed to getInstitutions for ${currency}:`,
            err instanceof Error ? err.message : err,
          );
          return { data: [] as RampInstitution[] };
        }),
      ),
    );

    for (const res of lists) {
      const fromThis = new Set<string>();
      const spelled = new Set<string>();
      for (const inst of res.data ?? []) {
        const key = canonicalBankName(inst.name || "", country);
        const exact = (inst.name || "").trim().toLowerCase();
        if (!key || listed.has(key) || spelled.has(exact)) continue;
        spelled.add(exact);
        fromThis.add(key);
        combined.push(inst);
      }
      fromThis.forEach((k) => listed.add(k));
    }
    return { data: combined };
  },

  getCurrencies(): Promise<{ data: RampCurrencyDetail[] }> {
    return withFallback("currencies", (p) => p.getCurrencies());
  },

  /**
   * Payout destinations as COUNTRIES, which is how people pick them.
   *
   * `getCurrencies` above is deduped by currency, so XOF is one row covering eight countries —
   * a list no one can choose Senegal from, and a payout that quietly resolved to whichever
   * country the provider listed first.
   *
   * Falls back to deriving one destination per currency when no provider can answer at country
   * level, so the picker degrades to the old behaviour rather than emptying.
   */
  async getPayoutCountries(): Promise<{ data: RampCountry[] }> {
    // Every provider is asked, and the results are merged.
    //
    // Not first-wins: Bitnob and Paycrest cover overlapping but different sets, and taking only
    // the first to answer hid whole corridors the other could serve. A country offered by
    // either is a country we can pay.
    const merged = new Map<string, RampCountry>();

    for (const provider of allProviders()) {
      if (!provider.getPayoutCountries) continue;
      try {
        const { data } = await provider.getPayoutCountries();
        for (const country of data) {
          const key = country.code?.toUpperCase();
          if (!key) continue;
          const existing = merged.get(key);
          if (!existing) {
            merged.set(key, { ...country, code: key });
            continue;
          }
          // Seen already: keep it, and remember every rail either provider offers.
          merged.set(key, {
            ...existing,
            channels: Array.from(new Set([...existing.channels, ...country.channels])),
          });
        }
      } catch (err) {
        console.error(`[Ramp] ${provider.name} country list failed:`, err);
      }
    }

    if (merged.size > 0) {
      return {
        data: Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)),
      };
    }

    // Nothing answered. One row per currency is all a currency-level catalogue can say, and the
    // picker shows that rather than emptying — but a shared currency cannot be split by country.
    console.warn(
      "[Ramp] no provider returned payout countries — falling back to the currency list.",
    );
    const { data } = await this.getCurrencies();
    return {
      data: data.map((c) => ({
        code: c.country || c.code,
        name: c.name,
        currency: c.code,
        channels: c.channels ?? [],
      })),
    };
  },

  /**
   * Currencies a user can actually DEPOSIT from.
   *
   * Routed by the `onRamp` capability rather than `currencies`, which is the whole point: the
   * general list comes from the primary provider (Bitnob) and is much longer, but Bitnob has no
   * fiat on-ramp — `createOnRampOrder` throws RampUnsupportedError. Offering its full catalogue
   * let people pick a corridor that could only fail at order time, after they had entered an
   * amount. Asking by capability returns the list from the provider that would really serve the
   * order.
   */
  getOnRampCurrencies(): Promise<{ data: RampCurrencyDetail[] }> {
    return withFallback("onRamp", (p) => p.getCurrencies());
  },

  /**
   * Can a user actually BUY USDC with this currency right now?
   *
   * Being a supported corridor is not the same as being a liquid one. Paycrest quotes each
   * direction independently and simply omits `buy` when nobody is offering that side, so a
   * corridor can accept withdrawals all day and take no deposits at all. Verified 2026-09-07:
   * NGN and KES quoted `buy`; TZS and UGX returned `sell` only.
   *
   * This changes with liquidity, so it is a live check, not a static list. On a network error we
   * return true: blocking a deposit because a rate lookup blipped is worse than letting the
   * order attempt and fail with a real message.
   */
  /**
   * Can a deposit of this size actually be filled right now?
   *
   * The size is the whole question, not a detail. Paycrest quotes per amount, and a corridor
   * that is perfectly alive will return no `buy` rate for a size nobody is quoting: NGN answers
   * at 20 USDC and goes quiet at 30, while remaining open for business throughout. Probing a
   * fixed 100 and calling the result "NGN deposits are paused" turned one unquoted size into a
   * closed currency, and sent people away from a corridor that would have taken their money.
   *
   * The default is deliberately small. With no amount to check, the only answerable question is
   * "is this corridor alive at all", and the smallest probe is the one most likely to be quoted.
   */
  async isOnRampAvailable(
    currency: RampCurrency,
    amountUsdc = 1,
  ): Promise<boolean> {
    try {
      const amount = Math.max(1, Math.ceil(amountUsdc));
      const rates = await withFallback("onRamp", (p) => p.getRates(amount, currency));
      return rates.data.buy != null;
    } catch (err) {
      // Fail open: a provider we cannot reach is not the same as a corridor that is closed, and
      // blocking a deposit on our own outage is the worse mistake. One line, no stack: the
      // provider client has already logged the failing request itself.
      const status = (err as { status?: number })?.status;
      console.warn(
        `[Ramp] ${currency} deposit check (${amountUsdc} USDC) could not get a rate` +
          `${status ? ` (HTTP ${status})` : ""}; allowing the deposit to proceed`,
      );
      return true;
    }
  },

  /** Chains the active off-ramp provider can settle on (drives withdrawal routing). */
  getSettlementNetworks(): Promise<string[]> {
    return withFallback("offRamp", (p) => p.getSettlementNetworks());
  },
};

export type { RampProvider } from "./provider";
export * from "./types";
