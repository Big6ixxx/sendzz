'use client';

/**
 * Ends a session on this device when the server says it is genuinely over, and tells the server
 * when the user is actually here.
 *
 * Two things end a session: signing this device out from another one, and a week in which the
 * user did nothing. Both are decided server-side (see lib/auth/session.ts); this hook reports
 * presence, acts on the verdict, and says what happened.
 *
 * ─── What counts as presence ─────────────────────────────────────────────────
 *
 * A real input event: a tap, a click, a key. Not a poll, and not an open tab.
 *
 * The first version of this counted the status check itself, which meant a phone with Sendzz
 * left open in a background tab renewed its own session forever — it could never expire,
 * because something was always polling. "Seven days of inactivity" has to mean seven days since
 * a human touched the thing, or it means nothing.
 *
 * Mounting counts once: arriving on the page is itself something the user did.
 *
 * ─── Which refusals this acts on ─────────────────────────────────────────────
 *
 * Only `revoked` and `expired` — the two rules the app owns. A third answer,
 * `unauthenticated`, means the access token did not verify, and is deliberately ignored: Privy
 * refreshes tokens in the background, and a woken tab is checked at exactly the moment it still
 * holds the old one. Treating that as a verdict signed people out roughly hourly.
 *
 * ─── Why this is still only a convenience ────────────────────────────────────
 *
 * The real boundary is `getSessionUser`, which refuses any revoked or lapsed session. A dead
 * session is dead to the API whether or not this ever runs.
 */

import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Backstop cadence, for a tab that stays open and focused.
 *
 * Fifteen minutes, not sixty seconds. The old cadence made ~1,440 requests a day per open tab
 * to watch for an event that happens a handful of times a year, and every one of them cost a
 * token verification and two database reads. The moments that actually matter — returning to
 * the tab, coming back online, touching the screen after a while — are handled by events below,
 * so the timer only has to catch a revocation on a tab nobody is touching.
 */
const CHECK_EVERY_MS = 15 * 60 * 1000;

/** Ignore a check request this soon after the last one — focus events arrive in bursts. */
const MIN_GAP_MS = 30 * 1000;

/** After this long without a check, the next interaction triggers one. */
const CHECK_AFTER_IDLE_MS = 5 * 60 * 1000;

/**
 * Consecutive refusals required before signing out.
 *
 * Kept because they absorb a genuine blip, though they were never the fix for the hourly
 * logouts: a stale token stays stale across both checks.
 */
const STRIKES = 2;

/** Deliberate human input. Scroll is excluded — it can be programmatic. */
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

export function useSessionActivity(): void {
  const { authenticated, logout } = usePrivy();
  const lastCheck = useRef(0);
  const strikes = useRef(0);
  const endedRef = useRef(false);
  /** Has the user done something since the last check reported it? */
  const interacted = useRef(true); // arriving on the page counts

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    endedRef.current = false;
    strikes.current = 0;
    interacted.current = true;

    const check = async () => {
      if (cancelled || endedRef.current) return;
      if (Date.now() - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = Date.now();

      // Claimed only when the user actually did something, and cleared as it is sent so the
      // same tap cannot keep a session alive twice.
      const active = interacted.current;
      interacted.current = false;

      let res: Response;
      try {
        res = await fetch(`/api/session/status${active ? '?active=1' : ''}`, {
          cache: 'no-store',
        });
      } catch {
        // Offline, or the request never completed. Not evidence of anything — and the
        // interaction is put back, since it was never reported.
        interacted.current = interacted.current || active;
        return;
      }
      if (cancelled) return;

      if (res.ok) {
        strikes.current = 0;
        return;
      }
      if (res.status !== 401) return;

      const { reason } = (await res.json().catch(() => ({}))) as {
        reason?: 'revoked' | 'expired' | 'unauthenticated';
      };

      // Privy's business, not ours. Its SDK will refresh the token, or end the session itself.
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
          : 'Signed out after a week of inactivity. Please sign in again.',
      );
      void logout();
    };

    const onInteract = () => {
      interacted.current = true;
      // Only worth a round trip if it has been a while. Otherwise the flag simply rides along
      // on whatever check comes next.
      if (Date.now() - lastCheck.current > CHECK_AFTER_IDLE_MS) void check();
    };

    // Returning to the tab is the moment that matters most — it is when a revocation that
    // happened while the device was asleep should surface.
    const onForeground = () => {
      if (document.visibilityState === 'visible') void check();
    };

    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    window.addEventListener('online', onForeground);
    for (const e of INTERACTION_EVENTS) {
      window.addEventListener(e, onInteract, { passive: true });
    }

    void check();

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      window.removeEventListener('online', onForeground);
      for (const e of INTERACTION_EVENTS) window.removeEventListener(e, onInteract);
    };
  }, [authenticated, logout]);
}
