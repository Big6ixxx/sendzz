/**
 * The numbers a Merchant needs to treat this as a revenue stream.
 *
 * The retail referrals page answers "how much have I made?". Somebody being asked to put a
 * community behind Sendzz needs more than that: which month was good, which of their people
 * are actually transacting, and how far they are from the next rate. Those are the questions
 * that decide whether they push again this month.
 *
 * --- On what a Merchant may see about their network -------------------------
 *
 * Per-referee figures are deliberately coarse and never identifying. A Merchant sees that
 * somebody joined and roughly what band their activity falls in — not their email, not their
 * balance, not the amount or destination of any individual withdrawal. Those are the
 * referee's business, and the referee did not agree to be reported on when they clicked a
 * link. The aggregate is enough to run a programme; the detail would only be enough to
 * pressure people.
 */

import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { tierForVolume, tierVolumeRatePercent, type ReferralTier } from './tiers';

export interface MonthlyPoint {
  /** `YYYY-MM`. */
  month: string;
  volumeUsdc: number;
  earnedUsdc: number;
}

export interface NetworkMember {
  /** Stable but meaningless outside this list — never the referee's id or email. */
  ref: string;
  joinedAt: string;
  /** Coarse on purpose. See the note on privacy in the module header. */
  activity: 'none' | 'starting' | 'active' | 'high';
  /** How much they have earned the Merchant, which IS the Merchant's own business. */
  earnedUsdc: number;
}

export interface MerchantDashboard {
  tier: ReferralTier;
  tierRatePercent: number;
  monthlyVolumeUsdc: number;
  lifetimeVolumeUsdc: number;
  lifetimeEarnedUsdc: number;
  /** Most recent month last, for charting. */
  history: MonthlyPoint[];
  network: NetworkMember[];
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Coarse activity band for one referee.
 *
 * Bands rather than a figure, because a figure is a disclosure. Thresholds are deliberately
 * wide — the useful signal to a Merchant is "this person is transacting" versus "this person
 * signed up and vanished", which is what tells them where to spend their next conversation.
 */
function activityBand(volumeUsdc: number): NetworkMember['activity'] {
  if (volumeUsdc <= 0) return 'none';
  if (volumeUsdc < 250) return 'starting';
  if (volumeUsdc < 2_500) return 'active';
  return 'high';
}

/** Everything the Merchant screen renders, in one pass. */
export async function merchantDashboard(
  referrerId: string,
  monthsOfHistory = 6,
): Promise<MerchantDashboard> {
  const { data: referees } = await supabaseAdmin
    .from('users')
    .select('id, created_at')
    .eq('referred_by', referrerId)
    .order('created_at', { ascending: false });

  const refereeIds = (referees ?? []).map((r) => r.id);

  // Completed withdrawals only. Money still in flight has not earned anything and must not
  // be shown as though it has — a figure that goes down later is worse than one that arrives
  // late.
  const { data: withdrawals } = refereeIds.length
    ? await supabaseAdmin
        .from('withdrawals')
        .select('user_id, amount_usdc, created_at')
        .in('user_id', refereeIds)
        .eq('status', 'completed')
    : { data: [] };

  const { data: earnings } = await supabaseAdmin
    .from('referral_earnings')
    .select('referee_id, amount_usdc, created_at, status')
    .eq('referrer_id', referrerId)
    .neq('status', 'void');

  // ── Roll up by month ──────────────────────────────────────────────────────
  const byMonth = new Map<string, MonthlyPoint>();
  const touch = (month: string) => {
    const existing = byMonth.get(month);
    if (existing) return existing;
    const created = { month, volumeUsdc: 0, earnedUsdc: 0 };
    byMonth.set(month, created);
    return created;
  };

  for (const row of withdrawals ?? []) {
    touch(monthKey(row.created_at)).volumeUsdc += Number(row.amount_usdc) || 0;
  }
  for (const row of earnings ?? []) {
    touch(monthKey(row.created_at)).earnedUsdc += Number(row.amount_usdc) || 0;
  }

  // The last N months including empty ones, so a quiet month reads as a gap in the chart
  // rather than being skipped and making a two-month lull look like continuous activity.
  const history: MonthlyPoint[] = [];
  const now = new Date();
  for (let back = monthsOfHistory - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const key = date.toISOString().slice(0, 7);
    const point = byMonth.get(key);
    history.push({
      month: key,
      volumeUsdc: Number((point?.volumeUsdc ?? 0).toFixed(2)),
      earnedUsdc: Number((point?.earnedUsdc ?? 0).toFixed(6)),
    });
  }

  // ── Per-referee, anonymised ───────────────────────────────────────────────
  const volumeByReferee = new Map<string, number>();
  for (const row of withdrawals ?? []) {
    volumeByReferee.set(
      row.user_id,
      (volumeByReferee.get(row.user_id) ?? 0) + (Number(row.amount_usdc) || 0),
    );
  }

  const earnedByReferee = new Map<string, number>();
  for (const row of earnings ?? []) {
    if (!row.referee_id) continue;
    earnedByReferee.set(
      row.referee_id,
      (earnedByReferee.get(row.referee_id) ?? 0) + (Number(row.amount_usdc) || 0),
    );
  }

  const network: NetworkMember[] = (referees ?? []).map((referee, index) => ({
    // Positional, not derived from the id: a hash would still be a stable handle for the
    // same person across sessions, and there is no reason a Merchant needs one.
    ref: `#${index + 1}`,
    joinedAt: referee.created_at,
    activity: activityBand(volumeByReferee.get(referee.id) ?? 0),
    earnedUsdc: Number((earnedByReferee.get(referee.id) ?? 0).toFixed(6)),
  }));

  const thisMonth = history[history.length - 1]?.volumeUsdc ?? 0;
  const tier = tierForVolume(thisMonth);

  return {
    tier,
    tierRatePercent: tierVolumeRatePercent(tier),
    monthlyVolumeUsdc: thisMonth,
    lifetimeVolumeUsdc: Number(
      [...volumeByReferee.values()].reduce((a, b) => a + b, 0).toFixed(2),
    ),
    lifetimeEarnedUsdc: Number(
      (earnings ?? []).reduce((a, r) => a + (Number(r.amount_usdc) || 0), 0).toFixed(6),
    ),
    history,
    network,
  };
}
