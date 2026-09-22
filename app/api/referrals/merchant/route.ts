/**
 * The Merchant dashboard's data, for the referrer asking about their own network.
 *
 * Identity from the session, and gated on the programme: a retail referrer has no tier, no
 * network rollup and no cash earnings, and serving them an empty version of this screen would
 * read as a broken page rather than a different programme.
 */

import { NextResponse } from 'next/server';

import { requireUserId } from '@/lib/auth/session';
import { merchantDashboard } from '@/lib/referrals/dashboard';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { userId } = await requireUserId();

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('referral_program')
      .eq('id', userId)
      .maybeSingle();

    if ((profile?.referral_program ?? 'retail') !== 'merchant') {
      return NextResponse.json({ error: 'Not a Merchant' }, { status: 403 });
    }

    return NextResponse.json(await merchantDashboard(userId));
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
