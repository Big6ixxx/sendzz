"use client";

/**
 * Installing Sendzz as an app, on the user's schedule rather than the browser's.
 *
 * Chrome fires `beforeinstallprompt` once, early, and shows its own banner. If nobody handles
 * that event the banner appears at whatever moment the browser chose — usually the first visit,
 * before anyone knows what Sendzz is — and once dismissed it does not come back. Calling
 * `preventDefault()` suppresses it and hands us the event to fire later, which is what lets an
 * Install button exist at all.
 *
 * The listener is registered at module load, not inside a component. The event fires early in
 * the page's life and does not repeat, so a listener attached when a settings screen mounts
 * would miss it entirely.
 *
 * iOS is a separate case: Safari implements none of this. There is no event to capture and no
 * way to trigger the install, only the Share sheet. So on iOS the button explains rather than
 * installs, which is the honest version of the same offer.
 */

import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** The captured event, held for whenever the user asks. Null once used or never offered. */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface Snapshot {
  canPrompt: boolean;
  isInstalled: boolean;
  isIos: boolean;
}

/**
 * The install state, as an external store.
 *
 * `useSyncExternalStore` rather than effects and setState: every input here lives outside React
 * — a browser event that fires once, a media query, a user-agent string — and reading them into
 * state on mount means rendering once with the wrong answer and again with the right one.
 *
 * The snapshot object is cached and only replaced when a field actually changes. Returning a
 * fresh object from `getSnapshot` would re-render forever, since React compares by identity.
 */
let snapshot: Snapshot = { canPrompt: false, isInstalled: false, isIos: false };
const SERVER_SNAPSHOT: Snapshot = { canPrompt: false, isInstalled: false, isIos: false };
const subscribers = new Set<() => void>();

/** Already running as an installed app? Standalone on Chrome, `navigator.standalone` on iOS. */
function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, and is told apart by having a touch screen.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

function refresh() {
  const next: Snapshot = {
    canPrompt: deferredPrompt !== null,
    isInstalled: detectInstalled(),
    isIos: detectIos(),
  };
  if (
    next.canPrompt === snapshot.canPrompt &&
    next.isInstalled === snapshot.isInstalled &&
    next.isIos === snapshot.isIos
  ) {
    return;
  }
  snapshot = next;
  subscribers.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppresses the browser's own banner. Without this the prompt appears unbidden and, once
    // dismissed, is gone for good — the exact behaviour this replaces.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    refresh();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    refresh();
  });
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  // Someone may install from the browser's own menu while the page is open.
  const media = window.matchMedia?.("(display-mode: standalone)");
  media?.addEventListener?.("change", refresh);
  // First real read happens here, after mount, where touching browser APIs is safe.
  refresh();
  return () => {
    subscribers.delete(onChange);
    media?.removeEventListener?.("change", refresh);
  };
}

export interface PwaInstallState {
  /** Running as an installed app already — nothing to offer. */
  isInstalled: boolean;
  /** A captured prompt is ready, so `install()` will show the real dialog. */
  canPrompt: boolean;
  /** iOS: no API exists, so the UI has to explain the Share sheet instead. */
  needsManualSteps: boolean;
  /** Fires the browser's install dialog. Resolves true if the user accepted. */
  install: () => Promise<boolean>;
}

export function usePwaInstall(): PwaInstallState {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    const event = deferredPrompt;
    // A captured prompt can only be used once. Clearing first means a double tap cannot fire
    // it twice, which browsers reject anyway.
    deferredPrompt = null;
    refresh();

    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") refresh();
      return outcome === "accepted";
    } catch {
      return false;
    }
  };

  return {
    isInstalled: state.isInstalled,
    canPrompt: !state.isInstalled && state.canPrompt,
    needsManualSteps: !state.isInstalled && state.isIos,
    install,
  };
}
