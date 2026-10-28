import { afterEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from './ttl-cache';

afterEach(() => vi.useRealTimers());

describe('TtlCache', () => {
  it('forgets an entry once its time is up', () => {
    vi.useFakeTimers();
    const cache = new TtlCache<string>(1000, 10);
    cache.set('a', 'x');
    expect(cache.get('a')).toBe('x');
    vi.advanceTimersByTime(1000);
    expect(cache.get('a')).toBeUndefined();
  });

  it('never holds more than its cap, dropping the oldest first', () => {
    const cache = new TtlCache<number>(60_000, 3);
    for (let i = 0; i < 5; i++) cache.set(`k${i}`, i);
    expect(['k0', 'k1', 'k2', 'k3', 'k4'].map((k) => cache.get(k))).toEqual([undefined, undefined, 2, 3, 4]);
  });
});
