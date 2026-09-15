'use client';

/**
 * Ends a session on this device when the server says it is genuinely over.
 *
 * Two things end a session: signing this device out from another one, and 24 hours without a
 * transaction initiated here. Both are decided server-side — see lib/auth/session.ts — and this
 * hook exists to act on that decision promptly and tell the user what happened.
 *
 * ─── Why one refusal is not enough ───────────────────────────────────────────
 *
 * An earlier version signed the user out on the first 401 it saw, while checking every 30
 * seconds and on every window focus. That combination was wrong: `getVerifiedIdentity` answers
 * "not authenticated" for a network blip exactly as it does for a forged token, so a single slow
 * moment anywhere between here and Privy ended a perfectly good session. It logged people out
 * repeatedly, within hours, with no session anywhere near its 24-hour limit.
 *
 * So a refusal now has to repeat before it is believed. A real expiry or revocation stays
 * refused — every subsequent check returns 401 too, so the threshold is reached in seconds and
 * the user is still signed out promptly. A blip recovers on the next check and costs nothing.
 *
 * ─── Why this is still only a convenience ────────────────────────────────────
 *
 * It logs someone out promptly and cleanly. It is not the protection. The real boundary is
 * `getSessionUser`, which refuses any revoked or lapsed session — so a dead session is dead to
 * the API whether or not this ever runs.
 */

import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/** Background cadence. Fast enough that a revocation lands quickly on an idle screen. */
const CHECK_EVERY_MS = 60 * 1000;

/** Ignore a foreground event right after a check — focus events arrive in bursts. */
const MIN_GAP_MS = 3 * 1000;

/**
 * Consecutive refusals required before signing out.
 *
 * Two, spaced by at least MIN_GAP_MS. Enough that a single failed round trip is ignored, few
 * enough that a genuine revocation still ends the session within seconds.
 */
const STRIKES = 2;

export function useSessionActivity(): void {
  const { authenticated, logout } = usePrivy();
  const lastCheck = useRef(0);
  const strikes = useRef(0);
  const endedRef = useRef(false);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    endedRef.current = false;
    strikes.current = 0;

    const check = async () => {
      if (cancelled || endedRef.current) return;
      if (Date.now() - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = Date.now();

      let res: Response;
      try {
        res = await fetch('/api/session/status', { cache: 'no-store' });
      } catch {
        // Offline, or the request never completed. Not evidence of anything.
        return;
      }
      if (cancelled) return;

      if (res.ok) {
        strikes.current = 0;
        return;
      }
      // Only a refusal counts. A 500 means the server is unwell, not that the session is over.
      if (res.status !== 401) return;

      strikes.current += 1;
      if (strikes.current < STRIKES) return;

      const { reason } = (await res.json().catch(() => ({}))) as {
        reason?: 'revoked' | 'expired';
      };

      endedRef.current = true;
      toast.info(
        reason === 'revoked'
          ? 'This device was signed out from another device. Please sign in again.'
          : 'Signed out after 24 hours without a transaction. Please sign in again.',
      );
      void logout();
    };

    // The foreground moment is the one that matters — a phone picked up, a tab refocused, the
    // network back. Checking here is what turns "eventually" into "immediately" in practice.
    const onForeground = () => {
      if (document.visibilityState === 'visible') void check();
    };

    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    window.addEventListener('online', onForeground);

    void check();

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      window.removeEventListener('online', onForeground);
    };
  }, [authenticated, logout]);
}
