/**
 * In-memory, per-process TTL cache (M2-T4a (a), D-025 (3)). Nothing is
 * written to a table or a file, so no product catalog is persisted and the
 * ODbL share-alike question (R-4) stays untouched. Bounded: past
 * `maxEntries` the oldest entry is evicted first.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { readonly value: V; readonly expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("cache size must be a positive integer");
    }
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
