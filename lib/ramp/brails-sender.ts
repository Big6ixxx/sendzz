import 'server-only';

/**
 * The sender Brails asks for on some corridors (the CFA franc countries, DR Congo, Ethiopia,
 * The Gambia, Guinea, Morocco): a first and last name and a country.
 *
 * The sender is our user, and the only name we can stand behind is the one Didit verified from
 * their ID document — so the sender exists only for users who passed KYC. Everyone else gets
 * null, and those corridors go to the next provider before any order is made.
 */
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { getVerifiedIdentity } from '@/lib/kyc/didit-client';
import { alpha2FromAlpha3 } from './iso-country';

export interface BrailsSender {
  /** "First Last", the space-separated form Brails requires for individuals. */
  accountName: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

/**
 * A found sender, per user, for ten minutes. The form asks on every change of destination, then
 * the order and the payout ask again, and each is a Didit request; a verified identity does not
 * change in that time. "None" is not cached: for an unverified user it costs no Didit request
 * (their KYC row says so first), and caching it would keep someone gated after they verify.
 */
const cache = new Map<string, { at: number; sender: BrailsSender }>();
const CACHE_MS = 10 * 60_000;

/** The verified sender for this user, or null when they have none Brails can use. */
export async function brailsSenderFor(user: { email?: string; id?: string }): Promise<BrailsSender | null> {
  const key = user.id ?? user.email?.trim().toLowerCase() ?? '';
  const hit = cache.get(key);
  if (key && hit && Date.now() - hit.at < CACHE_MS) return hit.sender;
  const sender = await lookUpSender(user);
  if (key && sender) cache.set(key, { at: Date.now(), sender });
  return sender;
}

async function lookUpSender(user: { email?: string; id?: string }): Promise<BrailsSender | null> {
  let userId = user.id;
  if (!userId && user.email) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', user.email.trim().toLowerCase())
      .maybeSingle();
    userId = data?.id;
  }
  if (!userId) return null;

  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('didit_session_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (kyc?.status !== 'approved' || !kyc.didit_session_id) return null;

  const identity = await getVerifiedIdentity(kyc.didit_session_id);
  if (!identity) return null;
  const country = alpha2FromAlpha3(identity.issuingState);
  if (!country) return null;
  return { accountName: `${identity.firstName} ${identity.lastName}`.replace(/\s+/g, ' '), country };
}
