'use client';

/**
 * A one-time, global sign-out.
 *
 * Used once, after the per-device session system ships, so that every user re-authenticates and
 * every live session is one this app actually knows about. Bump `SESSION_EPOCH` to run it again.
 *
 * This is only half of it: calling Privy logout is what makes people sign in again, but a device
 * that never loads the app would be untouched. Migration 050 is the enforced half, and carries
 * the full reasoning — including the one case neither half can reach.
 */

import { usePrivy } from '@privy-io/react-auth';
import { useEffect } from 'react';

/**
 * Bump this to sign everybody out again. The value is only ever compared, never parsed — any
 * change at all triggers the sweep, so a date is used purely because it reads well in a log.
 */
export const SESSION_EPOCH = '2026-09-13';

const STORAGE_KEY = 'sendzz.session.epoch';

export function useSessionEpoch(): void {
  const { authenticated, ready, logout } = usePrivy();

  useEffect(() => {
    if (!ready) return;

    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode, or storage blocked. Without somewhere to record that this ran, signing out
      // would repeat on every load and the user could never stay signed in — so skip entirely.
      return;
    }

    if (seen === SESSION_EPOCH) return;

    // Record BEFORE logging out. If the write succeeded and the logout is interrupted, the worst
    // case is one missed sign-out; if the order were reversed and the write failed, the user
    // would be logged out on every single page load.
    try {
      window.localStorage.setItem(STORAGE_KEY, SESSION_EPOCH);
    } catch {
      return;
    }

    if (!authenticated) return;

    console.info(`[SessionEpoch] Signing out for epoch ${SESSION_EPOCH}.`);
    void logout();
  }, [ready, authenticated, logout]);
}
