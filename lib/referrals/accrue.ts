/**
 * Crediting a referrer when the person they brought cashes out.
 *
 * Withdrawals are the only thing that earns here, because withdrawals are the only thing on
 * the fiat rails that earns US anything: deposits are free, and an on-chain arrival costs the
 * sender nothing but gas. Paying a share of those would be paying real money for activity that
 * generates none — and since a deposit can be reversed by withdrawing, it would be farmable in
 * a loop.
 *
 * What a referrer gets depends on which programme they are on, and it is always exactly one:
 *
 *   scout  — a fixed share of VOLUME, paid in USDC. See lib/referrals/tiers.ts for why volume
 *            rather than a share of the fee, and for the cap that keeps a thin corridor from
 *            paying out more than it earned.
 *   retail — a one-off fee credit per referee who passes a milestone. No cash leaves Sendzz;
 *            see lib/referrals/benefits.ts.
 *
 * Both would stack if either forgot to check, and stacking is a loss per transaction.
 */

import { getCorridorFee, getWithdrawalFeePercent, feeFromBase } from '@/lib/ramp/fees';
import type { RampProviderName } from '@/lib/ramp/types';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { grantMilestoneCredit } from './benefits';
import { computeCommission, minimumWithdrawalUsdc, tierForVolume } from './tiers';

/** The window a tier is assessed over. Calendar month, matching how the tiers are described. */
function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * A referrer's network volume so far this month — what their referees have withdrawn.
 *
 * Only completed withdrawals count. Pricing a tier off money that is still in flight would let
 * a failed payout promote somebody, and the tier is frozen onto every earning it touches.
 */
export async function monthlyNetworkVolume(referrerId: string): Promise<number> {
  const { data: referees } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('referred_by', referrerId);

  const ids = (referees ?? []).map((r) => r.id);
  if (ids.length === 0) return 0;

  const { data: rows } = await supabaseAdmin
    .from('withdrawals')
    .select('amount_usdc')
    .in('user_id', ids)
    .eq('status', 'completed')
    .gte('created_at', monthStart());

  return (rows ?? []).reduce((total, row) => total + (Number(row.amount_usdc) || 0), 0);
}

/**
 * What this withdrawal earned us, and what it cost a third party.
 *
 * Prefers the figures recorded ON THE ROW. They are written when the order is created, from
 * the rate in force at that moment, so they stay correct after a corridor is repriced.
 * Recomputing from today's configuration would quietly restate an old withdrawal's economics.
 *
 * Falls back to recomputing only when the columns are absent — an older row written before
 * migration 055, or one whose metadata never carried a fee.
 */
function withdrawalEconomics(withdrawal: {
  amount_usdc: number;
  platform_fee_usdc: number | null;
  corridor_fee_usdc: number | null;
  provider: string | null;
  fiat_currency: string;
  provider_metadata: unknown;
}): { grossFeeUsdc: number; corridorCostUsdc: number } {
  const metadata = (withdrawal.provider_metadata ?? {}) as { fee_usdc?: number | string };
  const provider = (withdrawal.provider ?? 'bitnob').toLowerCase() as RampProviderName;
  const amount = Number(withdrawal.amount_usdc) || 0;

  const recordedFee =
    withdrawal.platform_fee_usdc != null
      ? Number(withdrawal.platform_fee_usdc)
      : metadata.fee_usdc != null
        ? Number(metadata.fee_usdc)
        : null;

  let grossFeeUsdc: number;
  if (recordedFee != null && Number.isFinite(recordedFee)) {
    grossFeeUsdc = recordedFee;
  } else {
    try {
      grossFeeUsdc = feeFromBase(amount, getWithdrawalFeePercent(withdrawal.fiat_currency));
    } catch {
      // No rate configured at all. Earning nothing is the safe answer — a guessed fee would
      // pay a commission against revenue we cannot confirm we collected.
      grossFeeUsdc = 0;
    }
  }

  const corridorCostUsdc =
    withdrawal.corridor_fee_usdc != null
      ? Number(withdrawal.corridor_fee_usdc)
      : getCorridorFee(provider, withdrawal.fiat_currency);

  return {
    grossFeeUsdc: Number.isFinite(grossFeeUsdc) ? grossFeeUsdc : 0,
    corridorCostUsdc: Number.isFinite(corridorCostUsdc) ? corridorCostUsdc : 0,
  };
}

/**
 * Credit the referrer for a withdrawal that has just completed.
 *
 * Idempotent, and that property is load-bearing rather than defensive. Provider webhooks fire
 * more than once for the same payout — retries, redeliveries, and the reconcile cron
 * re-driving a settlement — so "called exactly once" is not something this can assume. The
 * unique index on `withdrawal_id` makes the second call a no-op.
 *
 * Never throws. It runs inside the webhook that confirms the user's payout, and nothing about
 * a commission should be able to fail that.
 */
export async function accrueReferralEarning(params: {
  /** The internal withdrawals.id, or the provider order id the webhook has in hand. */
  withdrawalId?: string;
  providerOrderId?: string;
}): Promise<void> {
  try {
    const columns =
      'id, user_id, amount_usdc, status, provider, fiat_currency, platform_fee_usdc, corridor_fee_usdc, provider_metadata';

    // Webhooks know the provider's order id; the cron and tests know ours. Accept either
    // rather than making every caller resolve it first.
    const query = supabaseAdmin.from('withdrawals').select(columns);
    const { data: withdrawal } = params.withdrawalId
      ? await query.eq('id', params.withdrawalId).maybeSingle()
      : await query.eq('provider_order_id', params.providerOrderId ?? '').maybeSingle();

    if (!withdrawal) return;

    // Only money that actually reached somebody's bank. A processing payout can still fail.
    if (withdrawal.status !== 'completed') return;

    const volumeUsdc = Number(withdrawal.amount_usdc);
    if (!Number.isFinite(volumeUsdc) || volumeUsdc <= 0) return;

    // Below the floor, flat corridor costs dominate and a commission is noise on a margin
    // that barely exists. See minimumWithdrawalUsdc.
    if (volumeUsdc < minimumWithdrawalUsdc()) return;

    const { data: referee } = await supabaseAdmin
      .from('users')
      .select('id, referred_by')
      .eq('id', withdrawal.user_id)
      .maybeSingle();

    if (!referee?.referred_by) return;

    // ── One programme per referrer, never both ──────────────────────────────
    //
    // The two tracks pay for the same event. A Gold Scout earns 0.25% of this withdrawal; a
    // retail referrer earns a $2 credit once this person passes $100. Paying both on a $100
    // withdrawal would be $2.25 against a $0.50 fee — a loss per transaction that grows with
    // volume. So the referrer's programme decides which one runs, and the other does not.
    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('referral_program')
      .eq('id', referee.referred_by)
      .maybeSingle();

    if ((referrer?.referral_program ?? 'retail') !== 'scout') {
      await grantMilestoneCredit({
        referrerId: referee.referred_by,
        refereeId: referee.id,
      });
      return;
    }

    // The tier as it stands NOW, frozen onto this row. A referrer who reaches Gold mid-month
    // earns Gold on what follows — not retroactively on what came before, which would make
    // every row provisional until the month closed and block payouts until then.
    const tier = tierForVolume(await monthlyNetworkVolume(referee.referred_by));

    const { grossFeeUsdc, corridorCostUsdc } = withdrawalEconomics(withdrawal);
    const commission = computeCommission({
      tier,
      volumeUsdc,
      grossFeeUsdc,
      corridorCostUsdc,
    });

    // Below a hundredth of a cent there is nothing worth recording, and the row would cost
    // more to carry forever than it is worth.
    if (commission.amountUsdc < 0.0001) return;

    const round = (n: number) => Number(n.toFixed(6));

    const { error } = await supabaseAdmin.from('referral_earnings').upsert(
      {
        referrer_id: referee.referred_by,
        referee_id: referee.id,
        withdrawal_id: withdrawal.id,
        volume_usdc: round(commission.volumeUsdc),
        tier: commission.tier,
        tier_rate_percent: commission.tierRatePercent,
        gross_fee_usdc: round(commission.grossFeeUsdc),
        corridor_cost_usdc: round(commission.corridorCostUsdc),
        net_fee_usdc: round(commission.netFeeUsdc),
        uncapped_usdc: round(commission.uncappedUsdc),
        capped: commission.capped,
        amount_usdc: round(commission.amountUsdc),
        status: 'accrued',
      },
      { onConflict: 'withdrawal_id', ignoreDuplicates: true },
    );

    if (error) {
      console.error('[Referrals] could not record earning:', error.message);
      return;
    }

    console.log(
      `[Referrals] accrued ${commission.amountUsdc.toFixed(4)} USDC (${commission.tier}) ` +
        `for ${referee.referred_by} on withdrawal ${withdrawal.id}`,
    );

    // Told immediately, because the feedback loop is the programme. Fire-and-forget: an email
    // that fails must not disturb the ledger entry that earned it.
    void notifyEarning({
      referrerId: referee.referred_by,
      amountUsdc: commission.amountUsdc,
      tier: commission.tier,
    }).catch(() => undefined);
  } catch (err) {
    console.error('[Referrals] accrual failed:', (err as Error).message);
  }
}

/** Email the referrer that they just earned something, with their running balance. */
async function notifyEarning(params: {
  referrerId: string;
  amountUsdc: number;
  tier: string;
}): Promise<void> {
  const { data: referrer } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', params.referrerId)
    .maybeSingle();

  if (!referrer?.email) return;

  const { data: rows } = await supabaseAdmin
    .from('referral_earnings')
    .select('amount_usdc')
    .eq('referrer_id', params.referrerId)
    .eq('status', 'accrued');

  const pending = (rows ?? []).reduce((total, row) => total + (Number(row.amount_usdc) || 0), 0);

  const { sendReferralEarningEmail } = await import('@/lib/email/sendEmail');
  await sendReferralEarningEmail(referrer.email, params.amountUsdc, pending, params.tier);
}

/**
 * Reverse an accrual when the withdrawal behind it fails or is refunded.
 *
 * Only touches rows that are still `accrued`. Once a commission has been paid out on-chain it
 * cannot be taken back, and rewriting a `paid` row to `void` would make the ledger disagree
 * with what actually left the treasury — the balance would look right while the money was
 * gone. A commission paid on a reversed withdrawal is a small loss; a ledger that cannot be
 * reconciled is a much larger one.
 */
export async function voidReferralEarning(params: {
  withdrawalId?: string;
  providerOrderId?: string;
}): Promise<void> {
  try {
    let withdrawalId = params.withdrawalId;

    if (!withdrawalId && params.providerOrderId) {
      const { data } = await supabaseAdmin
        .from('withdrawals')
        .select('id')
        .eq('provider_order_id', params.providerOrderId)
        .maybeSingle();
      withdrawalId = data?.id;
    }
    if (!withdrawalId) return;

    const { error } = await supabaseAdmin
      .from('referral_earnings')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('withdrawal_id', withdrawalId)
      .eq('status', 'accrued');

    if (error) console.error('[Referrals] could not void earning:', error.message);
  } catch (err) {
    console.error('[Referrals] void failed:', (err as Error).message);
  }
}
