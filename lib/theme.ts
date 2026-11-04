"use client";

/**
 * Light and dark mode.
 *
 * The mode is a `data-theme` attribute on <html>, which the palette in app/globals.css reads.
 * THEME_SCRIPT (lib/theme-script.ts), inlined at the top of <head>, sets it before anything
 * paints and keeps it in step with the device and with other tabs. This module only saves a
 * choice and reads the mode on screen.
 *
 * Anything whose look depends on the mode should style it with `dark:` utilities rather than
 * this hook where it can: CSS is right from the first frame, while a hook only learns the mode
 * after hydration.
 */

import { useSyncExternalStore } from "react";
import { THEME_EVENT, THEME_KEY, type Theme } from "./theme-script";

export type { Theme };

declare global {
  interface Window {
    __sendzzTheme?: (theme: Theme) => void;
  }
}

const current = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** Save a choice and show it. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: the choice lasts this visit */
  }
  if (window.__sendzzTheme) window.__sendzzTheme(theme);
  else {
    // The head script did not run (it failed or was blocked): apply the essentials here.
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.dispatchEvent(new Event(THEME_EVENT));
  }
}

/** Switch to the other mode. The one place the flip is decided. */
export function toggleTheme() {
  setTheme(current() === "dark" ? "light" : "dark");
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/** The mode on screen now. "light" until hydrated; prefer `dark:` styles for anything visible. */
export function useTheme(): Theme {
  return useSyncExternalStore<Theme>(subscribe, current, () => "light");
}
