/**
 * File-based local state cache — inspired by Cline's ~/.cline/data/ pattern.
 *
 * Provides a lightweight disk-backed JSON cache that survives process restarts
 * without requiring Supabase. Used for:
 *  - Sprint pipeline snapshots (offline resilience)
 *  - Action utility scores persistence
 *  - Worker health cache carry-over
 *
 * All reads/writes are best-effort — cache miss falls through to Supabase.
 */

import { LOCAL_CACHE_DIR as LOCAL_CACHE_DIR_CFG, LOCAL_CACHE_MAX_ENTRIES } from '../config';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { atomicWriteFileSync } from '../utils/atomicWrite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../../.local-cache');
const CACHE_DIR = LOCAL_CACHE_DIR_CFG || DEFAULT_CACHE_DIR;
const MAX_ENTRIES = LOCAL_CACHE_MAX_ENTRIES;
const MAX_ENTRY_BYTES = 512 * 1024; // 512 KB per entry

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function safeFilename(key: string): string {
  // Whitelist approach: allow only [a-zA-Z0-9_-.]
  return key.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 120) + '.json';
}

function filePath(key: string): string {
  return path.join(CACHE_DIR, safeFilename(key));
}

/** Read a cached value by key. Returns null on cache miss. */
export function readLocalCache<T = unknown>(key: string): T | null {
  try {
    const fp = filePath(key);
    if (!existsSync(fp)) return null;
    const raw = readFileSync(fp, 'utf-8');
    const envelope = JSON.parse(raw) as { expiresAt?: number; data: T };
    if (envelope.expiresAt && Date.now() > envelope.expiresAt) {
      // Expired — lazy cleanup
      try { unlinkSync(fp); } catch (_e) { /* expired entry cleanup */ }
      return null;
    }
    return envelope.data;
  } catch (err) {
    logger.debug('[LOCAL-CACHE] read failed key=%s: %s', key, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Write a value to the local file cache. */
export function writeLocalCache<T = unknown>(key: string, data: T, ttlMs?: number): void {
  try {
    ensureCacheDir();
    const envelope = {
      storedAt: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
      data,
    };
    const json = JSON.stringify(envelope);
    if (json.length > MAX_ENTRY_BYTES) return; // reject oversized entries silently
    atomicWriteFileSync(filePath(key), json, 'utf-8');
    evictIfNeeded();
  } catch (err) {
    logger.debug('[LOCAL-CACHE] write failed key=%s: %s', key, err instanceof Error ? err.message : String(err));
  }
}

/** Delete a specific cache entry. */
export function deleteLocalCache(key: string): void {
  try {
    const fp = filePath(key);
    if (existsSync(fp)) unlinkSync(fp);
  } catch { /* ignore */ }
}

/** Evict oldest entries when cache exceeds MAX_ENTRIES (LRU by mtime). */
function evictIfNeeded(): void {
  try {
    const entries = readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const fp = path.join(CACHE_DIR, f);
        const stat = statSync(fp);
        return { file: fp, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);

    const excess = entries.length - MAX_ENTRIES;
    if (excess <= 0) return;
    for (let i = 0; i < excess; i++) {
      try { unlinkSync(entries[i].file); } catch (_e) { /* eviction cleanup */ }
    }
  } catch (err) {
    logger.debug('[LOCAL-CACHE] eviction failed: %s', err instanceof Error ? err.message : String(err));
  }
}

/** Return number of cached entries. */
export function localCacheSize(): number {
  try {
    ensureCacheDir();
    return readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).length;
  } catch (err) {
    logger.debug('[LOCAL-CACHE] size check failed: %s', err instanceof Error ? err.message : String(err));
    return 0;
  }
}
