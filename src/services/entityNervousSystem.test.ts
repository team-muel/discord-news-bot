import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase before imports
vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn(() => ({ data: { id: 1 }, error: null })) })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({ data: [], error: null })),
          })),
          maybeSingle: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ data: null, error: null })),
      })),
    })),
  })),
}));

// Mock agentMemoryStore
vi.mock('./agentMemoryStore', () => ({
  queueMemoryJob: vi.fn(() => Promise.resolve({ id: 'mjob_test', status: 'queued' })),
}));

// Mock rewardSignalService
vi.mock('./rewardSignalService', () => ({
  computeRewardTrend: vi.fn(() => Promise.resolve(null)),
}));

describe('entityNervousSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Circuit 1: precipitateSessionToMemory', () => {
    it('enqueues a durable_extraction job for completed sessions', async () => {
      const { precipitateSessionToMemory } = await import('./entityNervousSystem');
      const { queueMemoryJob } = await import('./agentMemoryStore');

      const result = await precipitateSessionToMemory({
        sessionId: 'sess-001',
        guildId: 'guild-123',
        goal: 'Test goal',
        result: 'Some result text',
        status: 'completed',
        stepCount: 3,
        requestedBy: 'user-1',
      });

      expect(result).toBe(true);
      expect(queueMemoryJob).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: 'guild-123',
          jobType: 'durable_extraction',
          actorId: 'user-1',
          input: expect.objectContaining({
            source: 'session-precipitation',
            sessionId: 'sess-001',
          }),
        }),
      );
    });

    it('skips cancelled sessions', async () => {
      const { precipitateSessionToMemory } = await import('./entityNervousSystem');
      const { queueMemoryJob } = await import('./agentMemoryStore');

      const result = await precipitateSessionToMemory({
        sessionId: 'sess-002',
        guildId: 'guild-123',
        goal: 'Test',
        result: null,
        status: 'cancelled',
        stepCount: 5,
        requestedBy: 'user-1',
      });

      expect(result).toBe(false);
      expect(queueMemoryJob).not.toHaveBeenCalled();
    });

    it('skips sessions with too few steps', async () => {
      const { precipitateSessionToMemory } = await import('./entityNervousSystem');
      const { queueMemoryJob } = await import('./agentMemoryStore');

      const result = await precipitateSessionToMemory({
        sessionId: 'sess-003',
        guildId: 'guild-123',
        goal: 'Quick',
        result: 'Done',
        status: 'completed',
        stepCount: 1,
        requestedBy: 'user-1',
      });

      expect(result).toBe(false);
      expect(queueMemoryJob).not.toHaveBeenCalled();
    });
  });

  describe('Circuit 2: adjustBehaviorFromReward', () => {
    it('returns null when no trend data available', async () => {
      const { adjustBehaviorFromReward } = await import('./entityNervousSystem');
      const result = await adjustBehaviorFromReward('guild-456');
      expect(result).toBeNull();
    });
  });

  describe('Circuit 3: Self-notes', () => {
    it('persists and loads self-notes', async () => {
      const { persistSelfNote, loadSelfNotes } = await import('./entityNervousSystem');

      const ok = await persistSelfNote({
        guildId: 'guild-789',
        source: 'retro:sprint-1',
        note: 'Reduce token usage in plan phase',
        createdAt: new Date().toISOString(),
      });

      expect(ok).toBe(true);

      // Should return from in-memory cache
      const notes = await loadSelfNotes('guild-789');
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0]).toContain('자기 성찰');
      expect(notes[0]).toContain('Reduce token usage');
    });

    it('ingestRetroInsights creates self-notes from optimize hints', async () => {
      const { ingestRetroInsights, loadSelfNotes } = await import('./entityNervousSystem');

      const count = await ingestRetroInsights({
        guildId: 'guild-retro',
        sprintId: 'sprint-42',
        optimizeHints: ['Reduce token usage', 'Cache LLM responses'],
        failedPhases: ['qa'],
      });

      expect(count).toBe(3); // 2 optimize hints + 1 failure pattern
      const notes = await loadSelfNotes('guild-retro');
      expect(notes.length).toBe(3);
    });
  });

  describe('getNervousSystemStatus', () => {
    it('returns enabled status with all circuits', async () => {
      const { getNervousSystemStatus } = await import('./entityNervousSystem');
      const status = getNervousSystemStatus();

      expect(status.enabled).toBe(true);
      expect(status.circuits.perceptionToMemory).toBe(true);
      expect(status.circuits.rewardToBehavior).toBe(true);
      expect(status.circuits.selfReflectionToModification).toBe(true);
    });
  });
});
