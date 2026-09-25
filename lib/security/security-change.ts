/**
 * The guard every "weaken a security control" endpoint runs.
 *
 * Removing a passkey, unpairing an authenticator, turning verification off, raising the
 * threshold at which it applies — each of these makes the account easier to drain, and each
 * used to be a POST with an email in the body and nothing else. Anyone could strip anyone's
 * protections, from anywhere, without signing in.
 *
 * Two things have to be true now, and neither is optional:
 *
 *   1. Identity comes from the session. The email in the body is ignored, so there is nothing
 *      to forge.
 *   2. A PIN authorisation is spent, bound to THIS control. Session alone is not enough —
 *      somebody who reaches an unlocked laptop already has a session, and stripping the
 *      factors is exactly what they would do first. The PIN is the thing they do not have.
 *
 * Bound per control on purpose: a token minted to unpair an authenticator cannot be spent
 * removing a passkey, so one PIN entry weakens one thing.
 */

import { requireUser } from '@/lib/auth/session';
import {
  AuthorizationError,
  consumeAuthorization,
} from '@/lib/security/transaction-auth';

/** Mirrors SecurityControl in components/security/SecurityStepUp.tsx. */
export type SecurityControl = 'two_fa' | 'threshold' | 'totp' | 'passkey' | 'pin';

export interface SecurityChangeAuth {
  email: string;
}

/**
 * Authorise a security change, or throw.
 *
 * Returns the caller's verified email, so the route never has to look at the body for it.
 */
export async function authorizeSecurityChange(params: {
  control: SecurityControl;
  authorization: string | undefined | null;
  accessToken?: string;
}): Promise<SecurityChangeAuth> {
  const { email } = await requireUser(params.accessToken);

  await consumeAuthorization({
    token: params.authorization,
    purpose: 'security_change',
    // The same shape the step-up route mints against. Amount is meaningless here and fixed at 0 so the
    // two sides cannot drift.
    payload: { destination: params.control, amount: 0 },
    accessToken: params.accessToken,
  });

  return { email };
}

/** Turn a guard failure into a response, without leaking which check failed. */
export function securityChangeError(err: unknown): { status: number; error: string } {
  if (err instanceof AuthorizationError) {
    return { status: 401, error: err.message };
  }
  // requireUser throws AuthError for an absent or invalid session. Same answer either way.
  return { status: 401, error: 'Please sign in and confirm with your PIN.' };
}
