export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number; createdAt: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = Math.max(10, Math.trunc(maxEntries));
  }

  get(key: string): T | null {
    const row = this.store.get(key);
    if (!row) {
      return null;
    }

    if (Date.now() >= row.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return row.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    const ttl = Math.max(1, Math.trunc(ttlMs));
    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + ttl,
      createdAt: now,
    });

    if (this.store.size > this.maxEntries) {
      this.evictOldest(Math.max(1, this.store.size - this.maxEntries));
    }
  }

  size(): number {
    return this.store.size;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  pruneExpired(): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, row] of this.store.entries()) {
      if (now >= row.expiresAt) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private evictOldest(count: number): void {
    const rows = [...this.store.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, count);

    for (const [key] of rows) {
      this.store.delete(key);
    }
  }
}
