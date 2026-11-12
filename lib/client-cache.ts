/**
 * A few answers remembered on this device, so the dashboard can paint at once on the next
 * visit and refresh in the background, instead of showing a spinner while it asks again.
 *
 * Only what is safe to show before the network answers and is replaced as soon as it does:
 * the smart account address (fixed for a wallet, but costly to derive) and the last balance.
 * Never anything a decision is made on: sending and withdrawing always use live figures.
 *
 * Keyed per signed-in user, and cleared on sign out, so the next person on a shared device
 * never sees the previous one's numbers.
 */

const PREFIX = 'sendzz:cache:';

export function readCache<T>(owner: string | undefined, name: string, maxAgeMs: number): T | undefined {
  if (!owner || typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${owner}:${name}`);
    if (!raw) return undefined;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    return Date.now() - at <= maxAgeMs ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeCache(owner: string | undefined, name: string, value: unknown): void {
  if (!owner || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${PREFIX}${owner}:${name}`, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Full or blocked storage: the cache is only a head start.
  }
}

/** Forget everything remembered here, for every user. Called on sign out. */
export function clearClientCache(): void {
  clearLocalStorageByPrefix(PREFIX);
}

/** Remove every localStorage entry whose key starts with `prefix`. Never throws. */
export function clearLocalStorageByPrefix(prefix: string): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing that can be read can be cleared.
  }
}
