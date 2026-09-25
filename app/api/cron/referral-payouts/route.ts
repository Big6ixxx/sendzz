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
import { sendReferralTreasuryAlert } from '@/lib/email/admin-alerts';
import { claimAlertSlot } from '@/lib/ops/alert-cooldown';
import {
  PAYOUT_CHAIN,
  findPayableReferrers,
  payReferrer,
  readPayoutConfig,
  readTreasuryBalance,
} from '@/lib/referrals/payout';

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

/**
 * How much headroom counts as comfortable.
 *
 * A balance below this multiple of what is owed gets a heads-up while payouts are still
 * working. The point is to be told BEFORE referrals quietly stop arriving — the failure mode
 * without it is invisible, because a sweep that cannot pay releases its earnings and retries
 * next run, so nothing breaks and nothing is lost. It just silently stops.
 */
const COMFORTABLE_BALANCE_MULTIPLE = 3;

/**
 * How often each alert may repeat while the condition persists.
 *
 * Two keys, not one, so a "blocked" alert is never swallowed by a cooldown started by an
 * earlier heads-up — the two mean different things and the urgent one must get through. Both
 * are long, because the condition only resolves when a human tops up a wallet, and an hourly
 * reminder is how alerts get filtered into a folder nobody reads.
 */
const ALERT_BLOCKED = { key: 'referral_payout_treasury_blocked', cooldownMs: 6 * 60 * 60 * 1000 };
const ALERT_LOW = { key: 'referral_payout_treasury_low', cooldownMs: 48 * 60 * 60 * 1000 };

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

  // ── Is there enough to pay with? ───────────────────────────────────────────
  //
  // Checked before sweeping rather than discovered mid-run, so the alert can say what is
  // owed in total rather than what happened to be left when the transfers started failing.
  //
  // This wallet does not refill itself, and that is worth being explicit about: deposit
  // revenue sits with Paycrest, and bridge and withdrawal fees go to Bitnob-hosted addresses.
  // None of it arrives here. Topping up is a deliberate treasury action, so somebody has to
  // be told when it is due.
  const owed = payable.reduce((total, referrer) => total + referrer.total, 0);
  const balance = await readTreasuryBalance(configured.config);

  // A balance we could not read is unknown, not zero. Firing a low-balance alarm every time
  // Circle's API has a bad minute is the fastest way to make the alarm meaningless, so an
  // unreadable balance is logged and the run proceeds — the transfers themselves are the
  // backstop, and they fail safely.
  if (balance != null && owed > 0) {
    const blocking = balance < owed;
    const low = balance < owed * COMFORTABLE_BALANCE_MULTIPLE;

    if (blocking || low) {
      const slot = blocking ? ALERT_BLOCKED : ALERT_LOW;
      if (await claimAlertSlot(slot.key, slot.cooldownMs)) {
        await sendReferralTreasuryAlert({
          balanceUsdc: balance,
          pendingUsdc: owed,
          referrerCount: payable.length,
          walletId: configured.config.walletId,
          chain: PAYOUT_CHAIN,
          blocking,
        });
      }
    }
  } else if (balance == null) {
    console.warn('[Referrals] treasury balance unreadable; sweeping anyway');
  }

  // The sweep runs either way. A balance that covers some referrers should pay those
  // referrers — each payout succeeds or releases its own rows independently, so a partial
  // run is a partial success rather than a failure.
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
    treasuryUsdc: balance,
    owedUsdc: Number(owed.toFixed(6)),
  });
}
