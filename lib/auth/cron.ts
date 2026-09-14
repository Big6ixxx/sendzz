/**
 * The gate in front of every scheduled job.
 *
 * These endpoints are unauthenticated in the user sense — no session, no cookie — so a shared
 * secret is the only thing separating "our scheduler" from "anyone with the URL". They are also
 * expensive: a single reconcile run scans wallets across six chains and spends Alchemy and RPC
 * quota, so an open one is a standing invitation to burn the budget.
 *
 * --- Why this fails CLOSED ---------------------------------------------------
 *
 * The original check read `if (cronSecret && header !== ...)`, so a deployment with no
 * CRON_SECRET skipped the comparison and served every caller — while looking perfectly healthy.
 * Nothing about a missing secret was visible until someone found the URL.
 *
 * A missing secret is now a refusal rather than a bypass. The trade is deliberate: if
 * CRON_SECRET is ever unset the jobs stop, loudly, instead of running for everybody.
 */
import { NextResponse } from 'next/server';

/** Returns a response to send back when the caller is NOT authorised, or null when they are. */
export function rejectUnauthorizedCron(req: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error(
      '[Cron] CRON_SECRET is not set. Refusing to run rather than serving this endpoint ' +
        'to anyone. Set CRON_SECRET in the deployment environment.',
    );
    return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 });
  }

  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
