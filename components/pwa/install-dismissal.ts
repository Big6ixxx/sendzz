/**
 * When the landing-page install prompt is allowed to reappear.
 *
 * Its own module so the component and its test share ONE definition. They previously each held
 * a copy of the window length, which drifted the moment one was edited — the test kept passing
 * while asserting a number the component no longer used.
 */

/** How long "not now" lasts. Long enough to mean it; short enough to ask a returning visitor. */
export const DISMISS_DAYS = 10;

export const DISMISSED_KEY = 'sendzz:install-prompt-dismissed-until';

/**
 * Has the user dismissed this recently?
 *
 * Every access is guarded. localStorage throws in a private window and can be blocked outright,
 * and a prompt that crashes the landing page is far worse than one shown twice. Failing open is
 * deliberate: the visitor sees the offer, and dismissing still works for the session.
 */
export function dismissedRecently(): boolean {
  try {
    const until = window.localStorage.getItem(DISMISSED_KEY);
    // Number('junk') is NaN and every NaN comparison is false, so a corrupt value lands on
    // "show it" rather than hiding the prompt forever.
    return !!until && Date.now() < Number(until);
  } catch {
    return false;
  }
}

export function rememberDismissal(): void {
  try {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(DISMISSED_KEY, String(until));
  } catch {
    // Dismissed for this session only. Still dismissed; just not remembered.
  }
}
