import { Database } from '@/types/database';
import { getBitnobClient, hasSharedDepositAddress } from '@/lib/bitnob/client';
import { openBeneficiary } from '@/lib/ramp/beneficiary-vault';
import { completeDeferredPayout } from '@/lib/ramp/deferred-settle';
import { getCorridorFee } from '@/lib/ramp/fees';
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
 * A GET request, authorised with `Authorization: Bearer $CRON_SECRET`. Scheduled from Coolify
 * every 2 minutes, with .github/workflows/reconcile-transactions.yml as an outside-the-host
 * backstop. The cadence is not cosmetic: a payout quote lives about 16 minutes, so anything
 * slower can only record a failure rather than prevent one.
 *
 * If CRON_SECRET is unset the endpoint is OPEN — set it in both places or neither is protected.
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
    .select('id, provider_order_id, provider_metadata, amount_usdc, created_at, tx_hash, fiat_currency, pending_beneficiary')
    .eq('provider', 'bitnob')
    .eq('status', 'processing')
    // The 5-minute floor exists to let the webhook's own retry window pass first. It must not
    // apply to a deferred payout still holding a sealed beneficiary: no payout exists there, so
    // no webhook is driving it, and the quote dies in ~16 minutes. Waiting would burn a third of
    // the only window in which the user's deposit can still be turned into a payout.
    .or(`created_at.lt.${olderThan},pending_beneficiary.not.is.null`)
    .gt('created_at', within);

  if (error) {
    console.error('[Reconcile Bitnob] query failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const client = getBitnobClient();
  const results: Array<{ id: string; action: string; detail?: string }> = [];

  for (const w of stuck ?? []) {
    const meta = w.provider_metadata as
      | { quote_id?: string; deposit_address?: string; network?: string }
      | null;
    const quoteId = meta?.quote_id;
    const orderId = w.provider_order_id;
    if (!quoteId) {
      results.push({ id: w.id, action: 'skipped', detail: 'no quote_id' });
      continue;
    }

    // 0. Does a payout exist yet?
    //
    // On a shared-address chain the beneficiary is attached only after the deposit is verified,
    // and the browser is normally what triggers that. If the user closed the tab or lost their
    // connection in between, their money is credited and NOTHING else will ever finish the job —
    // so this is where it gets finished. `trip.initialized_at` is the authoritative flag: an
    // uninitialized quote carries no beneficiary and eventually reports EXPIRED.
    const quote = await client.getPayoutQuote(quoteId).catch(() => null);
    const hasPayout = !!quote?.trip?.initialized_at || !!quote?.beneficiary;

    if (quote && !hasPayout) {
      const expired =
        (quote.status || '').toUpperCase() === 'EXPIRED' ||
        (quote.expires_at ? Date.parse(quote.expires_at) < Date.now() : false);

      if (expired) {
        // Dead quote, no payout, and none can be created now. Without a terminal state this row
        // would sit in `processing` forever, holding the user's balance and polling an order
        // Bitnob has never heard of.
        if (orderId) {
          await supabaseAdmin.rpc('finalize_withdrawal_failed', { p_paycrest_order_id: orderId });
          await triggerWithdrawalNotifications(orderId, 'failed');
        }
        results.push({
          id: w.id,
          action: 'failed-quote-expired',
          detail: `quote ${quoteId} expired with no payout — deposit is a balance credit`,
        });
        continue;
      }

      // Still live: recover it. Same gates the browser path runs, including the hash claim.
      const beneficiary = openBeneficiary(w.pending_beneficiary);
      if (!beneficiary || !w.tx_hash) {
        results.push({
          id: w.id,
          action: 'deferred-held',
          detail: !w.tx_hash ? 'no tx_hash recorded yet' : 'no sealed beneficiary to finish with',
        });
        continue;
      }

      const base = w.amount_usdc != null ? Number(w.amount_usdc) : 0;
      const recovered = await completeDeferredPayout(
        {
          rowId: w.id,
          quoteId,
          orderId: orderId ?? '',
          txHash: w.tx_hash,
          requiredUsdc: base + getCorridorFee('bitnob', w.fiat_currency),
          network: meta?.network ?? 'stellar',
          fiatCurrency: w.fiat_currency,
          bank: beneficiary,
          currentTxHash: w.tx_hash,
          // The cron re-runs every 2 minutes, so it should not sit here holding an invocation.
          maxAttempts: 3,
        },
        `[Reconcile] deferred ${orderId}:`,
      );
      results.push({
        id: w.id,
        action: recovered.ok ? 'deferred-recovered' : 'deferred-incomplete',
        detail: recovered.reason,
      });
      continue;
    }

    // 1. Re-drive finalize, but only against a deposit that has actually SETTLED. Bitnob opens
    // the transition on detection, so its own error is not a sufficient guard.
    //
    // What identifies the deposit depends on the chain: Stellar hands every payout the same
    // static address, so only our own transfer hash can tie one to this row. Matching on the
    // shared address there would settle this payout against whichever deposit happened to be
    // large enough — including another user's.
    const shared = hasSharedDepositAddress(meta?.network);
    const verifyBy = shared
      ? { txHash: w.tx_hash ?? undefined }
      : { address: meta?.deposit_address };
    const canVerify = shared ? !!w.tx_hash : !!meta?.deposit_address;

    const settled = canVerify
      ? await client
          .findSettledDeposit({
            ...verifyBy,
            minAmountUsdc: w.amount_usdc != null ? Number(w.amount_usdc) : undefined,
          })
          .catch(() => null)
      : null;

    if (!settled) {
      results.push({
        id: w.id,
        action: 'finalize-held',
        detail: canVerify
          ? 'deposit not settled'
          : shared
            ? 'no tx_hash to verify a shared-address deposit'
            : 'no deposit_address to verify',
      });
    } else {
      try {
        await client.finalizePayout(quoteId);
        results.push({ id: w.id, action: 'finalized', detail: settled.reference });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ id: w.id, action: 'finalize-skipped', detail: msg.slice(0, 120) });
      }
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

  // ── Money we owe, and money with nowhere to go ─────────────────────────────
  //
  // Both of these are states a user feels before we do. An outstanding refund means someone's
  // USDC left their wallet and has not come back; a failed row still holding a sealed
  // beneficiary means a deposit landed with no payout to belong to. Neither resolves itself,
  // and the only reason the last one was found at all is that the user complained.
  //
  // Surfaced on every run so they show up in logs rather than waiting for a support message.
  const { data: owed } = await supabaseAdmin
    .from('withdrawals')
    .select('id, provider_order_id, refund_owed_usdc, tx_hash, source_chain, created_at')
    .not('refund_owed_usdc', 'is', null)
    .is('refund_tx_hash', null)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: stranded } = await supabaseAdmin
    .from('withdrawals')
    .select('id, provider_order_id, amount_usdc, tx_hash')
    .eq('status', 'failed')
    .not('pending_beneficiary', 'is', null)
    .not('tx_hash', 'is', null)
    .limit(50);

  const owedTotal = (owed ?? []).reduce((t, w) => t + Number(w.refund_owed_usdc ?? 0), 0);
  if (owed && owed.length > 0) {
    console.error(
      `[Reconcile] ⚠ ${owed.length} REFUND(S) OUTSTANDING totalling ${owedTotal.toFixed(6)} USDC — ` +
        owed.map((w) => `${w.provider_order_id}(${w.refund_owed_usdc})`).join(', '),
    );
  }
  if (stranded && stranded.length > 0) {
    console.error(
      `[Reconcile] ⚠ ${stranded.length} DEPOSIT(S) STRANDED — funded withdrawals with no payout: ` +
        stranded.map((w) => w.provider_order_id).join(', '),
    );
  }

  return NextResponse.json({
    checked: stuck?.length ?? 0,
    results,
    deposits,
    refundsOutstanding: { count: owed?.length ?? 0, totalUsdc: owedTotal },
    stranded: stranded?.length ?? 0,
  });
}

/** Scan the least-recently-scanned users for new on-chain USDC deposits, within a time budget. */
async function scanStaleUsers(): Promise<{ scanned: number; inserted: number }> {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('id, smart_account_address, solana_address, stellar_address')
    .or('smart_account_address.not.is.null,solana_address.not.is.null,stellar_address.not.is.null')
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
        stellarAddress: u.stellar_address ?? undefined,
      });
      scanned++;
    } catch (e) {
      console.error('[Reconcile Deposits] scan failed:', e instanceof Error ? e.message : e);
    }
  }

  console.log(`[Reconcile Deposits] scanned=${scanned} inserted=${inserted}`);
  return { scanned, inserted };
}
