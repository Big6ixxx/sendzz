/**
 * Deciding who, if anyone, referred an account — once, at the beginning.
 *
 * Attribution happens on the user's FIRST sign-in and is then frozen. It is frozen in two
 * places on purpose: here, where the code refuses to overwrite an existing value, and in the
 * database, where a trigger raises if the column ever changes (migration 054). The duplication
 * is deliberate. This column decides who gets paid for every future deposit the account makes,
 * so "the application is careful" is not a strong enough guarantee — one careless UPDATE on a
 * user row in some future endpoint would be enough to redirect somebody else's earnings.
 *
 * Failures here are swallowed. A referral that does not land costs one commission; an
 * exception thrown on the sign-in path costs the user their account creation. The asymmetry is
 * not close, so every error is logged and none propagate.
 */

import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { findReferrerByCode } from './code';
import { grantSignupWaiver } from './benefits';

/**
 * Record who referred this user, if the claim stands up.
 *
 * Called on first sign-in with whatever code the browser was carrying. Returns true only when
 * an attribution was actually written.
 */
export async function attributeReferral(params: {
  userId: string;
  code: string | null | undefined;
}): Promise<boolean> {
  const { userId, code } = params;
  if (!code) return false;

  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, referred_by, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (!user) return false;

    // Already attributed. Not an error — a returning user's browser still carries the cookie,
    // and the honest answer is that this changes nothing.
    if (user.referred_by) return false;

    const referrer = await findReferrerByCode(code);
    if (!referrer) return false;

    // Referring yourself is the first thing anyone tries. The database rejects it too; this
    // just avoids the round trip and the constraint-violation log line.
    if (referrer.id === userId) return false;

    const { error } = await supabaseAdmin
      .from('users')
      .update({
        referred_by: referrer.id,
        referred_at: new Date().toISOString(),
      })
      .eq('id', userId)
      // Only if it is still unset. Two sign-in requests racing on a fresh account would
      // otherwise both pass the check above and the later one would win — and with the
      // write-once trigger in place, it would fail loudly instead.
      .is('referred_by', null);

    if (error) {
      console.error('[Referrals] attribution failed:', error.message);
      return false;
    }

    // The referee's side of the bargain, granted now so it is already waiting the first time
    // they withdraw. This is what the referrer actually pitches — "your first $200 is
    // fee-free" is a reason to click a link; "so I earn a cut of your money" is not.
    await grantSignupWaiver(userId);

    return true;
  } catch (err) {
    console.error('[Referrals] attribution failed:', (err as Error).message);
    return false;
  }
}
