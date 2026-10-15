/**
 * Send a failure the user just saw to the server log (see app/api/client-error).
 *
 * Browser only, fire-and-forget, and never throws: reporting must not be able to break the
 * flow it is reporting on. The same message is sent once per 10 seconds, because one failure
 * is often classified twice (the toast text and the "was it a cancel?" check).
 */
const lastSent = new Map<string, number>();

export function reportClientError(err: unknown, shown: string): void {
  if (typeof window === 'undefined') return;
  try {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const now = Date.now();
    if ((lastSent.get(message) ?? 0) > now - 10_000) return;
    lastSent.set(message, now);

    // The first few frames: minified, but enough to tell one flow's failure from another's.
    const at =
      err instanceof Error
        ? err.stack?.split('\n').slice(1, 4).map((l) => l.trim()).join(' < ')
        : undefined;

    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ message, shown, page: window.location.pathname, at }),
    }).catch(() => undefined);
  } catch {
    // Reporting is best effort.
  }
}
