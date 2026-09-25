/**
 * Platform fee configuration for the fiat rails.
 *
 * --- Withdrawals only -------------------------------------------------------
 *
 * Deposits are free. They used to carry a fee that Paycrest skimmed on their side (their
 * partner-fee mechanism), and that has been removed entirely: the on-ramp now sends the user's
 * full amount through. Money coming IN is not charged for. Everything in this file therefore
 * prices withdrawals, and the only other fee-bearing paths in the product — bridges and sends
 * to an external wallet — live in lib/fees/platform-fees.ts.
 *
 * --- One rate, one treasury -------------------------------------------------
 *
 * Both providers now collect the same way: on-chain, to OUR address, in the same transfer as
 * the payout. Paycrest's partner fee is set to zero on their dashboard, so nothing is skimmed
 * upstream any more. That collapses what used to be two provider-specific configurations into
 * one, which is why the rate is no longer named after a provider:
 *
 *   WITHDRAWAL_FEE_PERCENT              the standard rate
 *   WITHDRAWAL_FEE_PERCENT_<CURRENCY>   per-corridor override, when one corridor costs more
 *   FEE_TREASURY_<CHAIN>                where it lands, per settlement network
 *
 * A per-corridor override changes what the USER pays. It deliberately does NOT change what a
 * referrer earns — that is a fixed share of volume, resolved in lib/referrals, precisely so a
 * corridor repricing cannot silently reprice the referral programme along with it.
 *
 * Every rate comes from the environment, with no compiled-in default, so the charged fee and
 * the displayed fee cannot diverge.
 */
import type { RampProviderName } from "./types";

export type FeeCollection = "provider" | "onchain";

export interface ProviderFee {
  /** Platform fee as a percentage of the base USDC amount (e.g. 0.5 = 0.5%). */
  percent: number;
  /**
   * Who collects it. `provider` = the provider skims it (send base×(1+fee) to one address).
   * `onchain` = we collect it ourselves by sending the fee to `treasury[settlementChain]`.
   */
  collection: FeeCollection;
  /** Per-chain fee-collection addresses. Required (per chain) when `collection === 'onchain'`. */
  treasury?: Record<string, string | undefined>;
}

/**
 * Where fees land, per settlement network. A self-custodial wallet we hold the keys to.
 *
 * `FEE_TREASURY_<CHAIN>`, and nothing else. The address serves bridges and external sends as
 * well as both ramp providers (see lib/fees/platform-fees.ts), so a provider's name in the
 * variable was always a misnomer.
 *
 * Fill the ones you use. An unset chain fails closed at withdrawal time rather than settling
 * without collecting, so we never quietly give the service away on a chain nobody configured.
 */
export function treasuryFor(chain: string): string | undefined {
  return process.env[`FEE_TREASURY_${chain.toUpperCase()}`] || undefined;
}

const FEE_TREASURY_CHAINS = [
  "base",
  "arbitrum",
  "avalanche",
  "ethereum",
  "optimism",
  "polygon",
  "arc",
  "solana",
  "stellar",
] as const;

/** Resolved per call rather than at module load, so a config change needs no redeploy. */
function feeTreasuryMap(): Record<string, string | undefined> {
  return Object.fromEntries(FEE_TREASURY_CHAINS.map((chain) => [chain, treasuryFor(chain)]));
}

/**
 * How each provider's fee reaches us.
 *
 * Identical now, and that is the point: Paycrest's partner fee is zero on their dashboard, so
 * neither provider skims anything upstream. We collect both on-chain, to our own treasury, in
 * the same transfer as the payout — which means the fee either moves with the payout or
 * neither happens.
 *
 * The map is kept, rather than collapsed into a constant, because it is the thing that would
 * have to change if a provider ever started skimming again, and a per-provider shape makes
 * that a one-line edit instead of a refactor.
 */
const FEE_COLLECTION: Record<RampProviderName, Pick<ProviderFee, "collection">> = {
  paycrest: { collection: "onchain" },
  bitnob: { collection: "onchain" },
};

/**
 * The flat per-corridor fee in USDC a payout provider deducts, added on top of the base amount
 * so that deduction is covered by the user's own withdrawal rather than our float.
 *
 * Configured rather than read from the API. Bitnob reports `fees: "0"` on both the quote and
 * the initialize response for every corridor, yet still deducts on some — RWF mobile money took
 * a flat 0.30 on both a 1.01 and a 10.00 payout. A provider that lies about its own fee cannot
 * be the source of truth for it.
 *
 * Two keys, most specific first:
 *
 *   CORRIDOR_FEE_<PROVIDER>_<CURRENCY>   this provider, this corridor
 *   CORRIDOR_FEE_<CURRENCY>              any provider serving this corridor
 *
 * Both rather than one, because the deduction belongs to the PROVIDER, not the currency. The
 * same corridor can cost differently depending on who serves it — a single per-currency rate
 * would quietly overcharge on a provider that settles the quoted amount in full. The plain
 * per-currency form stays because it is the common case and is what most deployments will want.
 */
export function getCorridorFee(provider: RampProviderName, currency: string): number {
  const cur = (currency || "").toUpperCase();
  const prov = (provider || "").toUpperCase();

  const candidates = [`CORRIDOR_FEE_${prov}_${cur}`, `CORRIDOR_FEE_${cur}`];

  for (const envVar of candidates) {
    const raw = process.env[envVar];
    // An empty string is "configured as nothing", not "not configured" — it stops the search,
    // so a deployment can override a broader key back down to zero for one corridor.
    if (raw == null) continue;
    if (raw === "") return 0;

    const fee = Number(raw);
    if (!Number.isFinite(fee) || fee < 0) {
      // Loud but not fatal — a typo in one corridor must not take withdrawals down.
      console.error(`[Fees] ${envVar} is not a valid amount (got ${JSON.stringify(raw)}) — using 0.`);
      return 0;
    }
    return fee;
  }

  return 0;
}

/**
 * The withdrawal fee rate for a corridor.
 *
 * `WITHDRAWAL_FEE_PERCENT_<CURRENCY>` wins where it is set, otherwise the global
 * `WITHDRAWAL_FEE_PERCENT`. The per-corridor form exists because some corridors genuinely cost
 * more to serve, and pricing them all at the cheapest one means subsidising the expensive ones
 * out of margin.
 *
 * **Every rate comes from env — there is no hardcoded default.** A compiled-in fallback is
 * what let the app charge two different fees at once: the server honoured the env override
 * while the UI used the constant baked into the bundle. With one source there is nothing to
 * drift from.
 *
 * Read lazily, per call, rather than once at module load, so a config change takes effect on
 * the next request instead of the next deploy — and so importing this module from a client
 * bundle (where process.env is empty) can't capture a wrong value at build time.
 *
 * Throws when nothing is configured. A payout whose fee we cannot determine must fail loudly,
 * exactly as a missing treasury does; it is never silently treated as free.
 */
export function getWithdrawalFeePercent(currency?: string): number {
  const perCorridor = currency
    ? process.env[`WITHDRAWAL_FEE_PERCENT_${currency.toUpperCase()}`]
    : undefined;

  const raw = perCorridor ?? process.env.WITHDRAWAL_FEE_PERCENT;

  const percent = Number(raw);

  if (raw == null || raw === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(
      `No withdrawal fee rate is configured (got ${JSON.stringify(raw)}). ` +
        "Set WITHDRAWAL_FEE_PERCENT, e.g. WITHDRAWAL_FEE_PERCENT=0.5" +
        (currency ? `, or WITHDRAWAL_FEE_PERCENT_${currency.toUpperCase()} for this corridor.` : "."),
    );
  }

  return percent;
}

/**
 * The fee configuration for a provider on a corridor.
 *
 * `currency` is optional only so the existing call sites that have no corridor in hand keep
 * working on the standard rate. Anything pricing a real withdrawal should pass it — without
 * it, a corridor with an override is quoted at the global rate and the user is charged the
 * other one.
 */
export function getProviderFee(
  provider: RampProviderName,
  currency?: string,
): ProviderFee {
  return {
    percent: getWithdrawalFeePercent(currency),
    ...FEE_COLLECTION[provider],
    treasury: feeTreasuryMap(),
  };
}

// ── Fee arithmetic ───────────────────────────────────────────────────────────
// Two amounts exist in every ramp order and the difference matters:
//
//   base  — what funds the payout. The provider is quoted on this.
//   total — what actually leaves the user's wallet: base + fee.
//
// Convert between them ONLY through these helpers. They take the percentage rather than a
// provider so the client can use them too (it reads the rate from `getProviderFeePercent`,
// since a provider's percent can be overridden per-environment).
//
// Every call site used to inline its own `* (1 + feePercent / 100)`, and one of them had the
// rate hardcoded as `1.003` — silently correct at 0.3% and silently wrong the moment the fee
// moved. Funnelling the arithmetic through here is what stops that recurring: the rate comes
// from env, and there is no second copy of the maths to forget.

/** base → total multiplier for `percent` (e.g. 0.5 → 1.005). */
function feeMultiplier(percent: number): number {
  return 1 + percent / 100;
}

/** Total deducted from the wallet to fund `base` — i.e. base + fee. */
export function totalFromBase(base: number, percent: number): number {
  return base * feeMultiplier(percent);
}

/** Base a fixed `total` funds once the fee is taken OUT of it (the inverse of totalFromBase). */
export function baseFromTotal(total: number, percent: number): number {
  return total / feeMultiplier(percent);
}

/** The fee portion of a base amount. */
export function feeFromBase(base: number, percent: number): number {
  return totalFromBase(base, percent) - base;
}

export interface AppliedFee {
  /** USDC that funds the payout (what the user is quoted for). */
  base: number;
  /** Platform fee in USDC. */
  fee: number;
  /** Total USDC deducted from the user (base + fee). */
  total: number;
}

/** Split a base amount into base + platform fee + total for `provider` on `currency`. */
export function applyFee(
  base: number,
  provider: RampProviderName,
  currency?: string,
): AppliedFee {
  const percent = getProviderFee(provider, currency).percent;
  return { base, fee: feeFromBase(base, percent), total: totalFromBase(base, percent) };
}

/**
 * Resolve the on-chain treasury address a provider's fee should be sent to for `chain`.
 * Throws (fail-closed) when the provider self-collects but no address is configured for the
 * settlement chain — so we never silently skip the fee.
 */
export function resolveFeeTreasury(provider: RampProviderName, chain: string): string {
  const cfg = getProviderFee(provider);
  if (cfg.collection !== "onchain") {
    throw new Error(`${provider} does not collect fees on-chain`);
  }
  const addr = cfg.treasury?.[chain.toLowerCase()];
  if (!addr) {
    throw new Error(
      `No fee treasury address configured for '${chain}'. Set ` +
        `FEE_TREASURY_${chain.toUpperCase()}.`,
    );
  }
  return addr;
}

/**
 * Everything that leaves the wallet to fund `base`: base + platform fee + the provider's flat
 * corridor fee. The figure the UI shows as "Total Deducted" and the one a balance is checked
 * against — `maxBaseFromBalance` is its exact inverse.
 *
 * It lives here for the same reason the rest of this file does: the expression was inlined at
 * four call sites, and a formula with four copies is a formula that drifts.
 */
export function totalDeducted(base: number, percent: number, corridorFee = 0): number {
  return totalFromBase(base, percent) + corridorFee;
}

/**
 * The largest base amount whose FULL deduction fits inside `balance`.
 *
 * The exact inverse of `totalFromBase(base, percent) + corridorFee`, so a "withdraw everything"
 * button means everything: the fees come out of the balance instead of being stacked on top of
 * it. Inverting only the platform fee leaves the max short by the corridor fee, and the excess
 * does not surface until the pre-transfer check — after the quote exists.
 *
 * Clamped at 0: a balance smaller than the corridor fee cannot fund any withdrawal.
 */
export function maxBaseFromBalance(
  balance: number,
  percent: number,
  corridorFee = 0,
): number {
  if (!(balance > 0)) return 0;
  return Math.max(0, baseFromTotal(balance - corridorFee, percent));
}

/**
 * Headroom applied when a user types a FIAT target and we estimate the USDC behind it.
 *
 * The estimate uses the indicative display rate, which prices a spread better than any payout
 * settles at, so the solved amount is almost always a little higher. Routing on the bare
 * estimate could pick a chain that the real figure then does not fit into.
 *
 * It is exported because anything computing a MAX has to leave the same headroom — otherwise
 * the padded figure exceeds the very balance the max was derived from.
 */
export const FIAT_ROUTING_PAD = 1.01;
