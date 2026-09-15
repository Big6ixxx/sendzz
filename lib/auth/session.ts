/**
 * Caller identity — the single place the server decides *who is asking*.
 *
 * The rule, for user data exactly as for admin data: **identity comes from the session, never
 * from an argument.** Every `'use server'` export is a POST endpoint that anyone can invoke
 * once they know its action id, so an action shaped like `getUserActivities(email)` is an open
 * API for reading any account's history by typing their address. Arguments say what to do;
 * only the session says who you are.
 *
 * Two credentials are accepted, and both are verified with Privy before we believe them:
 *   • the `privy-token` cookie, when the browser sends one
 *   • an access token passed explicitly, for deployments/flows where the cookie isn't present
 * An email or a user id is never accepted as proof of anything.
 *
 * Server-only by construction: `cookies()` from `next/headers` cannot be reached from a client
 * bundle, so importing this into a client component fails at build time.
 */
import { PrivyClient } from '@privy-io/node';
import { cookies, headers } from 'next/headers';

import { supabaseAdmin } from '@/lib/supabase/adminClient';

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  appSecret: process.env.PRIVY_APP_SECRET || '',
});

/** A verified caller. `userId` is the Supabase row id, absent if they have no record yet. */
export interface SessionUser {
  email: string;
  privyUserId: string;
  userId: string | null;
}

/** Raised when the caller isn't authenticated, or is reaching for someone else's data. */
export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * How long a session survives with no deliberate interaction.
 *
 * 24 hours: long enough that a daily user is never interrupted, short enough that a phone lost
 * overnight is locked before most people have replaced it.
 */
export const SESSION_IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * The verified email behind this request, or null.
 *
 * Every failure returns null rather than throwing: a missing cookie, an expired token and a
 * forged one are deliberately indistinguishable, so nothing here tells an attacker which part
 * of their attempt was wrong.
 */
/**
 * Emails already resolved from Privy, so a signed-in user does not cost a network round trip on
 * every single request.
 *
 * The token itself is verified locally every time — that is the actual authentication, and it is
 * never cached. This only remembers the email behind a user id, which is the one thing the JWT
 * does not carry and the only reason Privy was being called at all.
 *
 * It is also what keeps a Privy outage from logging everybody out: a stale entry is served when
 * the lookup fails, because someone holding a validly signed token IS authenticated whether or
 * not a third party is reachable at that instant.
 */
const emailCache = new Map<string, { email: string; at: number }>();
const EMAIL_FRESH_MS = 10 * 60 * 1000;

async function emailForPrivyUser(privyUserId: string): Promise<string | null> {
  const hit = emailCache.get(privyUserId);
  if (hit && Date.now() - hit.at < EMAIL_FRESH_MS) return hit.email;

  try {
    const privyUser = await privy.users()._get(privyUserId);
    const account = privyUser.linked_accounts.find((a) => a.type === 'email') as
      | { address?: string }
      | undefined;
    const email = account?.address?.toLowerCase().trim();
    if (!email) return hit?.email ?? null;

    emailCache.set(privyUserId, { email, at: Date.now() });
    return email;
  } catch (err) {
    // Privy unreachable, slow, or rate-limiting. A previously known email is far better than
    // treating a valid token as unauthenticated — that reads as "signed out" to the user.
    if (hit) {
      console.warn('[Session] Privy lookup failed; using cached email for this request.');
      return hit.email;
    }
    console.error('[Session] Privy lookup failed with nothing cached:', (err as Error).message);
    return null;
  }
}

export async function getVerifiedIdentity(
  accessToken?: string,
): Promise<{ email: string; privyUserId: string; sessionId: string } | null> {
  try {
    const token = accessToken?.trim() || (await cookies()).get('privy-token')?.value;
    if (!token) return null;

    // Local signature check against Privy's verification key — no network, and the only thing
    // that decides whether this caller is authenticated.
    const claims = await privy.utils().auth().verifyAccessToken(token);
    if (!claims?.user_id) return null;

    const email = await emailForPrivyUser(claims.user_id);
    if (!email) return null;

    // `session_id` identifies the DEVICE session, not the account. It lives inside the signed
    // JWT, so it cannot be invented or borrowed from another device.
    return { email, privyUserId: claims.user_id, sessionId: claims.session_id };
  } catch {
    // Invalid, expired or forged token. Fail closed.
    return null;
  }
}

/** The signed-in user for this request, or null. */
async function getSessionUser(accessToken?: string): Promise<SessionUser | null> {
  const identity = await getVerifiedIdentity(accessToken);
  if (!identity) return null;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', identity.email)
    .maybeSingle();

  // No account row yet (mid sign-up). Nothing to gate on; provisioning creates it.
  if (!user?.id) return { ...identity, userId: null };

  const session = await resolveSession(user.id, identity.sessionId);
  if (!session) return null;

  return { ...identity, userId: user.id };
}

/**
 * Find this device's session row, creating it on first sight, and decide whether it may proceed.
 *
 * Returns null when the session is revoked or has gone 24 hours without the user INITIATING a
 * transaction from it. Both are checked here so every requireUser() call site inherits them.
 *
 * The clock is per-device on purpose. An account-level one would be refreshed by the owner's
 * laptop and would keep a thief's phone session alive — the exact case this exists to close.
 */
async function resolveSession(
  userId: string,
  sessionId: string,
): Promise<{ ok: true } | null> {
  // Read through the view, which reports `idle_seconds` measured by Postgres. The elapsed time
  // therefore comes from the same clock that wrote `last_active_at`; this process only decides
  // what the limit is. See migration 048.
  const { data: existing, error: readError } = await supabaseAdmin
    .from('user_sessions_state')
    .select('id, idle_seconds, revoked_at')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (readError) {
    // We cannot tell whether this session is revoked or idle. Refusing would lock every user out
    // of the product over a database blip, so the request proceeds — but it is logged loudly,
    // because a missing `user_sessions` table (migration 048 not applied) arrives here on EVERY
    // request and would otherwise be indistinguishable from a healthy deployment: the app would
    // work perfectly while enforcing no idle limit and no revocation at all.
    console.error(
      '[Session] user_sessions unreadable — idle limit and revocation are NOT being enforced:',
      readError.message,
    );
    return { ok: true };
  }

  if (!existing) {
    // First request from this device. Signing in starts a full window — without that, anyone
    // whose last transaction was over a day ago would be refused the moment they signed in.
    const h = await headers();
    const { error: insertError } = await supabaseAdmin.from('user_sessions').insert({
      user_id: userId,
      session_id: sessionId,
      user_agent: h.get('user-agent')?.slice(0, 400) ?? null,
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });

    // 23505 is a unique violation: a concurrent request from this same device won the race and
    // created the row first. That is the intended outcome, not a failure worth reporting.
    if (insertError && insertError.code !== '23505') {
      console.error('[Session] could not record this device session:', insertError.message);
    }
    return { ok: true };
  }

  // Signed out from another device. Checked on every request so revocation is immediate rather
  // than waiting for a token to expire on its own.
  if (existing.revoked_at) return null;

  if ((existing.idle_seconds ?? 0) * 1000 > SESSION_IDLE_LIMIT_MS) return null;

  return { ok: true };
}

/**
 * Extend one already-verified device session.
 *
 * For callers that have just verified the identity themselves: `getVerifiedIdentity` makes a
 * network call to Privy, and doing it twice on a payment path costs a round trip for an answer
 * already in hand. Takes a session id rather than a token so it cannot be used to extend a
 * session nobody proved they hold — the id has to have come out of a verified token.
 *
 * Never throws. A session clock that fails must not fail the payment that was already made.
 */
export async function touchSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  try {
    // Stamped by Postgres, not by this process — the same clock that measures idle time, so a
    // transaction always extends the window by exactly what the user is told it does.
    const { error } = await supabaseAdmin.rpc('touch_user_session', { p_session_id: sessionId });
    if (error) console.error('[Session] touchSession failed:', error.message);
  } catch (err) {
    console.error('[Session] touchSession failed:', err);
  }
}

/**
 * Record that this device initiated a transaction, extending only ITS session.
 *
 * Call after a withdrawal, bridge, sent transfer or fiat on-ramp succeeds. Receiving does not
 * count: an incoming transfer or on-chain deposit arrives whether or not the account holder is
 * near their phone, so treating it as presence would let a stranger's payment extend a thief's
 * session.
 *
 * Never throws, for the same reason `touchSession` doesn't.
 */
export async function markSessionTransacted(accessToken?: string): Promise<void> {
  try {
    const identity = await getVerifiedIdentity(accessToken);
    await touchSession(identity?.sessionId);
  } catch (err) {
    console.error('[Session] markSessionTransacted failed:', err);
  }
}

/**
 * How long a dead session is kept before being deleted.
 *
 * Every sign-in mints a new Privy session, so this table gains a row per sign-in rather than per
 * device — left alone it only ever grows. Rows are kept well past expiry so "which devices had
 * access, and when did that end?" stays answerable after an incident, then removed.
 */
const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete sessions that have been dead long enough to stop being evidence.
 *
 * Only ever removes rows that are already refused by `resolveSession` — revoked, or idle well
 * beyond the limit — so this can never shorten a live session. Returns the number deleted.
 */
export async function pruneDeadSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - SESSION_RETENTION_MS).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from('user_sessions')
      .delete()
      // Dead either way: revoked long ago, or untouched for far longer than a session may live.
      .or(`revoked_at.lt.${cutoff},last_active_at.lt.${cutoff}`)
      .select('id');

    if (error) {
      console.error('[Session] pruneDeadSessions failed:', error.message);
      return 0;
    }
    return data?.length ?? 0;
  } catch (err) {
    console.error('[Session] pruneDeadSessions failed:', (err as Error).message);
    return 0;
  }
}

/**
 * Assert someone is signed in, and return them. Call this FIRST in any action that reads or
 * writes user data — it is what makes the data theirs rather than anyone's.
 */
export async function requireUser(accessToken?: string): Promise<SessionUser> {
  const user = await getSessionUser(accessToken);
  if (!user) throw new AuthError();
  return user;
}

/**
 * Assert the caller is signed in AND has a provisioned account row.
 * For actions that must write against a `users.id` foreign key.
 */
export async function requireUserId(
  accessToken?: string,
): Promise<SessionUser & { userId: string }> {
  const user = await requireUser(accessToken);
  if (!user.userId) throw new AuthError();
  return user as SessionUser & { userId: string };
}
