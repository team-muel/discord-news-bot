import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => { throw new Error('supabase not configured'); },
}));

import {
  buildNewsFingerprint,
  isNewsFingerprinted,
  recordNewsFingerprint,
} from './newsCaptureDedupService';

describe('buildNewsFingerprint', () => {
  it('같은 입력에 대해 항상 동일한 해시를 반환한다', () => {
    const a = buildNewsFingerprint({ guildId: 'g1', goal: '애플 뉴스', canonicalUrls: ['https://r.com/1', 'https://b.com/2'] });
    const b = buildNewsFingerprint({ guildId: 'g1', goal: '애플 뉴스', canonicalUrls: ['https://r.com/1', 'https://b.com/2'] });
    expect(a).toBe(b);
  });

  it('URL 순서가 달라도 동일한 해시를 반환한다 (정렬)', () => {
    const a = buildNewsFingerprint({ guildId: 'g1', goal: '뉴스', canonicalUrls: ['https://a.com', 'https://b.com'] });
    const b = buildNewsFingerprint({ guildId: 'g1', goal: '뉴스', canonicalUrls: ['https://b.com', 'https://a.com'] });
    expect(a).toBe(b);
  });

  it('goal이 다르면 다른 해시를 반환한다', () => {
    const a = buildNewsFingerprint({ guildId: 'g1', goal: '뉴스A', canonicalUrls: ['https://a.com'] });
    const b = buildNewsFingerprint({ guildId: 'g1', goal: '뉴스B', canonicalUrls: ['https://a.com'] });
    expect(a).not.toBe(b);
  });

  it('guildId가 다르면 다른 해시를 반환한다', () => {
    const a = buildNewsFingerprint({ guildId: 'g1', goal: '뉴스', canonicalUrls: ['https://a.com'] });
    const b = buildNewsFingerprint({ guildId: 'g2', goal: '뉴스', canonicalUrls: ['https://a.com'] });
    expect(a).not.toBe(b);
  });

  it('64자 hex 문자열을 반환한다 (SHA-256)', () => {
    const fp = buildNewsFingerprint({ guildId: 'g1', goal: 'test', canonicalUrls: [] });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isNewsFingerprinted / recordNewsFingerprint (in-memory fallback)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('등록 전에는 false를 반환한다', async () => {
    const fp = buildNewsFingerprint({ guildId: 'guild-fresh', goal: 'new goal', canonicalUrls: ['https://x.com'] });
    const result = await isNewsFingerprinted({ guildId: 'guild-fresh', fingerprint: fp, ttlMs: 60_000 });
    expect(result).toBe(false);
  });

  it('등록 후에는 true를 반환한다', async () => {
    const guildId = 'guild-dedup-1';
    const fp = buildNewsFingerprint({ guildId, goal: '중복확인', canonicalUrls: ['https://dup.com'] });
    await recordNewsFingerprint({ guildId, fingerprint: fp, goal: '중복확인', ttlMs: 60_000 });
    const result = await isNewsFingerprinted({ guildId, fingerprint: fp, ttlMs: 60_000 });
    expect(result).toBe(true);
  });

  it('다른 guild의 fingerprint는 중복으로 처리되지 않는다', async () => {
    const fp = buildNewsFingerprint({ guildId: 'guild-A', goal: '공통', canonicalUrls: ['https://common.com'] });
    await recordNewsFingerprint({ guildId: 'guild-A', fingerprint: fp, goal: '공통', ttlMs: 60_000 });
    const result = await isNewsFingerprinted({ guildId: 'guild-B', fingerprint: fp, ttlMs: 60_000 });
    expect(result).toBe(false);
  });

  it('TTL 0ms로 등록하면 즉시 만료된다', async () => {
    const guildId = 'guild-ttl';
    const fp = buildNewsFingerprint({ guildId, goal: 'ttl-test', canonicalUrls: ['https://ttl.com'] });
    await recordNewsFingerprint({ guildId, fingerprint: fp, goal: 'ttl-test', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const result = await isNewsFingerprinted({ guildId, fingerprint: fp, ttlMs: 1 });
    expect(result).toBe(false);
  });
});
