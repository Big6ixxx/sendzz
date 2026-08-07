/**
 * Platform (partner) fee configuration — provider-agnostic.
 *
 * Some providers collect the platform fee for us (Paycrest: a partner fee configured on their
 * dashboard; we just send `base × (1 + fee)` and they skim it). Others have no partner-fee
 * mechanism (Bitnob), so we collect it ourselves ON-CHAIN by routing the fee portion to our
 * own per-chain treasury address in the same transfer as the payout.
 *
 * To add/adjust fees:
 *   • change a percentage → set <PROVIDER>_FEE_PERCENT
 *   • move a fee on/off the provider → flip `collection`
 *   • add a self-collecting provider → add an entry with its own <PROVIDER>_FEE_TREASURY_<CHAIN> vars
 * Everything reads from PROVIDER_FEES; call sites never hardcode a percentage.
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

function num(v: string | undefined, fallback: number): number {
  const n = v != null && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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

/**
 * The platform fee, as a percentage — the one number to change when pricing moves.
 *
 * Every fee, on every provider, on both deposit and withdrawal, derives from this: the
 * per-provider entries below default to it, and `lib/paycrest/config.ts` re-exports it for the
 * on-ramp math and the UI. It lived in two places before and the copies could silently drift,
 * which would mean charging one number and displaying another.
 *
 * Raising this is NOT enough on its own for Paycrest: they skim their own partner fee, so the
 * matching value must also be set on the Paycrest dashboard or the "send extra" math nets the
 * wrong payout. Bitnob needs no dashboard change — we collect that one ourselves (see below).
 */
export const PLATFORM_FEE_PERCENT = 0.5;

export const PROVIDER_FEES: Record<RampProviderName, ProviderFee> = {
  // Paycrest collects the partner fee itself (configured on the Paycrest dashboard). This
  // percentage MUST match the dashboard value so the "send extra" math nets the right payout.
  paycrest: {
    percent: num(process.env.PAYCREST_FEE_PERCENT, PLATFORM_FEE_PERCENT),
    collection: "provider",
  },
  // Bitnob has no partner-fee mechanism, so we collect on-chain to our own treasury.
  bitnob: {
    percent: num(process.env.BITNOB_FEE_PERCENT, PLATFORM_FEE_PERCENT),
    collection: "onchain",
    treasury: BITNOB_FEE_TREASURY,
  },
};

export function getProviderFee(provider: RampProviderName): ProviderFee {
  return PROVIDER_FEES[provider];
}

/** Fee fraction (e.g. 0.005) for a provider. */
export function feeRate(provider: RampProviderName): number {
  return getProviderFee(provider).percent / 100;
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
// moved. Funnelling the arithmetic through here is what stops that from recurring: change
// PLATFORM_FEE_PERCENT and there is no second copy of the maths to forget.

/** base → total multiplier for `percent` (e.g. 0.5 → 1.005). */
export function feeMultiplier(percent: number): number {
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

/** The fee itself, given whichever amount you happen to hold. */
export function feeFromBase(base: number, percent: number): number {
  return totalFromBase(base, percent) - base;
}
export function feeFromTotal(total: number, percent: number): number {
  return total - baseFromTotal(total, percent);
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
