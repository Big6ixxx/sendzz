import { Database } from '@/types/database';
import { getBitnobClient } from '@/lib/bitnob/client';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { triggerWithdrawalNotifications } from '@/lib/supabase/transactions';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRole);

export const runtime = 'nodejs';
export const maxDuration = 300;

// How many users to scan for on-chain deposits per run, and how long to spend on it before
// bailing (the rest are picked up next run — users are ordered least-recently-scanned first).
const DEPOSIT_SCAN_BATCH = 20;
const DEPOSIT_SCAN_BUDGET_MS = 200_000;

/**
 * Reliability net for (1) Bitnob on-chain payouts and (2) on-chain USDC deposit indexing.
 *
 * Payouts: the happy path is driven by the `deposit.success` webhook, which retries `finalize`
 * until the deposit confirms. But that retry loop lives inside a single serverless invocation —
 * if the function is killed, or Bitnob's webhook delivery is missed, a payout can sit in
 * `processing` after its deposit landed. This cron re-drives those (finalize + reconcile RPCs).
 *
 * Deposits: the deposit scanner normally runs when a user opens the app. This cron also scans a
 * rotating batch of least-recently-scanned users so backfills still progress for people who
 * don't open the app often. Both are cheap after the first (cursor-based) scan.
 *
 * Triggered by Vercel Cron (a GET request; see vercel.json). On the Hobby tier crons run at most
 * once/day, so pair it with the GitHub Actions workflow for a higher cadence. Vercel auto-injects
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only touch payouts old enough that the webhook's own retry window (~5 min) has passed,
  // and young enough to still be settleable (quotes/payouts don't live forever).
  const olderThan = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const within = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: stuck, error } = await supabaseAdmin
    .from('withdrawals')
    .select('id, provider_order_id, provider_metadata, created_at')
    .eq('provider', 'bitnob')
    .eq('status', 'processing')
    .lt('created_at', olderThan)
    .gt('created_at', within);

  if (error) {
    console.error('[Reconcile Bitnob] query failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const client = getBitnobClient();
  const results: Array<{ id: string; action: string; detail?: string }> = [];

  for (const w of stuck ?? []) {
    const meta = w.provider_metadata as { quote_id?: string } | null;
    const quoteId = meta?.quote_id;
    const orderId = w.provider_order_id;
    if (!quoteId) {
      results.push({ id: w.id, action: 'skipped', detail: 'no quote_id' });
      continue;
    }

    // 1. Re-drive finalize. If the deposit still isn't confirmed we get the "cannot
    // transition" error, which is transient — leave it for the next run. Any other error
    // (incl. already-finalized) is non-fatal here; the status poll below is authoritative.
    try {
      await client.finalizePayout(quoteId);
      results.push({ id: w.id, action: 'finalized' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: w.id, action: 'finalize-skipped', detail: msg.slice(0, 120) });
    }

    // 2. Poll terminal state and reconcile the ledger in case the webhook was missed.
    if (!orderId) continue;
    try {
      const tx = await client.getTransaction(orderId).catch(() => client.getTransaction(quoteId));
      const state = (tx.state || '').toUpperCase();
      if (['SETTLED', 'COMPLETED', 'SUCCESS'].includes(state)) {
        await supabaseAdmin.rpc('finalize_withdrawal_success', { p_paycrest_order_id: orderId });
        await triggerWithdrawalNotifications(orderId, 'completed');
        results.push({ id: w.id, action: 'reconciled-success' });
      } else if (['FAILED', 'REVERSED', 'EXPIRED'].includes(state)) {
        await supabaseAdmin.rpc('finalize_withdrawal_failed', {
          p_paycrest_order_id: orderId,
          p_reason: `reconcile cron: state=${state}`,
        });
        if (state === 'REVERSED') {
          await supabaseAdmin.from('withdrawals').update({ status: 'reversed' }).eq('provider_order_id', orderId);
        } else {
          await triggerWithdrawalNotifications(orderId, 'failed');
        }
        results.push({ id: w.id, action: 'reconciled-failed', detail: state });
      }
    } catch {
      // Not indexed under this id yet — rely on the webhook / next run.
    }
  }

  console.log(`[Reconcile Bitnob] checked=${stuck?.length ?? 0}`, JSON.stringify(results));

  // ── On-chain deposit indexing for a rotating batch of stale users ───────────
  const deposits = await scanStaleUsers();

  return NextResponse.json({ checked: stuck?.length ?? 0, results, deposits });
}

/** Scan the least-recently-scanned users for new on-chain USDC deposits, within a time budget. */
async function scanStaleUsers(): Promise<{ scanned: number; inserted: number }> {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('id, smart_account_address, solana_address')
    .or('smart_account_address.not.is.null,solana_address.not.is.null')
    .order('last_deposit_scan_at', { ascending: true, nullsFirst: true })
    .limit(DEPOSIT_SCAN_BATCH);

  if (error) {
    console.error('[Reconcile Deposits] user query failed:', error.message);
    return { scanned: 0, inserted: 0 };
  }

  const { scanUsdcDeposits } = await import('@/lib/web3/deposit-scanner');
  const start = Date.now();
  let scanned = 0;
  let inserted = 0;

  for (const u of users ?? []) {
    if (Date.now() - start > DEPOSIT_SCAN_BUDGET_MS) break; // leave the rest for next run
    try {
      inserted += await scanUsdcDeposits({
        userId: u.id,
        address: u.smart_account_address ?? '',
        solanaAddress: u.solana_address ?? undefined,
      });
      scanned++;
    } catch (e) {
      console.error('[Reconcile Deposits] scan failed:', e instanceof Error ? e.message : e);
    }
  }

  console.log(`[Reconcile Deposits] scanned=${scanned} inserted=${inserted}`);
  return { scanned, inserted };
}
