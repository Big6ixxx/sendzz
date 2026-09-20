/**
 * The scheduled sweep that pays accrued referral earnings.
 *
 * Referral commissions are accrued to a ledger as deposits confirm (lib/referrals/accrue.ts)
 * and paid in batches from here, rather than one transfer per deposit — see the header of
 * lib/referrals/payout.ts on why that shape, and on the claim-then-send ordering that stops a
 * second run paying the same rows twice.
 *
 * A GET, authorised with `Authorization: Bearer $CRON_SECRET`, exactly like
 * /api/cron/reconcile-transactions. Hourly is plenty: nothing here is time-critical, the
 * amounts only grow while they wait, and every run costs a transfer per referrer.
 *
 * If CRON_SECRET is unset this endpoint REFUSES to run — see lib/auth/cron.ts.
 */

import { NextResponse } from 'next/server';

import { rejectUnauthorizedCron } from '@/lib/auth/cron';
import { findPayableReferrers, payReferrer, readPayoutConfig } from '@/lib/referrals/payout';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * How many referrers one run will pay.
 *
 * A bound, not a target. Each payout is a network round trip to Circle, and a run that tried
 * to clear a thousand of them would be killed partway — leaving rows claimed against payouts
 * that never completed. The rest wait for the next run, which is a delay and not a loss.
 */
const BATCH_LIMIT = 50;

export async function GET(req: Request) {
  const unauthorized = rejectUnauthorizedCron(req);
  if (unauthorized) return unauthorized;

  // Checked before any row is touched. A misconfigured treasury must not claim earnings it
  // then cannot send — that would mark them paid against a payout that could never happen.
  const configured = readPayoutConfig();
  if ('missing' in configured) {
    console.error(
      '[Referrals] payouts are not configured; earnings will keep accruing untouched. ' +
        `Missing: ${configured.missing.join(', ')}`,
    );
    return NextResponse.json(
      {
        ok: false,
        reason: 'not_configured',
        missing: configured.missing,
        // Said explicitly, because "the cron is erroring" and "we are quietly not paying
        // anyone" look identical in a dashboard otherwise.
        note: 'Earnings continue to accrue. Nothing is lost; the first configured run pays them.',
      },
      { status: 503 },
    );
  }

  const payable = await findPayableReferrers();
  if (payable.length === 0) {
    return NextResponse.json({ ok: true, paid: 0, skipped: 0 });
  }

  const batch = payable.slice(0, BATCH_LIMIT);
  let paid = 0;
  let failed = 0;
  let totalUsdc = 0;

  for (const referrer of batch) {
    // Sequential, not parallel. These all spend from one treasury wallet, and Circle
    // serialises transactions per wallet anyway — firing them together just converts an
    // orderly queue into a pile of nonce conflicts.
    const result = await payReferrer(referrer, configured.config);
    if (result.ok) {
      paid += 1;
      totalUsdc += referrer.total;
    } else {
      failed += 1;
    }
  }

  console.log(
    `[Referrals] swept ${paid} payout(s) totalling ${totalUsdc.toFixed(2)} USDC` +
      (failed > 0 ? `, ${failed} failed and released for retry` : ''),
  );

  return NextResponse.json({
    ok: true,
    paid,
    failed,
    totalUsdc: Number(totalUsdc.toFixed(6)),
    remaining: Math.max(0, payable.length - batch.length),
  });
}
