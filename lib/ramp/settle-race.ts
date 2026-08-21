/**
 * Deciding whether a lost race is actually a failure.
 *
 * Three callers race to settle a deferred payout once its deposit lands — the browser, the
 * deposit webhook and the reconcile cron. The race is deliberate: whoever gets there first
 * should settle it, so a closed tab or a missed webhook cannot strand someone's money. A Bitnob
 * quote holds exactly one payout, so the provider itself is the mutex and no double payout is
 * possible.
 *
 * What matters is that the LOSERS stay quiet. A quote that already carries a beneficiary is a
 * won race, not an error — the caller should carry on and finalize rather than reporting a
 * failure and leaving a real payout looking broken.
 *
 * Kept in its own module so it can be tested without pulling in the Supabase admin client.
 */
export function isAlreadyInitialized(message: string): boolean {
  return /already|exists|initiali[sz]ed|cannot transition/i.test(message || "");
}
