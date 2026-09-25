/**
 * Minting and looking up referral codes.
 *
 * SERVER ONLY — this imports the Supabase service-role client. What a code LOOKS like lives in
 * code-format.ts, which has no database behind it, because the browser needs to read a `?ref=`
 * off the landing-page URL before any account exists. Importing this module from a client
 * component takes the whole page down; see the header of code-format.ts for why.
 */

import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { normalizeReferralCode, randomReferralCode } from './code-format';

// Re-exported so existing server callers keep one import. The definition lives in
// code-format.ts, which the browser can safely reach.
export { normalizeReferralCode } from './code-format';

/**
 * This user's code, minting one the first time it is asked for.
 *
 * Generated lazily rather than at sign-up: most accounts never open the referrals screen, and
 * a code nobody will share is a row we do not need and a collision we do not need to resolve.
 *
 * Collisions are settled by the unique index, not by checking first. A read-then-write would
 * let two concurrent requests pick the same code and both believe they were fine.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('referral_code')
    .eq('id', userId)
    .maybeSingle();

  if (existing?.referral_code) return existing.referral_code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomReferralCode();
    const { error } = await supabaseAdmin
      .from('users')
      .update({ referral_code: code })
      .eq('id', userId);

    if (!error) return code;

    // 23505 is the unique index rejecting a code that already exists. Anything else is a real
    // failure and retrying it would just produce the same error more slowly.
    if (error.code !== '23505') {
      console.error('[Referrals] could not assign a code:', error.message);
      throw new Error('Could not create your referral code. Please try again.');
    }
  }

  // Five collisions against a 31^8 space means something is wrong with the random source,
  // not that we were unlucky.
  throw new Error('Could not create a unique referral code.');
}

/** The account behind a code, or null. Case-insensitive, matching the unique index. */
export async function findReferrerByCode(code: string): Promise<{ id: string } | null> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;

  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .ilike('referral_code', normalized)
    .maybeSingle();

  return data ?? null;
}
