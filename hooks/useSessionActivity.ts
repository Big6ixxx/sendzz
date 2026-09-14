'use client';

/**
 * Ends a session on this device the moment the server says it is over.
 *
 * Two things end a session: signing this device out from another one, and 24 hours without a
 * transaction initiated here. Both are decided server-side — see lib/auth/session.ts — and this
 * hook exists only to act on that decision promptly and tell the user what happened.
 *
 * ─── Why it checks so often ──────────────────────────────────────────────────
 *
 * Someone revoking a lost phone expects it to be locked out, not locked out eventually. A slow
 * poll meant the revoked device could sit on a dashboard showing balances for minutes — every
 * request it made was already refused, but nothing told the person holding it.
 *
 * So it checks on a short interval AND whenever the app comes back to the foreground, which is
 * the moment that actually matters: a phone is picked up, the tab is focused, the network
 * returns. In practice the screen is gone before it can be read.
 *
 * ─── Why this is still only a convenience ────────────────────────────────────
 *
 * It logs someone out promptly and cleanly. It is not the protection. Someone holding the phone
 * could disable JavaScript or replay the token directly. The real boundary is `getSessionUser`,
 * which refuses any revoked or lapsed session — so a dead session is dead to the API whether or
 * not this ever runs.
 */

import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/** Background cadence. Short enough that a revocation lands quickly even on an idle screen. */
const CHECK_EVERY_MS = 30 * 1000;

/** Ignore a foreground event that arrives right after a check — focus events come in bursts. */
const MIN_GAP_MS = 3 * 1000;

export function useSessionActivity(): void {
  const { authenticated, logout } = usePrivy();
  const lastCheck = useRef(0);
  const endedRef = useRef(false);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    endedRef.current = false;

    const check = async () => {
      // Once is enough: logout() is in flight and re-checking would only stack toasts.
      if (cancelled || endedRef.current) return;
      if (Date.now() - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = Date.now();

      try {
        const res = await fetch('/api/session/status', { cache: 'no-store' });
        if (cancelled || res.ok) return;
        if (res.status !== 401) return;

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
      } catch {
        // Offline or a transient failure is not evidence of expiry; leave the session alone.
      }
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
