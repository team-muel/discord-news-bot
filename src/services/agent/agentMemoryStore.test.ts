import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseChain } from '../../test/supabaseMock';

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

vi.mock('./agentConsentService', () => ({
  hasMemoryConsent: vi.fn(async () => true),
}));

import * as supabaseClient from '../supabaseClient';
import * as agentConsentService from './agentConsentService';
import {
  isMemoryType,
  isFeedbackAction,
  isConflictStatus,
  isMemoryJobType,
  searchGuildMemory,
  createMemoryItem,
} from './agentMemoryStore';

// ??????????????????????????????????????????????????????????
describe('???媛??(?쒖닔 ?⑥닔)', () => {
  describe('isMemoryType', () => {
    it('?좏슚???????true', () => {
      expect(isMemoryType('episode')).toBe(true);
      expect(isMemoryType('semantic')).toBe(true);
      expect(isMemoryType('policy')).toBe(true);
      expect(isMemoryType('preference')).toBe(true);
    });
    it('臾댄슚??媛???false', () => {
      expect(isMemoryType('invalid')).toBe(false);
      expect(isMemoryType('')).toBe(false);
      expect(isMemoryType('EPISODE')).toBe(false);
    });
  });

  describe('isFeedbackAction', () => {
    it('?좏슚???≪뀡 ??true', () => {
      expect(isFeedbackAction('pin')).toBe(true);
      expect(isFeedbackAction('unpin')).toBe(true);
      expect(isFeedbackAction('edit')).toBe(true);
      expect(isFeedbackAction('deprecate')).toBe(true);
      expect(isFeedbackAction('approve')).toBe(true);
      expect(isFeedbackAction('reject')).toBe(true);
    });
    it('臾댄슚??媛???false', () => {
      expect(isFeedbackAction('delete')).toBe(false);
      expect(isFeedbackAction('')).toBe(false);
    });
  });

  describe('isConflictStatus', () => {
    it('?좏슚???곹깭 ??true', () => {
      expect(isConflictStatus('open')).toBe(true);
      expect(isConflictStatus('resolved')).toBe(true);
      expect(isConflictStatus('ignored')).toBe(true);
    });
    it('臾댄슚??媛???false', () => {
      expect(isConflictStatus('closed')).toBe(false);
      expect(isConflictStatus('')).toBe(false);
    });
  });

  describe('isMemoryJobType', () => {
    it('?좏슚??jobType ??true', () => {
      expect(isMemoryJobType('short_summary')).toBe(true);
      expect(isMemoryJobType('topic_synthesis')).toBe(true);
      expect(isMemoryJobType('durable_extraction')).toBe(true);
      expect(isMemoryJobType('reindex')).toBe(true);
      expect(isMemoryJobType('conflict_scan')).toBe(true);
      expect(isMemoryJobType('onboarding_snapshot')).toBe(true);
    });
    it('臾댄슚??媛???false', () => {
      expect(isMemoryJobType('unknown_job')).toBe(false);
      expect(isMemoryJobType('')).toBe(false);
    });
  });
});

// ??????????????????????????????????????????????????????????
describe('searchGuildMemory', () => {
  beforeEach(() => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    vi.mocked(supabaseClient.getSupabaseClient).mockImplementation(() => {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    });
  });

  it('Supabase 誘몄꽕????SUPABASE_NOT_CONFIGURED ?먮윭', async () => {
    await expect(
      searchGuildMemory({ guildId: 'g1', query: 'test', limit: 5 }),
    ).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
  });

  it('荑쇰━ ?먮윭 ??MEMORY_SEARCH_FAILED', async () => {
    const chain = createSupabaseChain({ data: null, error: { message: 'db error' } });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    await expect(
      searchGuildMemory({ guildId: 'g1', query: 'test', limit: 5 }),
    ).rejects.toThrow('db error');
  });

  it('寃곌낵 ?놁쓬 ??鍮?items 諛섑솚', async () => {
    const chain = createSupabaseChain({ data: [], error: null });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    // 荑쇰━ ?놁씠 ?몄텧?댁빞 or() 遺꾧린瑜??吏 ?딆쓬
    const result = await searchGuildMemory({ guildId: 'g1', query: '', limit: 5 });
    expect(result.items).toHaveLength(0);
    expect(result.meta.requestedTopK).toBe(5);
  });
});

// ??????????????????????????????????????????????????????????
describe('createMemoryItem', () => {
  beforeEach(() => {
    vi.mocked(agentConsentService.hasMemoryConsent).mockResolvedValue(true);
  });

  it('Supabase 誘몄꽕????SUPABASE_NOT_CONFIGURED ?먮윭', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    vi.mocked(supabaseClient.getSupabaseClient).mockImplementation(() => {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    });

    await expect(
      createMemoryItem({
        guildId: 'g1',
        type: 'semantic',
        content: '?뚯뒪???댁슜',
        actorId: 'user-123',
      }),
    ).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
  });

  it('insert ?깃났 ??data 諛섑솚', async () => {
    const fakeRow = { id: 'mem_abc', guild_id: 'g1', type: 'semantic', content: '?닿쾬? 理쒖냼 20?먮? ?섎뒗 ?뺤긽?곸씤 ?댁슜?낅땲??' };
    const chain = createSupabaseChain({ data: fakeRow, error: null });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    const result = await createMemoryItem({
      guildId: 'g1',
      type: 'semantic',
      content: '?닿쾬? 理쒖냼 20?먮? ?섎뒗 ?뺤긽?곸씤 ?댁슜?낅땲??',
      actorId: 'user-123',
    });
    expect(result).toEqual(fakeRow);
  });

  it('insert ?먮윭 ???먮윭 硫붿떆吏 throw', async () => {
    const chain = createSupabaseChain({ data: null, error: { message: 'insert failed' } });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    await expect(
      createMemoryItem({
        guildId: 'g1',
        type: 'semantic',
        content: '?닿쾬? 理쒖냼 20?먮? ?섎뒗 ?먮윭 耳?댁뒪 ?댁슜?낅땲??',
        actorId: 'user-123',
      }),
    ).rejects.toThrow('insert failed');
  });

  it('memory consent媛 ?놁쑝硫???μ쓣 李⑤떒?쒕떎', async () => {
    vi.mocked(agentConsentService.hasMemoryConsent).mockResolvedValue(false);
    const fakeClient = { from: vi.fn() } as any;
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(fakeClient);

    await expect(
      createMemoryItem({
        guildId: 'g1',
        type: 'semantic',
        content: '?닿쾬? 理쒖냼 20?먮? ?섎뒗 ?뺤긽?곸씤 ?댁슜?낅땲??',
        actorId: '12345678',
      }),
    ).rejects.toThrow('MEMORY_CONSENT_REQUIRED');
    expect(fakeClient.from).not.toHaveBeenCalled();
  });
});

// ??????????????????????????????????????????????????????????
describe('searchMemoryTiered', () => {
  it('is exported and callable', async () => {
    // searchMemoryTiered depends on Supabase, so we just verify it exists as an export
    const mod = await import('./agentMemoryStore');
    expect(typeof mod.searchMemoryTiered).toBe('function');
  });

  it('returns empty array when Supabase is not configured', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    vi.mocked(supabaseClient.getSupabaseClient).mockImplementation(() => {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    });

    const { searchMemoryTiered } = await import('./agentMemoryStore');
    const result = await searchMemoryTiered({ guildId: 'g1', query: 'test', limit: 5 });
    expect(result).toEqual([]);
  });

  it('falls back to flat search when flatSearch=true', async () => {
    const rows = [
      { id: 'mem_1', tier: 'raw', title: 'test', confidence: 0.5 },
    ];
    const chain = createSupabaseChain({ data: rows, error: null });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain), rpc: vi.fn(() => chain) } as any,
    );

    const { searchMemoryTiered } = await import('./agentMemoryStore');
    const result = await searchMemoryTiered({
      guildId: 'g1',
      query: '',
      limit: 5,
      flatSearch: true,
    });
    expect(result.length).toBeLessThanOrEqual(5);
  });
});
