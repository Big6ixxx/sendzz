/**
 * Sending accrued referral earnings to the referrer's Sendzz wallet.
 *
 * --- Why a sweep, and not a payment per deposit ------------------------------
 *
 * A commission is a fraction of a fee, which is a fraction of a deposit — so an individual one
 * is usually cents. Sending each as its own USDC transfer would mean paying gas repeatedly to
 * move amounts smaller than the gas, filling the referrer's history with dust, and turning
 * every deposit into a treasury transaction that can fail on its own. Accruing to a ledger and
 * sweeping the total above a floor costs one transfer per referrer per run instead.
 *
 * --- The ordering that matters ----------------------------------------------
 *
 * The rows are CLAIMED before the money moves, and settled after:
 *
 *   1. create a `pending` payout
 *   2. attach the accrued rows to it, conditionally on them still being accrued
 *   3. send the USDC
 *   4. mark the payout `paid`, or release the rows and mark it `failed`
 *
 * Claiming first is what stops a second run — an overlapping schedule, a manual trigger, a
 * retry after a timeout — from seeing the same rows as unpaid and paying them twice. The cost
 * of this order is that a crash between 2 and 4 leaves rows attached to a payout that never
 * completed, which is visible and fixable. The cost of the other order is paying twice, which
 * is neither.
 */

import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';

import { supabaseAdmin } from '@/lib/supabase/adminClient';

/**
 * The smallest balance worth a transfer.
 *
 * Below this, the gas and the noise cost more than the payment is worth, and the earnings just
 * wait for the next run. From the environment so it can be tuned without a deploy.
 */
function minimumPayout(): number {
  const raw = Number(process.env.REFERRAL_MIN_PAYOUT_USDC);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

/** Referral payouts settle on Base: cheap, and where every Sendzz smart account already is. */
export const PAYOUT_CHAIN = 'base';

export interface PayoutConfig {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  tokenId: string;
}

/**
 * The treasury configuration, or a description of what is missing.
 *
 * Returns the problem rather than throwing it, so the cron can report a clear "not configured
 * yet" instead of a stack trace — and so a deployment that has not set this up yet accrues
 * earnings normally and simply does not pay them out. Nothing is lost while it is unset; the
 * ledger keeps the record and the next run pays.
 */
export function readPayoutConfig(): { config: PayoutConfig } | { missing: string[] } {
  const config = {
    apiKey: process.env.CIRCLE_API_KEY ?? '',
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? '',
    walletId: process.env.CIRCLE_PAYOUT_WALLET_ID ?? '',
    tokenId: process.env.CIRCLE_PAYOUT_USDC_TOKEN_ID ?? '',
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) =>
      ({
        apiKey: 'CIRCLE_API_KEY',
        entitySecret: 'CIRCLE_ENTITY_SECRET',
        walletId: 'CIRCLE_PAYOUT_WALLET_ID',
        tokenId: 'CIRCLE_PAYOUT_USDC_TOKEN_ID',
      })[key]!,
    );

  return missing.length > 0 ? { missing } : { config };
}

/**
 * What the payout wallet is holding, in USDC.
 *
 * Returns null when the balance cannot be read, and the caller treats that as "unknown"
 * rather than as zero. Guessing zero would fire a low-balance alarm every time Circle's API
 * had a bad minute, which is the fastest way to make the alarm meaningless.
 */
export async function readTreasuryBalance(config: PayoutConfig): Promise<number | null> {
  try {
    const circle = initiateDeveloperControlledWalletsClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    });

    const response = await circle.getWalletTokenBalance({ id: config.walletId });
    const balances = response.data?.tokenBalances ?? [];

    // Matched on the token id we are configured to SEND, not on a symbol. A wallet can hold
    // several things called USDC across networks, and paying out against the wrong one's
    // balance would report plenty while the transfer fails for want of funds.
    const usdc = balances.find((entry) => entry.token?.id === config.tokenId);
    if (!usdc) return 0;

    const amount = Number(usdc.amount);
    return Number.isFinite(amount) ? amount : null;
  } catch (err) {
    console.error('[Referrals] could not read treasury balance:', (err as Error).message);
    return null;
  }
}

export interface PayableReferrer {
  referrerId: string;
  destination: string;
  total: number;
  earningIds: string[];
}

/** Everyone owed at least the minimum, with the rows that make up each balance. */
export async function findPayableReferrers(): Promise<PayableReferrer[]> {
  const { data: earnings, error } = await supabaseAdmin
    .from('referral_earnings')
    .select('id, referrer_id, amount_usdc')
    .eq('status', 'accrued');

  if (error) {
    console.error('[Referrals] could not read accrued earnings:', error.message);
    return [];
  }
  if (!earnings || earnings.length === 0) return [];

  const byReferrer = new Map<string, { total: number; ids: string[] }>();
  for (const row of earnings) {
    const entry = byReferrer.get(row.referrer_id) ?? { total: 0, ids: [] };
    entry.total += Number(row.amount_usdc) || 0;
    entry.ids.push(row.id);
    byReferrer.set(row.referrer_id, entry);
  }

  const floor = minimumPayout();
  const payable: PayableReferrer[] = [];

  for (const [referrerId, entry] of byReferrer) {
    if (entry.total < floor) continue;

    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('smart_account_address')
      .eq('id', referrerId)
      .maybeSingle();

    const destination = referrer?.smart_account_address;
    // An account with no smart address has never finished signing in, so there is nowhere to
    // send this. The earnings stay accrued and are paid the first run after they appear.
    if (!destination) {
      console.warn(`[Referrals] ${referrerId} is owed ${entry.total.toFixed(2)} but has no wallet yet`);
      continue;
    }

    payable.push({
      referrerId,
      destination,
      // Truncated, never rounded up: paying a fraction of a cent more than was earned would
      // make the ledger and the treasury disagree, in the direction that grows over time.
      total: Math.floor(entry.total * 1e6) / 1e6,
      earningIds: entry.ids,
    });
  }

  return payable;
}

/**
 * Pay one referrer, moving the ledger with the money.
 *
 * Returns the transaction id on success. Never throws — one referrer's failure must not stop
 * the rest of the run, and a failure here releases its rows so the next run retries them.
 */
export async function payReferrer(
  referrer: PayableReferrer,
  config: PayoutConfig,
): Promise<{ ok: true; txId: string } | { ok: false; error: string }> {
  // 1. Claim.
  const { data: payout, error: payoutError } = await supabaseAdmin
    .from('referral_payouts')
    .insert({
      referrer_id: referrer.referrerId,
      amount_usdc: referrer.total,
      destination: referrer.destination,
      chain: PAYOUT_CHAIN,
      status: 'pending',
    })
    .select('id')
    .single();

  if (payoutError || !payout) {
    return { ok: false, error: payoutError?.message ?? 'could not create payout' };
  }

  // 2. Attach the rows — but only those still accrued. If a concurrent run claimed some of
  // them first, this one gets fewer than it planned for, which is why the amount actually
  // sent is recomputed from what was claimed rather than from the earlier total.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('referral_earnings')
    .update({ status: 'paid', payout_id: payout.id, updated_at: new Date().toISOString() })
    .in('id', referrer.earningIds)
    .eq('status', 'accrued')
    .select('id, amount_usdc');

  if (claimError || !claimed || claimed.length === 0) {
    await supabaseAdmin
      .from('referral_payouts')
      .update({ status: 'failed', error: claimError?.message ?? 'nothing left to claim' })
      .eq('id', payout.id);
    return { ok: false, error: claimError?.message ?? 'nothing left to claim' };
  }

  const amount = Math.floor(claimed.reduce((sum, r) => sum + (Number(r.amount_usdc) || 0), 0) * 1e6) / 1e6;

  if (amount !== referrer.total) {
    // Another run took some of these rows in between. Not an error — pay what was actually
    // claimed, and record that figure.
    await supabaseAdmin
      .from('referral_payouts')
      .update({ amount_usdc: amount })
      .eq('id', payout.id);
  }

  // 3. Send.
  try {
    const circle = initiateDeveloperControlledWalletsClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    });

    const response = await circle.createTransaction({
      walletId: config.walletId,
      tokenId: config.tokenId,
      destinationAddress: referrer.destination,
      amount: [amount.toFixed(6)],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      // The payout row's id, so a retry that reaches Circle twice — a timeout where the
      // request actually landed, a redeployed cron re-running mid-flight — is deduplicated
      // by Circle rather than sending the money again.
      idempotencyKey: payout.id,
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Circle returned no transaction id');

    // 4a. Settle.
    //
    // Recorded as `provider_tx_id`, deliberately not as `tx_hash`. What Circle returns here is
    // its own identifier for the transfer; the on-chain hash does not exist yet, because the
    // transaction has not been mined. Writing this into `tx_hash` would make the UI produce
    // confident explorer links to pages that do not exist.
    await supabaseAdmin
      .from('referral_payouts')
      .update({
        status: 'paid',
        provider_tx_id: txId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payout.id);

    return { ok: true, txId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // 4b. Release. The rows go back to accrued so the next run tries again, and the failed
    // payout stays as the record of what happened.
    await supabaseAdmin
      .from('referral_earnings')
      .update({ status: 'accrued', payout_id: null, updated_at: new Date().toISOString() })
      .eq('payout_id', payout.id);

    await supabaseAdmin
      .from('referral_payouts')
      .update({ status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', payout.id);

    console.error(`[Referrals] payout to ${referrer.referrerId} failed:`, message);
    return { ok: false, error: message };
  }
}
