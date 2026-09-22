/**
 * How a fee-free allowance and a fee credit combine into one charge.
 *
 * Separated from benefits.ts because that module talks to the database and cannot be imported
 * into a browser bundle — and the withdrawal screen has to show the same number the server
 * will charge. Two implementations of this arithmetic would eventually disagree, and the
 * disagreement would surface as a user being quoted one fee and deducted another.
 *
 * Pure, with the balances passed in. The caller decides how it learned them.
 */

export interface BenefitBalances {
  /** USDC of withdrawal volume that carries no fee. */
  waiverVolumeUsdc: number;
  /** USDC of fee that is written off. */
  feeCreditUsdc: number;
}

export interface AppliedBenefits {
  /** What the user is actually charged. */
  feeUsdc: number;
  /** What they would have paid with no benefits. */
  standardFeeUsdc: number;
  /** Volume covered by the fee-free allowance. */
  waivedVolumeUsdc: number;
  /** Fee written off against credits. */
  creditAppliedUsdc: number;
}

/**
 * Apply the allowance, then the credit.
 *
 * Order matters, and it is waiver first. The waiver is denominated in VOLUME and the credit in
 * FEE, so spending the credit first would burn a cash-equivalent benefit against a fee the
 * waiver was about to remove for nothing. Waiver first leaves the user at least as well off in
 * every case, and better in most.
 */
export function applyBenefits(params: {
  volumeUsdc: number;
  feePercent: number;
  balances: BenefitBalances;
}): AppliedBenefits {
  const { volumeUsdc, feePercent, balances } = params;

  const round = (n: number) => Number(Math.max(0, n).toFixed(6));
  const standardFeeUsdc = volumeUsdc * (feePercent / 100);

  const waivedVolumeUsdc = Math.min(volumeUsdc, Math.max(0, balances.waiverVolumeUsdc));
  const chargeableVolume = Math.max(0, volumeUsdc - waivedVolumeUsdc);
  const feeAfterWaiver = chargeableVolume * (feePercent / 100);

  const creditAppliedUsdc = Math.min(feeAfterWaiver, Math.max(0, balances.feeCreditUsdc));

  return {
    feeUsdc: round(feeAfterWaiver - creditAppliedUsdc),
    standardFeeUsdc: round(standardFeeUsdc),
    waivedVolumeUsdc: round(waivedVolumeUsdc),
    creditAppliedUsdc: round(creditAppliedUsdc),
  };
}

/**
 * The largest amount a balance can fund, once benefits are taken into account.
 *
 * The exact inverse of "base + fee + corridor cost", which is what MAX has to be: fees come
 * out of the balance rather than being stacked on top of it, so a MAX that ignored the
 * allowance would offer a referee LESS than they can actually withdraw — understating it for
 * precisely the people the allowance was created for.
 *
 * Three cases, in order of how much of the fee survives:
 *
 *   1. The whole withdrawal fits inside the fee-free allowance. No fee at all, so the balance
 *      funds everything except the provider's flat cost.
 *   2. It runs past the allowance, but the credit still absorbs the fee on the excess.
 *      Also effectively free.
 *   3. A fee is genuinely charged, and the balance has to cover base + fee.
 *
 * With no benefits this reduces to `maxBaseFromBalance` in lib/ramp/fees.ts — same inverse,
 * same answer. The two are kept separate because that one has no business knowing about
 * referrals, and this one is useless without them.
 */
export function maxWithdrawableBase(params: {
  availableUsdc: number;
  feePercent: number;
  corridorFeeUsdc: number;
  balances: BenefitBalances;
}): number {
  const { availableUsdc, feePercent, corridorFeeUsdc, balances } = params;

  // The corridor cost is flat and comes off whatever happens. A balance smaller than it
  // cannot fund any withdrawal.
  const spendable = availableUsdc - corridorFeeUsdc;
  if (spendable <= 0) return 0;

  const rate = feePercent / 100;
  const waiver = Math.max(0, balances.waiverVolumeUsdc);
  const credit = Math.max(0, balances.feeCreditUsdc);

  /**
   * Rounded DOWN, never to nearest.
   *
   * `applyBenefits` rounds the fee it returns to six decimals, to nearest — so a fee can come
   * back up to 5e-7 larger than the exact value this inverse was solved against, and
   * base + fee + corridor then lands a hair OVER the balance. Tiny, and fatal in the one place
   * it matters: MAX would produce an amount that fails the pre-transfer check, after a quote
   * already exists, with "not enough balance" on a figure the app itself filled in.
   *
   * Losing a millionth of a dollar is the safe direction. Rounding to nearest is not.
   */
  const floorToMicro = (value: number) => Math.floor(value * 1e6) / 1e6;

  // 1. Entirely inside the allowance.
  if (spendable <= waiver) return floorToMicro(spendable);

  // 2. Past the allowance, but the credit covers the fee on the excess. At a zero rate there
  //    is no fee to cover and everything is free, which the Infinity expresses.
  const coveredByCredit = waiver + (rate > 0 ? credit / rate : Infinity);
  if (spendable <= coveredByCredit) return floorToMicro(spendable);

  // 3. A fee is charged. Solving  spendable = base + (base - waiver) * rate - credit.
  return floorToMicro((spendable + waiver * rate + credit) / (1 + rate));
}
