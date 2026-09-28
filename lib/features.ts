/**
 * Features that are built but not yet open to users.
 *
 * Referrals is complete enough to run end to end and not ready to be advertised: the payout
 * treasury is new, the accrual has not been watched over a full cycle, and a commission that
 * silently fails to arrive is worse than one that was never offered. So the tab is shown as
 * "Soon" rather than removed — hiding it entirely would mean deleting work and putting it
 * back later, and the placeholder is also a truthful answer to "is this coming?".
 *
 * OFF unless explicitly switched on, so production needs no configuration to stay closed.
 * Forgetting to set a variable leaves a feature hidden, which is the harmless direction; the
 * opposite default would ship it by omission.
 *
 * `NEXT_PUBLIC_` because the sidebar is a client component and has to make the same decision
 * the page does. That also means the value is inlined at build time rather than read at
 * runtime — it is a release switch, not something to flip on a live deployment, and it cannot
 * be changed from the browser.
 */
export function referralsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REFERRALS_ENABLED === 'true';
}
