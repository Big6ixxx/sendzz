'use client';

/**
 * Ends a session on this device when the server says it is genuinely over.
 *
 * Two things end a session: signing this device out from another one, and 24 hours without a
 * transaction initiated here. Both are decided server-side — see lib/auth/session.ts — and this
 * hook exists to act on that decision promptly and tell the user what happened.
 *
 * ─── Which refusals this acts on ─────────────────────────────────────────────
 *
 * Only `revoked` and `expired` — the two rules the app itself owns. A third answer,
 * `unauthenticated`, means the access token did not verify, and it is deliberately ignored.
 *
 * That one caused the bug this file keeps being rewritten for. Privy's access tokens are
 * short-lived and its SDK refreshes them in the background; this hook checks on tab focus,
 * which is exactly when a woken tab still holds the previous token. The route used to report
 * that as `expired` — indistinguishable from the 24-hour rule — so the hook called logout on
 * sessions that were hours from any limit. Sessions were being ended roughly hourly.
 *
 * Adding a second strike was an earlier attempt at the same problem. It helped but could not
 * fix it: a stale token stays stale across both checks, so two strikes were reached just as
 * reliably as one. The strikes are kept because they still absorb genuine blips, but the real
 * fix is refusing to treat someone else's expiry as our verdict.
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

      const { reason } = (await res.json().catch(() => ({}))) as {
        reason?: 'revoked' | 'expired' | 'unauthenticated';
      };

      // The token did not verify. That is Privy's business, not ours — its SDK refreshes
      // tokens in the background, and this check runs on tab focus, which is precisely when a
      // woken tab is still holding the old one. Treating it as a verdict is what signed people
      // out within hours of a 24-hour limit. If the session really is finished, Privy ends it
      // and `authenticated` goes false on its own; until then the server keeps refusing API
      // calls regardless, so nothing is at risk in waiting.
      if (reason === 'unauthenticated') {
        strikes.current = 0;
        return;
      }

      strikes.current += 1;
      if (strikes.current < STRIKES) return;

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
