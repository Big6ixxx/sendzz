/**
 * Admin authorisation — the security boundary for everything under /admin.
 *
 * The rule this module exists to enforce: **the caller's identity is read from their session
 * cookie, never from an argument.** Every admin server action previously took an `adminEmail`
 * parameter and trusted it. Server Actions are POST endpoints that anyone can invoke once they
 * know the action id, so passing a known admin's address was enough to read the entire user
 * table, every transaction, KYC session ids, and raw webhook payloads — without ever signing
 * in. The client-side gate in the admin layout only stops the UI rendering; it does not stop
 * the data being fetched.
 *
 * So authorisation happens here, on the server, in three steps that all have to pass:
 *   1. a valid Privy access token in the `privy-token` cookie  → proves *someone* is signed in
 *   2. that token resolves to a linked email address via Privy → proves *who* they are
 *   3. that email is in `platform_admins` (or ADMIN_EMAILS)    → proves they may be here
 *
 * Server-only by construction: `cookies()` from `next/headers` cannot be reached from a client
 * bundle, so importing this into a client component fails at build time rather than silently
 * shipping the check to the browser.
 */
import { headers } from 'next/headers';

import { getVerifiedIdentity } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export interface AdminSession {
  /** Verified from the session cookie — not supplied by the caller. */
  email: string;
  privyUserId: string;
}

/** Raised when the caller is not a signed-in, approved admin. Deliberately uninformative. */
export class AdminAuthError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'AdminAuthError';
  }
}

/**
 * Resolve the caller from their Privy session. Delegates to the shared verifier in
 * lib/auth/session so admin and user auth can never drift apart on what counts as proof.
 *
 * `accessToken` is an accepted input where an email never is, and the difference is the whole
 * point: a token is verified cryptographically with Privy, so supplying someone else's means
 * actually stealing it. It exists as a fallback because the `privy-token` cookie isn't
 * guaranteed in every deployment, and a cookie-only check would lock every admin out.
 */
async function sessionIdentity(accessToken?: string): Promise<AdminSession | null> {
  return getVerifiedIdentity(accessToken);
}

/** Is this email on the approved list? DB first, env as the fallback for bootstrapping. */
async function isApprovedAdmin(email: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_admins')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (data && !error) return true;
  } catch (err) {
    console.error('[Admin Auth] platform_admins lookup failed, falling back to ENV:', err);
  }

  const envAdmins =
    process.env.ADMIN_EMAILS?.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) ?? [];
  return envAdmins.includes(email);
}

/**
 * Record a rejected attempt to reach admin data.
 *
 * The "Access Restricted" screen has always told people their attempt was logged; until now
 * that wasn't true. `user_id` is left null because the audit table's FK points at auth.users
 * and a rejected caller may not be one — the email and route in the metadata are the signal.
 */
async function logDenial(attemptedEmail: string | null, reason: string): Promise<void> {
  try {
    const h = await headers();
    await supabaseAdmin.from('audit_logs').insert({
      user_id: null,
      action: 'admin_access_denied',
      metadata_json: {
        attempted_email: attemptedEmail,
        reason,
        path: h.get('x-invoke-path') ?? h.get('referer') ?? null,
      },
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: h.get('user-agent') ?? null,
    });
  } catch (err) {
    // Never let audit failure decide access — the denial still stands.
    console.error('[Admin Auth] Failed to record denial:', err);
  }
}

/**
 * The admin session for the current request, or null if the caller isn't an approved admin.
 * Use for UI decisions (rendering the console vs. the restricted screen).
 */
export async function getAdminSession(accessToken?: string): Promise<AdminSession | null> {
  const identity = await sessionIdentity(accessToken);
  if (!identity) return null;
  if (!(await isApprovedAdmin(identity.email))) return null;
  return identity;
}

/**
 * Assert the caller is an approved admin, or throw. Every admin data function must call this
 * FIRST — it is the only thing standing between a stranger and the whole platform's records.
 */
export async function requireAdmin(accessToken?: string): Promise<AdminSession> {
  const identity = await sessionIdentity(accessToken);
  if (!identity) {
    await logDenial(null, 'no_valid_session');
    throw new AdminAuthError();
  }
  if (!(await isApprovedAdmin(identity.email))) {
    await logDenial(identity.email, 'not_an_admin');
    throw new AdminAuthError();
  }
  return identity;
}
