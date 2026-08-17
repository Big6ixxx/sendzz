/**
 * Platform (partner) fee configuration — provider-agnostic.
 *
 * Some providers collect the platform fee for us (Paycrest: a partner fee configured on their
 * dashboard; we just send `base × (1 + fee)` and they skim it). Others have no partner-fee
 * mechanism (Bitnob), so we collect it ourselves ON-CHAIN by routing the fee portion to our
 * own per-chain treasury address in the same transfer as the payout.
 *
 * Every rate comes from the environment — PAYCREST_FEE_PERCENT and BITNOB_FEE_PERCENT. There
 * is no compiled-in default anywhere, so the charged fee and the displayed fee cannot diverge.
 *
 * To adjust fees:
 *   • change a percentage → set <PROVIDER>_FEE_PERCENT (no deploy needed for the value itself)
 *   • move a fee on/off the provider → flip `collection` in FEE_COLLECTION
 *   • add a self-collecting provider → add its <PROVIDER>_FEE_TREASURY_<CHAIN> vars
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
 * Bitnob-hosted deposit addresses, one per chain — sending the fee here auto-credits our
 * Bitnob balance. Fill the ones you use; unset chains fail-closed at withdrawal time so we
 * never accidentally give the service away for free on an unconfigured chain.
 */
const BITNOB_FEE_TREASURY: Record<string, string | undefined> = {
  base: process.env.BITNOB_FEE_TREASURY_BASE,
  arbitrum: process.env.BITNOB_FEE_TREASURY_ARBITRUM,
  avalanche: process.env.BITNOB_FEE_TREASURY_AVALANCHE,
  ethereum: process.env.BITNOB_FEE_TREASURY_ETHEREUM,
  optimism: process.env.BITNOB_FEE_TREASURY_OPTIMISM,
  polygon: process.env.BITNOB_FEE_TREASURY_POLYGON,
  solana: process.env.BITNOB_FEE_TREASURY_SOLANA,
  stellar: process.env.BITNOB_FEE_TREASURY_STELLAR, // coming soon
};

/** Env var holding each provider's fee percentage. There is no compiled-in rate. */
const FEE_ENV_VAR: Record<RampProviderName, string> = {
  paycrest: "PAYCREST_FEE_PERCENT",
  bitnob: "BITNOB_FEE_PERCENT",
};

/**
 * How each provider's fee reaches us. The percentage is NOT here — see getProviderFee.
 *
 *  • paycrest — skims its own partner fee, configured on their dashboard. PAYCREST_FEE_PERCENT
 *    MUST match that dashboard value, or the "send extra" reverse-calculation nets the wrong
 *    payout. Changing the env var alone is not enough for Paycrest.
 *  • bitnob — has no partner-fee mechanism, so we collect on-chain to our own treasury.
 */
const FEE_COLLECTION: Record<RampProviderName, Pick<ProviderFee, "collection" | "treasury">> = {
  paycrest: { collection: "provider" },
  bitnob: { collection: "onchain", treasury: BITNOB_FEE_TREASURY },
};

/**
 * The provider's flat per-corridor fee in USDC, added on top of the base amount so the
 * provider's deduction is covered by the user's own deposit rather than our float.
 *
 * Set `BITNOB_CORRIDOR_FEE_<CURRENCY>` per currency; unset means none. Configured rather than
 * read from the API because Bitnob reports `fees: "0"` on both the quote and the initialize
 * response for every corridor, yet still deducts on some (RWF mobile money took a flat 0.30 on
 * both a 1.01 and a 10.00 payout). Bitnob only — Paycrest settles the quoted amount.
 */
export function getCorridorFee(provider: RampProviderName, currency: string): number {
  if (provider !== "bitnob") return 0;

  const envVar = `BITNOB_CORRIDOR_FEE_${(currency || "").toUpperCase()}`;
  const raw = process.env[envVar];
  if (raw == null || raw === "") return 0;

  const fee = Number(raw);
  if (!Number.isFinite(fee) || fee < 0) {
    // Loud but not fatal — a typo in one corridor must not take withdrawals down.
    console.error(`[Fees] ${envVar} is not a valid amount (got ${JSON.stringify(raw)}) — using 0.`);
    return 0;
  }
  return fee;
}

/**
 * The fee for a provider, read from its environment variable.
 *
 * **Every rate comes from env — there is no hardcoded default.** A compiled-in fallback is
 * what let the app charge two different fees at once: the server honoured the env override
 * while deposits and the whole UI used the constant baked into the bundle. With one source
 * there is nothing to drift from.
 *
 * Read lazily, per call, rather than once at module load, so a config change takes effect on
 * the next request instead of the next deploy — and so importing this module from a client
 * bundle (where process.env is empty) can't capture a wrong value at build time.
 *
 * Throws when the variable is missing or not a sane percentage. That is deliberate: a payout
 * whose fee we can't determine must fail loudly, exactly as a missing fee treasury does. It is
 * never silently treated as free.
 */
export function getProviderFee(provider: RampProviderName): ProviderFee {
  const envVar = FEE_ENV_VAR[provider];
  const raw = process.env[envVar];
  const percent = Number(raw);

  if (raw == null || raw === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(
      `${envVar} is not configured (got ${JSON.stringify(raw)}). ` +
        `Set it to the ${provider} fee percentage, e.g. ${envVar}=0.5`,
    );
  }

  return { percent, ...FEE_COLLECTION[provider] };
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

/** Split a base amount into base + platform fee + total for `provider`. */
export function applyFee(base: number, provider: RampProviderName): AppliedFee {
  const percent = getProviderFee(provider).percent;
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
      `No ${provider} fee treasury address configured for '${chain}'. Set ` +
        `${provider.toUpperCase()}_FEE_TREASURY_${chain.toUpperCase()}.`,
    );
  }
  return addr;
}
