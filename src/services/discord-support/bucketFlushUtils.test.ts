import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hourKeyNow, createBucketManager } from './bucketFlushUtils';

describe('hourKeyNow', () => {
  it('returns UTC hour key in YYYY-MM-DD-HH format', () => {
    const key = hourKeyNow();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}$/);
  });

  it('uses UTC values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T08:30:00Z'));
    expect(hourKeyNow()).toBe('2026-01-15-08');
    vi.useRealTimers();
  });

  it('zero-pads single digit month and day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T02:00:00Z'));
    expect(hourKeyNow()).toBe('2026-03-05-02');
    vi.useRealTimers();
  });
});

describe('createBucketManager', () => {
  type TestBucket = { hourKey: string; count: number };
  const makeBucket = (hourKey: string): TestBucket => ({ hourKey, count: 0 });
  let flushFn: (guildId: string, bucket: TestBucket) => Promise<void>;

  beforeEach(() => {
    flushFn = vi.fn<(guildId: string, bucket: TestBucket) => Promise<void>>().mockResolvedValue(undefined);
  });

  it('getOrCreate creates a new bucket for a guild', () => {
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn, maxBuckets: 10 });
    const bucket = mgr.getOrCreate('g1');
    expect(bucket).toBeDefined();
    expect(bucket.hourKey).toBe(hourKeyNow());
    expect(bucket.count).toBe(0);
  });

  it('getOrCreate returns the same bucket on repeated calls', () => {
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn, maxBuckets: 10 });
    const a = mgr.getOrCreate('g1');
    a.count = 5;
    const b = mgr.getOrCreate('g1');
    expect(b.count).toBe(5);
  });

  it('flush calls flushFn for a guild with a bucket', async () => {
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn, maxBuckets: 10 });
    mgr.getOrCreate('g1');
    await mgr.flush('g1');
    expect(flushFn).toHaveBeenCalledWith('g1', expect.objectContaining({ hourKey: hourKeyNow() }));
  });

  it('flush is a no-op for unknown guildId', async () => {
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn, maxBuckets: 10 });
    await mgr.flush('nonexistent');
    expect(flushFn).not.toHaveBeenCalled();
  });

  it('flush guard prevents concurrent flushes for the same guild', async () => {
    let resolveFlush: (() => void) | undefined;
    const blockingFlush = vi.fn<(guildId: string, bucket: TestBucket) => Promise<void>>(
      () => new Promise<void>((resolve) => { resolveFlush = resolve; }),
    );
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn: blockingFlush, maxBuckets: 10 });
    mgr.getOrCreate('g1');

    const first = mgr.flush('g1');
    const second = mgr.flush('g1');
    expect(blockingFlush).toHaveBeenCalledTimes(1);

    resolveFlush!();
    await first;
    await second;
  });

  it('flushAll flushes all existing buckets', async () => {
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn, maxBuckets: 10 });
    mgr.getOrCreate('g1');
    mgr.getOrCreate('g2');
    await mgr.flushAll();
    expect(flushFn).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest bucket when exceeding maxBuckets', () => {
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn, maxBuckets: 2 });
    mgr.getOrCreate('g1');
    mgr.getOrCreate('g2');
    mgr.getOrCreate('g3');
    expect(mgr.__buckets.has('g1')).toBe(false);
    expect(mgr.__buckets.has('g2')).toBe(true);
    expect(mgr.__buckets.has('g3')).toBe(true);
  });

  it('getOrCreate triggers flush when hour key changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T08:00:00Z'));
    const mgr = createBucketManager<TestBucket>({ createBucket: makeBucket, flushFn, maxBuckets: 10 });
    mgr.getOrCreate('g1');

    vi.setSystemTime(new Date('2026-01-15T09:00:00Z'));
    const bucket = mgr.getOrCreate('g1');
    expect(bucket.hourKey).toBe('2026-01-15-09');
    expect(flushFn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
