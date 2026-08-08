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
import { cookies } from 'next/headers';

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
 * The verified email behind this request, or null.
 *
 * Every failure returns null rather than throwing: a missing cookie, an expired token and a
 * forged one are deliberately indistinguishable, so nothing here tells an attacker which part
 * of their attempt was wrong.
 */
export async function getVerifiedIdentity(
  accessToken?: string,
): Promise<{ email: string; privyUserId: string } | null> {
  try {
    const token = accessToken?.trim() || (await cookies()).get('privy-token')?.value;
    if (!token) return null;

    const claims = await privy.utils().auth().verifyAccessToken(token);
    if (!claims?.user_id) return null;

    const privyUser = await privy.users()._get(claims.user_id);
    const emailAccount = privyUser.linked_accounts.find((a) => a.type === 'email') as
      | { address?: string }
      | undefined;
    const email = emailAccount?.address?.toLowerCase().trim();
    if (!email) return null;

    return { email, privyUserId: claims.user_id };
  } catch {
    // Invalid / expired / forged token, or Privy unreachable. Fail closed.
    return null;
  }
}

/** The signed-in user for this request, or null. Use where absence is a normal outcome. */
export async function getSessionUser(accessToken?: string): Promise<SessionUser | null> {
  const identity = await getVerifiedIdentity(accessToken);
  if (!identity) return null;

  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', identity.email)
    .maybeSingle();

  return { ...identity, userId: data?.id ?? null };
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
