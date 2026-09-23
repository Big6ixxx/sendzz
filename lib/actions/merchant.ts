'use server';

/**
 * Applying to the Merchant track, and deciding who gets on it.
 *
 * The Merchant track pays real cash out of the treasury where the retail track only discounts
 * our own margin, so joining it is a decision somebody makes rather than a threshold somebody
 * trips. See migration 058 for why volume alone is the wrong signal in both directions.
 *
 * Identity always comes from the session, on both sides. An applicant cannot submit on
 * somebody else's behalf, and an approval is an admin action verified by `requireAdmin` —
 * which is the actual boundary, not the fact that the button lives under /admin.
 */

import { requireAdmin } from '@/lib/admin/auth';
import { requireUserId } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export interface MerchantApplication {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  organisation: string | null;
  audience: string | null;
  expectedMonthlyVolumeUsdc: number | null;
  notes: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** This user's most recent application, or null if they have never applied. */
export async function getMyMerchantApplication(): Promise<MerchantApplication | null> {
  try {
    const { userId } = await requireUserId();

    const { data } = await supabaseAdmin
      .from('merchant_applications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    return {
      id: data.id,
      status: data.status,
      organisation: data.organisation,
      audience: data.audience,
      expectedMonthlyVolumeUsdc: data.expected_monthly_volume_usdc,
      notes: data.notes,
      decisionNote: data.decision_note,
      createdAt: data.created_at,
      decidedAt: data.decided_at,
    };
  } catch {
    return null;
  }
}

/**
 * Submit an application.
 *
 * The partial unique index refuses a second one while a pending or approved application
 * exists, so a double-submitted form is a no-op rather than two entries in the queue. A
 * rejected applicant can apply again — somebody turned down in March may have a great deal
 * more to show by June, and a permanent block would be the wrong answer to "not yet".
 */
export async function applyForMerchant(input: {
  organisation?: string;
  audience?: string;
  expectedMonthlyVolumeUsdc?: number;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { userId } = await requireUserId();

    const trim = (value?: string) => value?.trim().slice(0, 2000) || null;

    const { error } = await supabaseAdmin.from('merchant_applications').insert({
      user_id: userId,
      organisation: trim(input.organisation),
      audience: trim(input.audience),
      expected_monthly_volume_usdc:
        Number.isFinite(input.expectedMonthlyVolumeUsdc) &&
        (input.expectedMonthlyVolumeUsdc ?? 0) >= 0
          ? input.expectedMonthlyVolumeUsdc
          : null,
      notes: trim(input.notes),
    });

    if (error) {
      // 23505 is the index refusing a duplicate while one is open. That is the mechanism
      // working, and the honest thing to tell the user is that they already applied.
      if (error.code === '23505') {
        return { ok: false, error: 'You already have an application with us.' };
      }
      console.error('[Merchant] application failed:', error.message);
      return { ok: false, error: 'Could not send your application. Please try again.' };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Please sign in and try again.' };
  }
}

export interface PendingMerchantApplication extends MerchantApplication {
  userEmail: string;
  /** How much their network has withdrawn this month — the number the decision turns on. */
  monthlyNetworkVolumeUsdc: number;
  refereeCount: number;
}

/** The review queue, oldest first. Admin only. */
export async function getPendingMerchantApplications(
  accessToken?: string,
): Promise<PendingMerchantApplication[]> {
  await requireAdmin(accessToken);

  const { data: rows, error } = await supabaseAdmin
    .from('merchant_applications')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Merchant] could not read queue:', error.message);
    return [];
  }

  const { monthlyNetworkVolume } = await import('@/lib/referrals/accrue');

  return Promise.all(
    (rows ?? []).map(async (row) => {
      const [{ data: user }, { count }] = await Promise.all([
        supabaseAdmin.from('users').select('email').eq('id', row.user_id).maybeSingle(),
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('referred_by', row.user_id),
      ]);

      return {
        id: row.id,
        status: row.status,
        organisation: row.organisation,
        audience: row.audience,
        expectedMonthlyVolumeUsdc: row.expected_monthly_volume_usdc,
        notes: row.notes,
        decisionNote: row.decision_note,
        createdAt: row.created_at,
        decidedAt: row.decided_at,
        userEmail: user?.email ?? 'unknown',
        // Their claim is one input; this is the other, and it is the one we can verify.
        monthlyNetworkVolumeUsdc: Number(
          (await monthlyNetworkVolume(row.user_id)).toFixed(2),
        ),
        refereeCount: count ?? 0,
      };
    }),
  );
}

/**
 * Approve or reject an application.
 *
 * Approval flips `users.referral_program`, which is what actually changes how the referrer
 * earns — the application row is the record of WHY, kept afterwards rather than consumed,
 * because that is the question asked when a payout is queried months later.
 *
 * The programme flip happens BEFORE the application is marked approved. If the order were
 * reversed and the process died in between, the queue would show a decided application
 * against a referrer still on the retail track, and nothing would ever retry it — an
 * approval that silently did nothing. This way the failure is a still-pending row, which is
 * visible and simply gets decided again.
 */
export async function decideMerchantApplication(params: {
  applicationId: string;
  approve: boolean;
  decisionNote?: string;
  accessToken?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin(params.accessToken);

  const { data: application } = await supabaseAdmin
    .from('merchant_applications')
    .select('id, user_id, status')
    .eq('id', params.applicationId)
    .maybeSingle();

  if (!application) return { ok: false, error: 'That application no longer exists.' };
  if (application.status !== 'pending') {
    return { ok: false, error: 'That application has already been decided.' };
  }

  if (params.approve) {
    const { error: programError } = await supabaseAdmin
      .from('users')
      .update({ referral_program: 'merchant' })
      .eq('id', application.user_id);

    if (programError) {
      console.error('[Merchant] could not switch programme:', programError.message);
      return { ok: false, error: 'Could not move them onto the Merchant track.' };
    }
  }

  const { error } = await supabaseAdmin
    .from('merchant_applications')
    .update({
      status: params.approve ? 'approved' : 'rejected',
      decision_note: params.decisionNote?.trim().slice(0, 2000) || null,
      decided_by: admin.email,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', application.id)
    // Only if still pending, so two admins clicking at once produce one decision.
    .eq('status', 'pending');

  if (error) {
    console.error('[Merchant] could not record decision:', error.message);
    return { ok: false, error: 'Could not record the decision.' };
  }

  return { ok: true };
}
