"use client";

/**
 * Remembering the referral code between the link being clicked and the account existing.
 *
 * Those two moments are far apart. Someone opens `sendzz.app/?ref=ADA7K2M9`, reads the landing
 * page, asks for an email code, switches to their mail app, comes back, and only then does an
 * account exist to attribute. The code has to survive all of that, including the full page
 * reloads that Privy's email flow involves.
 *
 * localStorage rather than a cookie, deliberately: this is only ever read by the browser to
 * hand back on sign-in, so there is no reason to attach it to every request to the server.
 * Every access is wrapped — private windows and blocked site data both throw on access rather
 * than returning empty, and a referral is never worth breaking the landing page over.
 */

import { normalizeReferralCode } from './code';

const STORAGE_KEY = 'sendzz.referral';
/**
 * How long a captured code stays good.
 *
 * Thirty days. Long enough to cover someone who clicks a link, thinks about it, and comes back
 * next week; short enough that a code picked up months ago does not quietly attribute an
 * account somebody found on their own.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredReferral {
  code: string;
  at: number;
}

/**
 * Take `?ref=` out of the current URL and remember it.
 *
 * An existing stored code wins. The first link someone clicked is the one that brought them,
 * and letting a later link overwrite it would mean whoever shared last takes the credit —
 * including, if it were an `?ref=` on our own marketing, us taking it from the referrer.
 */
export function captureReferralFromUrl(): void {
  if (typeof window === 'undefined') return;

  try {
    const code = normalizeReferralCode(
      new URLSearchParams(window.location.search).get('ref'),
    );
    if (!code) return;
    if (readReferral()) return;

    const payload: StoredReferral = { code, at: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private window, blocked storage, malformed URL. Nothing here is worth an error.
  }
}

/** The remembered code, or null when there is none or it has aged out. */
export function readReferral(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredReferral;
    if (!parsed?.code || typeof parsed.at !== 'number') return null;

    if (Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return normalizeReferralCode(parsed.code);
  } catch {
    return null;
  }
}

/**
 * Forget the code once it has been handed over.
 *
 * Called after sign-in, whether or not it was actually honoured — if it was not (self-referral,
 * unknown code, an account that already has a referrer) then it never will be, and leaving it
 * behind only means retrying a decision that has already been made on every future sign-in.
 */
export function clearReferral(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; it ages out on its own.
  }
}
