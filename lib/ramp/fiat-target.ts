/**
 * Hitting a fiat target exactly.
 *
 * When a user types "5000 NGN" they are naming what the recipient must receive — they are paying
 * an invoice, settling rent, sending school fees. Landing on 4,987 is a failed payment, not a
 * close one. So the target is a floor: the payout must be at least it, and as near to it as the
 * provider's own pricing allows.
 *
 * The old path divided the target by the indicative display rate and sent that much USDC. The
 * payout then settled at the provider's real rate, which is a spread worse — so a 5,000 request
 * reliably paid out less than 5,000. Dividing by a rate we do not settle at cannot hit a target.
 *
 * This solves against the provider's own quotes instead. Payout is linear in the USDC sold at a
 * given rate, so one quote reveals the rate and the second lands on the target; a third pass
 * exists only for the case where the rate moves underneath us mid-solve.
 */
import type { RampCurrency, RampNetwork, RampPayoutQuote, RampProviderName } from "./types";

/** Quote `amountUsdc` with a provider. Injected so the solver is testable without a network. */
export type QuoteFn = (amountUsdc: number) => Promise<RampPayoutQuote | null>;

export interface FiatTargetSolution {
  /** The binding quote that achieves the target. */
  quote: RampPayoutQuote;
  /** USDC that must be sold to fund it — what the order is created for. */
  amountUsdc: number;
  /** True when the payout lands at or above the target, i.e. the request was honoured. */
  meetsTarget: boolean;
}

/** USDC is 6dp. Round UP, so rounding can only ever favour the recipient. */
export function ceilUsdc(amount: number): number {
  return Math.ceil(amount * 1e6 - 1e-9) / 1e6;
}

/**
 * The smallest USDC amount whose quoted payout is at least `targetFiat`.
 *
 * `seedRate` only picks the starting guess; it never reaches the result, so an indicative rate
 * is fine there. Returns null when the provider will not quote at all.
 */
export async function solveForFiatTarget(
  targetFiat: number,
  seedRate: number,
  quote: QuoteFn,
  maxAttempts = 3,
): Promise<FiatTargetSolution | null> {
  if (!(targetFiat > 0) || !(seedRate > 0)) return null;

  let amountUsdc = ceilUsdc(targetFiat / seedRate);
  let best: FiatTargetSolution | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const q = await quote(amountUsdc);
    if (!q || !(q.payoutAmount > 0)) return best;

    const meetsTarget = q.payoutAmount + 1e-9 >= targetFiat;
    best = { quote: q, amountUsdc, meetsTarget };
    if (meetsTarget) return best;

    // Short. Rescale on what this quote actually paid per USDC — the provider's real rate,
    // not the seed. `ceilUsdc` guarantees the step is upward even when the gap is sub-cent,
    // so this cannot stall repeating the same amount.
    const impliedRate = q.payoutAmount / amountUsdc;
    const next = ceilUsdc(targetFiat / impliedRate);
    amountUsdc = next > amountUsdc ? next : ceilUsdc(amountUsdc + 1e-6);
  }

  return best;
}

/** Inputs the server action needs to build a `QuoteFn` for one corridor. */
export interface FiatTargetRequest {
  targetFiat: number;
  fiatCurrency: RampCurrency;
  network: RampNetwork;
  provider: RampProviderName;
}
