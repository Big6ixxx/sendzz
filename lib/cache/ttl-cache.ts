/**
 * A small in-memory cache with a time limit and a size cap. Expired entries are dropped on
 * every write and the oldest go first once the cap is reached, so a long-lived server holds
 * at most `max` entries, none older than `ttlMs`.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    const now = Date.now();
    this.entries.delete(key);
    for (const [k, entry] of this.entries) {
      if (now - entry.at >= this.ttlMs || this.entries.size >= this.max) this.entries.delete(k);
    }
    this.entries.set(key, { at: now, value });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}
