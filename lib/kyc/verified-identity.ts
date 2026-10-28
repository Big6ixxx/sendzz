import 'server-only';

/**
 * The identity Didit verified for one of our users, read from their approved KYC session.
 *
 * Shared by every provider that needs the customer's own details on an order — the Brails
 * sender, the Paycrest on-ramp customer — so all of them stand on the same verified document.
 */
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { TtlCache } from '@/lib/cache/ttl-cache';
import { depositIdentityGap, namesMatch } from '@/lib/ramp/onramp-kyc';
import {
  getSessionState,
  getVerifiedIdentity,
  newerSessions,
  type DiditVerifiedIdentity,
  type NewerSession,
} from './didit-client';

/**
 * A session's identity, for five minutes. The deposit form asks on open and on every change of
 * currency, then the order asks again, and each is a Didit request for a document that does not
 * change. Keyed by session, so a re-verification is read fresh the moment it is on the record.
 * Only a found identity is kept: "none" can be a session read a moment before its approval, and
 * keeping it would hold a just-approved user out of deposits.
 */
const cache = new TtlCache<DiditVerifiedIdentity>(5 * 60_000, 500);

async function identityOfSession(sessionId: string): Promise<DiditVerifiedIdentity | null> {
  const hit = cache.get(sessionId);
  if (hit) return hit;
  const identity = await getVerifiedIdentity(sessionId);
  if (identity) cache.set(sessionId, identity);
  return identity;
}

/**
 * The user's KYC record and, when approved, the identity behind it: one read of the record for
 * a caller that needs both. `identity` is null when the user is not approved, or their approved
 * session carries no usable identity. Throws when Didit cannot be asked, so a caller can tell
 * "not verified" from "could not check".
 */
export async function verifiedRecordOf(user: { id?: string; email?: string }): Promise<{
  userId: string | null;
  status: string | null;
  sessionId: string | null;
  identity: DiditVerifiedIdentity | null;
}> {
  let userId = user.id;
  if (!userId && user.email) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', user.email.trim().toLowerCase())
      .maybeSingle();
    userId = data?.id;
  }
  if (!userId) return { userId: null, status: null, sessionId: null, identity: null };

  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('didit_session_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  const status = kyc?.status ?? null;
  const sessionId = kyc?.didit_session_id ?? null;
  const identity = status === 'approved' && sessionId ? await identityOfSession(sessionId) : null;
  return { userId, status, sessionId, identity };
}

/** The approved identity alone; see verifiedRecordOf. */
export async function verifiedIdentityOf(user: { id?: string; email?: string }): Promise<DiditVerifiedIdentity | null> {
  return (await verifiedRecordOf(user)).identity;
}

/**
 * A re-verification this approved user already has under way, for half a minute: the one
 * waiting for a reviewer, and the newest one started but not finished (whose link can be reused
 * rather than opening, and paying for, another). The deposit form asks on every currency change.
 */
const reverifyCache = new TtlCache<{ inReview: NewerSession | null; open: NewerSession | null }>(30_000, 500);

export async function reverificationUnderWay(
  userId: string,
  recordSessionId: string,
): Promise<{ inReview: NewerSession | null; open: NewerSession | null }> {
  const key = `${userId}:${recordSessionId}`;
  const hit = reverifyCache.get(key);
  if (hit) return hit;
  const sessions = await newerSessions(userId, recordSessionId);
  const state = {
    inReview: sessions.find((s) => s.status === 'In Review') ?? null,
    open: sessions.find((s) => (s.status === 'Not Started' || s.status === 'In Progress') && s.url) ?? null,
  };
  reverifyCache.set(key, state);
  return state;
}

/** Drop what is known of this user's re-verification: a session of theirs just changed. */
export function forgetReverification(userId: string, recordSessionId: string): void {
  reverifyCache.delete(`${userId}:${recordSessionId}`);
}

/**
 * May an approved re-verification take the place of the session on record?
 *
 * Only when it is newer than the session on record (so a late or redelivered event for a
 * session already replaced cannot switch the record back), it is the same person (the name
 * agrees and, where both documents give one, so does the date of birth), and it loses no
 * corridor the old one could serve. Otherwise an approved account could switch to someone
 * else's identity, or a reviewer approving a weaker document would cost the user deposits that
 * worked before.
 *
 * Throws when Didit cannot be asked: "could not check" must not pass as "nothing to compare".
 */
export async function reverificationMayReplace(
  currentSessionId: string,
  newSessionId: string,
): Promise<{ ok: true } | { ok: false; stale?: true; why: string }> {
  const [currentState, newState, current, next] = await Promise.all([
    getSessionState(currentSessionId),
    getSessionState(newSessionId),
    identityOfSession(currentSessionId),
    getVerifiedIdentity(newSessionId),
  ]);
  if (currentState.createdAt && newState.createdAt && Date.parse(newState.createdAt) <= Date.parse(currentState.createdAt)) {
    return { ok: false, stale: true, why: 'it is older than the verification on record' };
  }
  if (!next) return { ok: false, why: 'the new session carries no usable identity' };
  // Nothing on record to compare it with: letting it through unchecked would let anyone's ID
  // onto this account. A person decides instead.
  if (!current) return { ok: false, why: 'your earlier verification could not be compared with it' };

  if (!namesMatch(current.fullName, next.fullName)) return { ok: false, why: 'the name differs from the one on record' };
  if (current.dateOfBirth && next.dateOfBirth && current.dateOfBirth !== next.dateOfBirth) {
    return { ok: false, why: 'the date of birth differs from the one on record' };
  }
  // NGN asks the most of a document (the NIN); every other corridor asks the same as GHS.
  for (const currency of ['NGN', 'GHS']) {
    if (depositIdentityGap(next, currency) && !depositIdentityGap(current, currency)) {
      return { ok: false, why: `the new ID could not be used for ${currency} deposits, which the old one could` };
    }
  }
  return { ok: true };
}
