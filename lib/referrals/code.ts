/**
 * The code a referrer hands out.
 *
 * It is read aloud, retyped from a screenshot, and pasted out of a WhatsApp message with a
 * stray space on the end. Everything here follows from that:
 *
 *   * No characters that look like other characters. 0/O and 1/I/L are the classic ones, and
 *     a referral that silently fails to attribute is worse than one that fails loudly — the
 *     referrer never finds out, and blames us for not paying.
 *   * Compared case-insensitively, because nobody preserves case when retyping.
 *   * Short enough to say out loud. Eight characters from this alphabet is ~28 bits, which is
 *     ample when the only thing guessing a code buys you is crediting somebody else.
 */

import { supabaseAdmin } from '@/lib/supabase/adminClient';

/** No O, 0, I, 1 or L. See above — these are the pairs people get wrong. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Tidy up whatever the user pasted. Returns null when nothing usable is left. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 4 || cleaned.length > 16) return null;
  return cleaned;
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

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
    const code = randomCode();
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
