import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_CACHE_DIR = path.resolve(__dirname, '../../.local-cache-test');

// Set env before importing module
process.env.LOCAL_CACHE_DIR = TEST_CACHE_DIR;

const { readLocalCache, writeLocalCache, deleteLocalCache, localCacheSize } = await import('./localStateCache');

describe('localStateCache', () => {
  beforeEach(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  it('returns null for missing keys', () => {
    expect(readLocalCache('nonexistent')).toBeNull();
  });

  it('writes and reads a value', () => {
    writeLocalCache('test-key', { hello: 'world' });
    const result = readLocalCache<{ hello: string }>('test-key');
    expect(result).toEqual({ hello: 'world' });
  });

  it('respects TTL expiration', () => {
    writeLocalCache('ttl-key', 'value', 1); // 1ms TTL
    // Small delay to ensure expiration
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }
    expect(readLocalCache('ttl-key')).toBeNull();
  });

  it('deletes a key', () => {
    writeLocalCache('del-key', 42);
    expect(readLocalCache('del-key')).toBe(42);
    deleteLocalCache('del-key');
    expect(readLocalCache('del-key')).toBeNull();
  });

  it('reports cache size', () => {
    writeLocalCache('a', 1);
    writeLocalCache('b', 2);
    expect(localCacheSize()).toBe(2);
  });

  it('sanitizes filenames (no path traversal)', () => {
    writeLocalCache('../../../etc/passwd', 'test');
    // Value should be stored safely (filename sanitized)
    expect(readLocalCache('../../../etc/passwd')).toBe('test');
    // Verify no file was created outside the cache dir
    expect(existsSync(path.resolve(TEST_CACHE_DIR, '..', '..', '..', 'etc', 'passwd'))).toBe(false);
  });
});
