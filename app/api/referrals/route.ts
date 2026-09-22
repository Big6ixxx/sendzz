/**
 * The referrer's own view: their code, what they have earned, and what has been paid.
 *
 * Identity comes from the session, never from a query parameter. An endpoint shaped like
 * `?email=` would be an open API for reading anyone's earnings and, worse, for discovering
 * anyone's referral code.
 *
 * Requesting this page is what mints a code — see ensureReferralCode on why lazily.
 */

import { NextResponse } from 'next/server';

import { requireUserId } from '@/lib/auth/session';
import { ensureReferralCode } from '@/lib/referrals/code';
import { monthlyNetworkVolume } from '@/lib/referrals/accrue';
import {
  benefitBalances,
  milestoneCreditUsdc,
  milestoneVolumeUsdc,
} from '@/lib/referrals/benefits';
import {
  TIERS,
  tierDefinition,
  tierForVolume,
  tierVolumeRatePercent,
} from '@/lib/referrals/tiers';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { userId } = await requireUserId();

    const code = await ensureReferralCode(userId);

    const [{ data: earnings }, { data: payouts }, { count: referredCount }] = await Promise.all([
      supabaseAdmin
        .from('referral_earnings')
        .select('id, amount_usdc, status, created_at')
        .eq('referrer_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('referral_payouts')
        .select('id, amount_usdc, status, provider_tx_id, tx_hash, chain, created_at')
        .eq('referrer_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('referred_by', userId),
    ]);

    const rows = earnings ?? [];
    const sum = (status: string) =>
      rows
        .filter((row) => row.status === status)
        .reduce((total, row) => total + (Number(row.amount_usdc) || 0), 0);

    // The tier is derived from this month's network volume rather than stored, so it cannot
    // go stale. Each earning row already carries the tier it was PAID at, which is the figure
    // that matters historically; this one is "where you stand right now".
    const [monthlyVolumeUsdc, balances, profile] = await Promise.all([
      monthlyNetworkVolume(userId),
      benefitBalances(userId),
      supabaseAdmin.from('users').select('referral_program').eq('id', userId).maybeSingle(),
    ]);
    const program = (profile.data?.referral_program ?? 'retail') as 'retail' | 'scout';
    const tier = tierForVolume(monthlyVolumeUsdc);
    const nextTier = TIERS[TIERS.indexOf(tier) + 1];

    return NextResponse.json({
      code,
      referredCount: referredCount ?? 0,
      // What is owed but not yet sent, and what has been.
      pendingUsdc: Number(sum('accrued').toFixed(6)),
      paidUsdc: Number(sum('paid').toFixed(6)),
      // The floor a balance has to reach before a sweep sends it. Shown so "why haven't I
      // been paid?" has an answer on the page rather than in a support conversation.
      minimumPayoutUsdc: Number(process.env.REFERRAL_MIN_PAYOUT_USDC) || 5,
      program,
      // Retail referrers are paid in fee credits, not cash, so their balance is a different
      // number in a different unit. Sent alongside rather than instead of, because a user can
      // hold a fee-free allowance as a REFEREE while earning as a referrer.
      feeCreditUsdc: balances.feeCreditUsdc,
      waiverVolumeUsdc: balances.waiverVolumeUsdc,
      milestoneVolumeUsdc: milestoneVolumeUsdc(),
      milestoneCreditUsdc: milestoneCreditUsdc(),
      tier,
      // What they actually earn, as a percentage of what their network withdraws. Quoted this
      // way rather than as a share of our fee because it is the number that stays put — see
      // lib/referrals/tiers.ts.
      tierRatePercent: tierVolumeRatePercent(tier),
      monthlyVolumeUsdc: Number(monthlyVolumeUsdc.toFixed(2)),
      nextTier: nextTier
        ? {
            name: nextTier,
            ratePercent: tierVolumeRatePercent(nextTier),
            volumeNeededUsdc: Number(
              Math.max(
                0,
                tierDefinition(nextTier).minMonthlyVolumeUsdc - monthlyVolumeUsdc,
              ).toFixed(2),
            ),
          }
        : null,
      payouts: (payouts ?? []).map((payout) => ({
        id: payout.id,
        amountUsdc: Number(payout.amount_usdc),
        status: payout.status,
        // Only the on-chain hash is exposed. It stays null until the transfer is mined, and
        // the page links to an explorer only when it is present.
        txHash: payout.tx_hash,
        chain: payout.chain,
        createdAt: payout.created_at,
      })),
    });
  } catch {
    // Unauthenticated, or no account row yet. Deliberately indistinguishable.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
