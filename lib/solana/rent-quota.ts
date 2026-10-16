/** Rent quota for token accounts our Solana fee payer opens — see lib/solana/sponsor. */

/**
 * Spend `count` units of rent quota, one atomic step each, and say whether all were granted.
 *
 * Reserved BEFORE broadcasting, not charged after landing. A peek followed by a later charge let
 * any number of concurrent submits pass the same peek — the monthly cap then capped nothing.
 * `consume_rate_limit` is a single statement per unit, so parallel callers cannot all succeed.
 * The cost is that a send which fails after this point has still used its quota; that is the
 * safe direction to be wrong in, because the quota exists to bound what we pay.
 */
export async function reserveRent(
  count: number,
  consume: () => Promise<{ allowed: boolean }>,
): Promise<boolean> {
  for (let i = 0; i < count; i++) {
    if (!(await consume()).allowed) return false;
  }
  return true;
}
