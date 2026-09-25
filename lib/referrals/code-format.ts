/**
 * The shape of a referral code, with no database behind it.
 *
 * Split out from code.ts for one structural reason: the BROWSER needs this. A referral link is
 * read off the URL on the landing page and tidied up there, long before any account exists to
 * look up — and code.ts imports the Supabase service-role client, which must never reach a
 * client bundle.
 *
 * Importing across that line does not merely leak a module. `SUPABASE_SERVICE_ROLE_KEY` has no
 * NEXT_PUBLIC prefix, so in the browser it resolves to an empty string and `createClient`
 * throws at module evaluation — taking down the whole landing page for everyone, signed in or
 * not. That is exactly what happened, and this file is the fix: pure formatting here, anything
 * that talks to the database in code.ts.
 *
 * The rules themselves follow from where a code actually travels. It is read aloud, retyped
 * from a screenshot, and pasted out of a WhatsApp message with a stray space on the end:
 *
 *   * No characters that look like other characters. 0/O and 1/I/L are the classic ones, and a
 *     referral that silently fails to attribute is worse than one that fails loudly — the
 *     referrer never finds out, and blames us for not paying.
 *   * Compared case-insensitively, because nobody preserves case when retyping.
 *   * Short enough to say out loud. Eight characters from this alphabet is ~28 bits, which is
 *     ample when the only thing guessing a code buys you is crediting somebody else.
 */

/** No O, 0, I, 1 or L. See above — these are the pairs people get wrong. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

/** Tidy up whatever the user pasted. Returns null when nothing usable is left. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 4 || cleaned.length > 16) return null;
  return cleaned;
}

/**
 * A fresh code. Uses Web Crypto, which exists in both runtimes — Node has exposed
 * `crypto.getRandomValues` globally since 19, so this needs no import either side.
 */
export function randomReferralCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
