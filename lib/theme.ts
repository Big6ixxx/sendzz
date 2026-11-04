"use client";

/**
 * Light and dark mode.
 *
 * The mode is a `data-theme` attribute on <html>, which the palette in app/globals.css reads.
 * It is set by THEME_SCRIPT, inlined at the top of <head>, before anything paints, so a person
 * who chose dark never sees a light frame first. Their choice is kept in localStorage; with no
 * choice saved, the device's own setting decides, and keeps deciding as it changes.
 */

import { useSyncExternalStore } from "react";
import { THEME_BAR as BAR, THEME_KEY as KEY } from "./theme-script";

export type { Theme } from "./theme-script";
import type { Theme } from "./theme-script";

const EVENT = "sendzz-theme";

function saved(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  // Every colour changes at once rather than each easing on its own transition.
  root.setAttribute("data-theme-switching", "");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[theme]);
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
  window.dispatchEvent(new Event(EVENT));
}

/** Save a choice and show it. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked: the choice lasts this visit */
  }
  apply(theme);
}

function subscribe(onChange: () => void) {
  // With nothing saved, follow the device as it switches between light and dark.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (!saved()) apply(media.matches ? "dark" : "light");
  };
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) apply(e.newValue);
  };
  media.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onChange);
  return () => {
    media.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onChange);
  };
}

/** The mode on screen now, and a way to change it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    () => "light",
  );
  return [theme, setTheme];
}
