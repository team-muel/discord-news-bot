/**
 * Shared bucket-flush infrastructure for Discord event aggregation services.
 *
 * Consolidates hourKeyNow, flush guard, eviction, and shutdown hooks
 * previously duplicated across discordChannelTelemetryService and
 * discordReactionRewardService.
 */

/** Returns the current UTC hour key: YYYY-MM-DD-HH */
export const hourKeyNow = (): string => {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}`;
};

/**
 * Generic bucket manager with flush guard, eviction, and shutdown hooks.
 *
 * @param T — bucket value type (must have an `hourKey: string` field)
 */
export function createBucketManager<T extends { hourKey: string }>(opts: {
  createBucket: (hourKey: string) => T;
  flushFn: (guildId: string, bucket: T) => Promise<void>;
  maxBuckets: number;
}) {
  const buckets = new Map<string, T>();
  const flushing = new Set<string>();
  let hooksInstalled = false;

  const flush = async (guildId: string): Promise<void> => {
    const bucket = buckets.get(guildId);
    if (!bucket) return;
    if (flushing.has(guildId)) return;
    flushing.add(guildId);
    try {
      await opts.flushFn(guildId, bucket);
    } finally {
      flushing.delete(guildId);
    }
  };

  const flushAll = async (): Promise<void> => {
    await Promise.allSettled([...buckets.keys()].map(flush));
  };

  const ensureShutdownHooks = (): void => {
    if (hooksInstalled) return;
    hooksInstalled = true;
    process.on('beforeExit', () => void flushAll());
    process.on('SIGINT', () => void flushAll());
    process.on('SIGTERM', () => void flushAll());
  };

  const getOrCreate = (guildId: string): T => {
    const currentHourKey = hourKeyNow();
    const existing = buckets.get(guildId);
    if (existing && existing.hourKey !== currentHourKey) {
      void flush(guildId);
    }
    if (!existing || existing.hourKey !== currentHourKey) {
      const bucket = opts.createBucket(currentHourKey);
      buckets.set(guildId, bucket);
      if (buckets.size > opts.maxBuckets) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined && oldest !== guildId) buckets.delete(oldest);
      }
      return bucket;
    }
    return existing;
  };

  return { getOrCreate, flush, flushAll, ensureShutdownHooks, __buckets: buckets };
}
