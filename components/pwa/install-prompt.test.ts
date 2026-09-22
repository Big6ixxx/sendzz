import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The dismissal rule behind the landing-page install prompt.
 *
 * Tests the real module the component uses, not a copy of it. An earlier version restated the
 * logic here and the window length drifted the moment one side was edited — the test went on
 * passing while asserting a number the component no longer had.
 *
 * What is worth pinning: when the prompt may reappear, and that it survives a browser where
 * localStorage throws. A private window is not an edge case — it is a normal way to view a
 * landing page, and a crash there costs the whole visit.
 */

import {
  DISMISS_DAYS,
  DISMISSED_KEY as KEY,
  dismissedRecently,
  rememberDismissal,
} from './install-dismissal';

/** A localStorage that works. */
function workingStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

/** A localStorage that throws on every access, as a locked-down browser does. */
function hostileStorage() {
  return {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };
}

function useStorage(impl: object) {
  vi.stubGlobal('window', { localStorage: impl });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('install prompt dismissal', () => {
  it('shows on a first visit', () => {
    useStorage(workingStorage());
    expect(dismissedRecently()).toBe(false);
  });

  it('stays hidden right after being dismissed', () => {
    useStorage(workingStorage());
    rememberDismissal();
    expect(dismissedRecently()).toBe(true);
  });

  it('stays hidden a day later', () => {
    useStorage(workingStorage());
    rememberDismissal();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(dismissedRecently()).toBe(true);
  });

  it('asks again once the window has passed', () => {
    useStorage(workingStorage());
    rememberDismissal();
    vi.advanceTimersByTime((DISMISS_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(dismissedRecently()).toBe(false);
  });

  it('does not crash when localStorage throws, and shows the prompt', () => {
    // A private window. Failing open is right: the visitor sees the offer, and dismissing it
    // still works for the session — it just is not remembered.
    useStorage(hostileStorage());
    expect(() => dismissedRecently()).not.toThrow();
    expect(dismissedRecently()).toBe(false);
    expect(() => rememberDismissal()).not.toThrow();
  });

  it('treats a corrupt stored value as not dismissed', () => {
    const storage = workingStorage();
    useStorage(storage);
    storage.setItem(KEY, 'not-a-number');
    // Number('not-a-number') is NaN, and every comparison with NaN is false — so this must
    // land on "show it", not on a thrown error or a permanently hidden prompt.
    expect(dismissedRecently()).toBe(false);
  });
});
