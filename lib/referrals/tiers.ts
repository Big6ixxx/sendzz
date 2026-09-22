/**
 * Scout tiers, and the translation that makes them stable.
 *
 * --- Two ways of saying the same thing --------------------------------------
 *
 * A referrer's reward can be quoted as a share of OUR FEE ("you get half of what Sendzz
 * charges") or as a share of VOLUME ("you get 0.25% of what your people withdraw"). On a 0.5%
 * corridor these are identical — half of 0.5% is 0.25% — and they diverge everywhere else.
 *
 * The programme is quoted in the first language and PAID in the second. Gold is "50% of our
 * fee" in the marketing, and 0.25% of volume in the arithmetic. That is deliberate: corridor
 * pricing is a commercial decision about what the USER pays, and repricing a corridor must not
 * silently reprice what we owe our affiliates. A referrer on a 1% corridor still earns 0.25%
 * of volume — a quarter of that fee rather than half — and their income does not move because
 * we changed a price.
 *
 * --- The reference rate -----------------------------------------------------
 *
 * `REFERRAL_REFERENCE_FEE_PERCENT` (0.5) is the bridge between the two statements. It is a
 * variable rather than a constant because one day the standard corridor may move, and at that
 * moment somebody has to decide whether Gold still means 0.25% of volume or becomes 0.3%.
 * Keeping the reference explicit makes that a decision; hardcoding the output makes it a thing
 * nobody notices.
 */

/** The tiers, cheapest first. Order matters — `tierForVolume` walks it downwards. */
export const TIERS = ['bronze', 'silver', 'gold'] as const;
export type ReferralTier = (typeof TIERS)[number];

interface TierDefinition {
  /** Monthly network withdrawal volume, in USDC, at which this tier begins. */
  minMonthlyVolumeUsdc: number;
  /** What the programme is QUOTED as: share of our fee on a reference corridor. */
  quotedFeeSharePercent: number;
}

/**
 * Defaults from the programme design. Overridable per environment, because these are
 * commercial numbers and changing one should not need a deploy.
 */
const TIER_DEFAULTS: Record<ReferralTier, TierDefinition> = {
  bronze: { minMonthlyVolumeUsdc: 0, quotedFeeSharePercent: 20 },
  silver: { minMonthlyVolumeUsdc: 5_000, quotedFeeSharePercent: 35 },
  gold: { minMonthlyVolumeUsdc: 25_000, quotedFeeSharePercent: 50 },
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    // Loud, but not fatal. A typo in one commercial number must not stop withdrawals.
    console.error(`[Referrals] ${name} is not a valid number (got ${JSON.stringify(raw)}).`);
    return fallback;
  }
  return value;
}

/** The corridor rate the quoted tier percentages are expressed against. */
export function referenceFeePercent(): number {
  return envNumber('REFERRAL_REFERENCE_FEE_PERCENT', 0.5);
}

export function tierDefinition(tier: ReferralTier): TierDefinition {
  const base = TIER_DEFAULTS[tier];
  const key = tier.toUpperCase();
  return {
    minMonthlyVolumeUsdc: envNumber(`REFERRAL_TIER_${key}_MIN_VOLUME`, base.minMonthlyVolumeUsdc),
    quotedFeeSharePercent: envNumber(`REFERRAL_TIER_${key}_FEE_SHARE`, base.quotedFeeSharePercent),
  };
}

/**
 * What a tier actually pays, as a percentage of withdrawal volume.
 *
 * This is the translation: 50% of a 0.5% corridor is 0.25% of volume. Everything downstream
 * multiplies volume by this number, and none of it looks at the corridor's own rate.
 */
export function tierVolumeRatePercent(tier: ReferralTier): number {
  return (tierDefinition(tier).quotedFeeSharePercent / 100) * referenceFeePercent();
}

/** The tier a given monthly network volume earns. */
export function tierForVolume(monthlyVolumeUsdc: number): ReferralTier {
  // Downwards, so the highest qualifying tier wins and an ambiguous overlap in the
  // configuration cannot silently demote somebody.
  for (let i = TIERS.length - 1; i >= 0; i -= 1) {
    const tier = TIERS[i];
    if (monthlyVolumeUsdc >= tierDefinition(tier).minMonthlyVolumeUsdc) return tier;
  }
  return 'bronze';
}

/**
 * The most we will pay out of one withdrawal, as a share of what it actually NETTED us.
 *
 * A flat volume rate takes no account of what we earned, which is fine until the margin on a
 * withdrawal is thin — a flat corridor cost eats a small withdrawal's fee, and 0.25% of volume
 * can then exceed everything we made on it. On a $50 withdrawal at 0.5% with a $0.20 corridor
 * cost we net $0.05, while the volume rate would pay $0.125: two and a half times our margin,
 * straight out of pocket.
 *
 * Set high on purpose. This is insurance, not pricing — at 90% it is invisible on healthy
 * corridors and Gold receives exactly the 0.25% it is promised. It engages only where the
 * alternative is a loss. Tightening it would quietly pay affiliates less than the rate they
 * were quoted, which is a worse failure than the one it would be guarding against.
 */
export function maxNetSharePercent(): number {
  return envNumber('REFERRAL_MAX_NET_SHARE_PERCENT', 90);
}

/**
 * The smallest withdrawal that earns a commission.
 *
 * Small withdrawals are where flat corridor costs dominate and margin is thinnest, and paying
 * a commission on a stream of tiny payouts is how a referral programme turns into a cost
 * centre. The cap above already prevents a loss; this prevents the noise.
 */
export function minimumWithdrawalUsdc(): number {
  return envNumber('REFERRAL_MIN_WITHDRAWAL_USDC', 50);
}

export interface CommissionInput {
  tier: ReferralTier;
  volumeUsdc: number;
  grossFeeUsdc: number;
  corridorCostUsdc: number;
}

export interface Commission {
  tier: ReferralTier;
  tierRatePercent: number;
  volumeUsdc: number;
  grossFeeUsdc: number;
  corridorCostUsdc: number;
  netFeeUsdc: number;
  /** What the rate produced, before the cap. */
  uncappedUsdc: number;
  /** Whether the cap reduced it. */
  capped: boolean;
  /** What is owed. */
  amountUsdc: number;
}

/**
 * Work out one commission, showing every step.
 *
 * Pure, and returns the whole derivation rather than a single number, because the caller
 * stores all of it — a payout has to be explainable to the affiliate months later, long after
 * the rates it was computed from have changed.
 */
export function computeCommission(input: CommissionInput): Commission {
  const { tier, volumeUsdc, grossFeeUsdc, corridorCostUsdc } = input;

  const tierRatePercent = tierVolumeRatePercent(tier);
  const netFeeUsdc = grossFeeUsdc - corridorCostUsdc;
  const uncappedUsdc = volumeUsdc * (tierRatePercent / 100);

  // A withdrawal that netted nothing pays nothing. Negative net is possible on a thin
  // corridor and must not produce a negative — or, worse, a sign-flipped — commission.
  const cap = Math.max(0, netFeeUsdc) * (maxNetSharePercent() / 100);
  const amountUsdc = Math.min(uncappedUsdc, cap);

  return {
    tier,
    tierRatePercent,
    volumeUsdc,
    grossFeeUsdc,
    corridorCostUsdc,
    netFeeUsdc,
    uncappedUsdc,
    capped: amountUsdc < uncappedUsdc,
    amountUsdc,
  };
}
