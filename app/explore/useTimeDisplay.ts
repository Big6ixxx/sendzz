'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { timeZoneAbbrev, type TimeMode } from './shared';

/** Full IANA timezone list (falls back gracefully if the runtime lacks supportedValuesOf). */
export const ALL_TIMEZONES: string[] = (() => {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof intl.supportedValuesOf === 'function') return intl.supportedValuesOf('timeZone');
  } catch {
    /* ignore */
  }
  return ['UTC'];
})();

// SSR-safe "are we on the client yet?" without an effect — the server can't know the viewer's
// zone, so it renders 'UTC' and re-renders with the real zone after hydration (no mismatch).
const noopSubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function detectLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface TimeDisplay {
  /** Raw selector value: 'relative' | 'local' | an IANA zone. */
  value: string;
  setValue: (v: string) => void;
  /** Derived display mode. */
  mode: TimeMode;
  /** The timezone that absolute timestamps render in. */
  timeZone: string;
  /** Short abbreviation for `timeZone`, e.g. "WAT". */
  abbrev: string;
  /** The viewer's detected local zone (for the "Local — …" option label). */
  localTimeZone: string;
}

/**
 * Owns the unified time-display selector ('relative' | 'local' | <IANA zone>, default
 * 'relative') and keeps relative labels fresh with a 30s tick while relative mode is active.
 */
export function useTimeDisplay(): TimeDisplay {
  const isClient = useIsClient();
  const localTimeZone = isClient ? detectLocalTimeZone() : 'UTC';

  const [value, setValue] = useState('relative');
  const mode: TimeMode = value === 'relative' ? 'relative' : 'absolute';
  const timeZone = value === 'relative' || value === 'local' ? localTimeZone : value;
  const abbrev = timeZoneAbbrev(timeZone);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (mode !== 'relative') return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [mode]);

  return { value, setValue, mode, timeZone, abbrev, localTimeZone };
}
