/**
 * Track 1: what a referral is worth to the two people involved.
 *
 *   The referee gets their first $200 of withdrawals fee-free. That is the hook the referrer
 *   actually pitches — "use my code and your first $200 costs you nothing" is a reason to
 *   click a link, where "use my code so I earn a cut of your money" is not. It costs Sendzz no
 *   cash: we are waiving our own margin, not paying anyone.
 *
 *   The referrer gets $2.00 of fee credit for each person they bring who withdraws $100 or
 *   more. Also not cash — it is spent against their own future fees. A retail user who sends
 *   money home twice a month does not care about a 25-cent revenue share; they care about
 *   their next transfer being free.
 *
 * Both are measured and spent through one signed ledger, so a balance is always the sum of a
 * history somebody can read rather than a counter that can drift away from it.
 *
 * --- Units ------------------------------------------------------------------
 *
 * The two are NOT in the same unit and are never summed together:
 *
 *   waiver_volume  is USDC of withdrawal volume that carries no fee. The promise is "$200
 *                  fee-free", and what that saves depends on the corridor — the promise
 *                  should not move because somebody withdraws to a pricier one.
 *   fee_credit     is USDC of fee written off. It is spent against a fee, so it is denominated
 *                  in one.
 */

import { supabaseAdmin } from '@/lib/supabase/adminClient';
import {
  applyBenefits,
  type AppliedBenefits,
  type BenefitBalances,
} from './benefit-math';

/** Volume the referee may withdraw with no fee at all. */
export function signupWaiverVolumeUsdc(): number {
  const raw = Number(process.env.REFERRAL_SIGNUP_WAIVER_USDC);
  return Number.isFinite(raw) && raw >= 0 ? raw : 200;
}

/** What a retail referrer earns when a referee reaches the milestone. */
export function milestoneCreditUsdc(): number {
  const raw = Number(process.env.REFERRAL_MILESTONE_CREDIT_USDC);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2;
}

/** Withdrawal volume a referee must reach for their referrer to earn the credit. */
export function milestoneVolumeUsdc(): number {
  const raw = Number(process.env.REFERRAL_MILESTONE_VOLUME_USDC);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

export type BenefitKind = 'waiver_volume' | 'fee_credit';

/**
 * What is left of one kind of benefit.
 *
 * The sum of active rows, never a stored total. A counter maintained alongside the history is
 * a counter that eventually disagrees with it, and the disagreement surfaces as a user being
 * charged for something they were told was free.
 */
export async function benefitBalance(userId: string, kind: BenefitKind): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('referral_benefits')
    .select('delta_usdc')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('status', 'active');

  if (error) {
    console.error('[Referrals] could not read benefit balance:', error.message);
    // Zero, not "unknown". A balance we cannot read must not waive a fee we then never
    // collected — the safe failure is charging normally and the user asking why.
    return 0;
  }

  const total = (data ?? []).reduce((sum, row) => sum + (Number(row.delta_usdc) || 0), 0);
  // Floating-point dust from repeated addition should never present as a fraction of a cent
  // of credit, and must never go negative however the rows fell.
  return Math.max(0, Number(total.toFixed(6)));
}

/**
 * Write a grant, at most once.
 *
 * `dedupeKey` is what makes "at most once" true. A milestone is crossed once per referee, but
 * the check runs on every withdrawal they make and a provider webhook can redeliver any of
 * them — without the key, one referee could mint the credit repeatedly. The unique index
 * settles it in the database rather than in a read-then-write that two requests can both pass.
 */
async function grant(params: {
  userId: string;
  kind: BenefitKind;
  amountUsdc: number;
  source: string;
  dedupeKey: string;
  refereeId?: string;
}): Promise<boolean> {
  if (!(params.amountUsdc > 0)) return false;

  const { error } = await supabaseAdmin.from('referral_benefits').insert({
    user_id: params.userId,
    kind: params.kind,
    delta_usdc: params.amountUsdc,
    source: params.source,
    dedupe_key: params.dedupeKey,
    referee_id: params.refereeId ?? null,
  });

  // 23505 is the unique key rejecting a grant that already happened. That is the mechanism
  // working, not a failure.
  if (error && error.code !== '23505') {
    console.error('[Referrals] could not grant benefit:', error.message);
    return false;
  }
  return !error;
}

/**
 * Give a newly referred user their fee-free allowance.
 *
 * Called from attribution, so it lands the moment a referral is recorded and is waiting the
 * first time they withdraw. Never throws — attribution runs on the sign-in path.
 */
export async function grantSignupWaiver(userId: string): Promise<void> {
  try {
    await grant({
      userId,
      kind: 'waiver_volume',
      amountUsdc: signupWaiverVolumeUsdc(),
      source: 'signup_waiver',
      dedupeKey: `signup_waiver:${userId}`,
    });
  } catch (err) {
    console.error('[Referrals] signup waiver failed:', (err as Error).message);
  }
}

/**
 * Credit a retail referrer once a referee has withdrawn enough to qualify.
 *
 * Cumulative, not per withdrawal: someone who withdraws $40 three times has moved $120 and
 * has earned their referrer the credit just as surely as one $120 withdrawal would.
 */
export async function grantMilestoneCredit(params: {
  referrerId: string;
  refereeId: string;
}): Promise<void> {
  try {
    const { data: rows } = await supabaseAdmin
      .from('withdrawals')
      .select('amount_usdc')
      .eq('user_id', params.refereeId)
      .eq('status', 'completed');

    const lifetime = (rows ?? []).reduce((sum, r) => sum + (Number(r.amount_usdc) || 0), 0);
    if (lifetime < milestoneVolumeUsdc()) return;

    const granted = await grant({
      userId: params.referrerId,
      kind: 'fee_credit',
      amountUsdc: milestoneCreditUsdc(),
      source: 'referee_milestone',
      // One per referee, ever. The key is what stops a second withdrawal from the same
      // person minting a second credit.
      dedupeKey: `referee_milestone:${params.refereeId}`,
      refereeId: params.refereeId,
    });

    if (granted) {
      console.log(
        `[Referrals] milestone credit ${milestoneCreditUsdc()} USDC to ${params.referrerId} ` +
          `for referee ${params.refereeId}`,
      );
    }
  } catch (err) {
    console.error('[Referrals] milestone credit failed:', (err as Error).message);
  }
}

/** Both balances in one read, for the caller that needs to price something. */
export async function benefitBalances(userId: string): Promise<BenefitBalances> {
  const [waiverVolumeUsdc, feeCreditUsdc] = await Promise.all([
    benefitBalance(userId, 'waiver_volume'),
    benefitBalance(userId, 'fee_credit'),
  ]);
  return { waiverVolumeUsdc, feeCreditUsdc };
}

/**
 * Price a withdrawal's fee with the user's benefits applied.
 *
 * The arithmetic lives in benefit-math.ts, shared with the browser, so the figure quoted on
 * the withdrawal screen and the figure charged here cannot drift apart.
 *
 * Reads only. Spending happens in `spendBenefits`, once the order it is priced for exists.
 */
export async function resolveWithdrawalFee(params: {
  userId: string;
  volumeUsdc: number;
  feePercent: number;
}): Promise<AppliedBenefits> {
  return applyBenefits({
    volumeUsdc: params.volumeUsdc,
    feePercent: params.feePercent,
    balances: await benefitBalances(params.userId),
  });
}

/**
 * Write the spends for a withdrawal that has just been created.
 *
 * Spent at ORDER CREATION rather than on completion, because the discounted fee is baked into
 * the order at that moment — the user has already been quoted it. Leaving the balance intact
 * until settlement would let a second withdrawal, started before the first finished, be
 * quoted against the same allowance and spend it twice.
 *
 * The cost of this ordering is that a failed withdrawal has consumed a benefit it did not use,
 * which `releaseBenefits` returns. That is recoverable; double-spending is not.
 */
export async function spendBenefits(params: {
  userId: string;
  withdrawalId: string;
  waivedVolumeUsdc: number;
  creditAppliedUsdc: number;
}): Promise<void> {
  const rows = [];

  if (params.waivedVolumeUsdc > 0) {
    rows.push({
      user_id: params.userId,
      kind: 'waiver_volume' as const,
      delta_usdc: -params.waivedVolumeUsdc,
      withdrawal_id: params.withdrawalId,
      source: 'withdrawal',
    });
  }
  if (params.creditAppliedUsdc > 0) {
    rows.push({
      user_id: params.userId,
      kind: 'fee_credit' as const,
      delta_usdc: -params.creditAppliedUsdc,
      withdrawal_id: params.withdrawalId,
      source: 'withdrawal',
    });
  }
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from('referral_benefits').insert(rows);
  if (error) console.error('[Referrals] could not spend benefits:', error.message);
}

/**
 * Return what a failed withdrawal spent.
 *
 * Voids the spend rows rather than deleting them, so the history still shows that the benefit
 * was taken and given back — which is the answer when somebody asks why their allowance moved
 * and then moved again.
 */
export async function releaseBenefits(withdrawalId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('referral_benefits')
      .update({ status: 'void' })
      .eq('withdrawal_id', withdrawalId)
      .eq('source', 'withdrawal')
      .eq('status', 'active');

    if (error) console.error('[Referrals] could not release benefits:', error.message);
  } catch (err) {
    console.error('[Referrals] release failed:', (err as Error).message);
  }
}

/**
 * Release by the PROVIDER's order id, which is all a payout webhook has in hand.
 *
 * A thin resolver rather than a second implementation — the release logic stays in one place,
 * so a change to what "released" means cannot apply to one caller and not the other.
 */
export async function releaseBenefitsForOrder(providerOrderId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('withdrawals')
      .select('id')
      .eq('provider_order_id', providerOrderId)
      .maybeSingle();

    if (data?.id) await releaseBenefits(data.id);
  } catch (err) {
    console.error('[Referrals] release by order failed:', (err as Error).message);
  }
}
