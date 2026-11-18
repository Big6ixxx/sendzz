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
  maxAttempts = 4,
): Promise<FiatTargetSolution | null> {
  if (!(targetFiat > 0) || !(seedRate > 0)) return null;

  let amountUsdc = ceilUsdc(targetFiat / seedRate);
  let met: FiatTargetSolution | null = null;
  let short: FiatTargetSolution | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const q = await quote(amountUsdc);
    if (!q || !(q.payoutAmount > 0)) break;

    // What this quote actually paid per USDC: the provider's real rate, not the seed.
    const next = ceilUsdc(targetFiat / (q.payoutAmount / amountUsdc));

    if (q.payoutAmount + 1e-9 >= targetFiat) {
      met = { quote: q, amountUsdc, meetsTarget: true };
      // Over the target by more than rounding (a pessimistic seed): come back down to the
      // smallest amount that still meets it, unless that amount already came up short.
      if (next >= amountUsdc || (short && next <= short.amountUsdc)) return met;
      amountUsdc = next;
      continue;
    }

    short = { quote: q, amountUsdc, meetsTarget: false };
    // Stepped down and came up short: the last amount that met the target is the answer.
    if (met) return met;
    // `ceilUsdc` guarantees the step is upward even when the gap is sub-cent, so this cannot
    // stall repeating the same amount.
    amountUsdc = next > amountUsdc ? next : ceilUsdc(amountUsdc + 1e-6);
  }

  return met ?? short;
}

/** Inputs the server action needs to build a `QuoteFn` for one corridor. */
export interface FiatTargetRequest {
  targetFiat: number;
  fiatCurrency: RampCurrency;
  network: RampNetwork;
  provider: RampProviderName;
}
