/**
 * How often one caller may do one thing.
 *
 * Requiring a session ended the anonymous case on every route. It does not bound a patient
 * signed-in caller, and the things worth bounding are things a legitimate account can do:
 * guess a six-digit code, ask us to mail another one, probe whether an address has a wallet,
 * or spend our gas. See migration 060 for the shape of the counter and why it lives in
 * Postgres rather than memory.
 *
 * --- Failing open, deliberately ----------------------------------------------
 *
 * If the limiter itself cannot be reached, the request is ALLOWED. That is the opposite of how
 * the rest of this codebase fails, and the reasoning is specific rather than lazy: a limiter
 * that fails closed turns one unreachable table into a total outage — nobody can sign a
 * transaction, nobody can withdraw — in response to a problem that is not a security incident.
 * The endpoints behind it are all authenticated in their own right, so a brief window without
 * throttling is a degradation, where a brief window without the product is not.
 *
 * It is logged loudly, because a limiter quietly not limiting looks identical to a healthy one.
 */

import { headers } from 'next/headers';

import { supabaseAdmin } from '@/lib/supabase/adminClient';

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts used in the current window, including this one. */
  used: number;
  /** When the window resets. */
  resetAt: Date | null;
  /** Seconds to wait, for a Retry-After header. */
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Distinguishes what is being limited: '2fa:verify', 'read', 'wallet:create'. */
  name: string;
  limit: number;
  windowMs: number;
}

/**
 * Sensible limits per kind of thing, in one place.
 *
 * Numbers chosen so a real person never meets them. Somebody mistyping a code four times in a
 * row is ordinary; somebody trying it twenty times in ten minutes is not a person.
 */
export const RATE_LIMITS = {
  /** Verifying a code. The brute-force surface: 6 digits is 10^6, so attempts must cost. */
  codeVerify: { name: '2fa:verify', limit: 10, windowMs: 15 * 60 * 1000 },

  /** Asking us to email a code. Low, because each one lands in somebody's inbox. */
  codeSend: { name: '2fa:send', limit: 5, windowMs: 60 * 60 * 1000 },

  /** Creating a wallet for a recipient. Each one costs a Privy user and an address. */
  walletCreate: { name: 'wallet:create', limit: 20, windowMs: 60 * 60 * 1000 },

  /** Looking up whether an email has a wallet. The enumeration surface. */
  recipientLookup: { name: 'recipient:lookup', limit: 60, windowMs: 60 * 60 * 1000 },

  /** Chain reads and quotes. Generous — the UI polls some of these legitimately. */
  read: { name: 'read', limit: 120, windowMs: 5 * 60 * 1000 },

  /** Signing with our fee payer. Every call spends real money. */
  sponsor: { name: 'sponsor', limit: 30, windowMs: 10 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The caller's IP, as far as the platform will say.
 *
 * Only ever a fallback for unauthenticated callers, and treated as a weak signal: a forwarded
 * header can be spoofed and NAT puts whole offices behind one address. Where an account id is
 * available it is the better key, because it is the thing an attacker cannot cheaply change.
 */
async function callerIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]!.trim();
    return h.get('x-real-ip') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Spend one attempt. Returns whether it is allowed.
 *
 * `subject` should be an account id wherever one is known. Without it the caller's IP is used,
 * which is weaker but better than nothing on a route that runs before identity is resolved.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  subject?: string | null,
): Promise<RateLimitResult> {
  const who = subject ? `user:${subject}` : `ip:${await callerIp()}`;
  const key = `${rule.name}:${who}`;

  try {
    const { data, error } = await supabaseAdmin.rpc('consume_rate_limit', {
      p_key: key,
      p_limit: rule.limit,
      p_window_ms: rule.windowMs,
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('consume_rate_limit returned nothing');

    const resetAt = row.reset_at ? new Date(row.reset_at) : null;
    return {
      allowed: !!row.allowed,
      used: Number(row.used ?? 0),
      resetAt,
      retryAfterSeconds: resetAt
        ? Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
        : 60,
    };
  } catch (err) {
    // See the module header: allowed, but loudly. A limiter that is quietly not limiting looks
    // exactly like a healthy one, and that is the failure worth being able to find in a log.
    console.error(
      `[RateLimit] NOT ENFORCING ${key} — the limiter is unreachable:`,
      (err as Error).message,
    );
    return { allowed: true, used: 0, resetAt: null, retryAfterSeconds: 0 };
  }
}

/** The 429 to return when a limit is hit, with the header a well-behaved client reads. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many attempts. Please wait a moment and try again.',
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSeconds),
      },
    },
  );
}
