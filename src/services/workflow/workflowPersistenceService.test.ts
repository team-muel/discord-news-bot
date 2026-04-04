import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsSupabaseConfigured = vi.fn().mockReturnValue(true);

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getSupabaseClient: () => mockClient,
}));

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }),
});
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: null }),
  }),
});
const mockFrom = vi.fn().mockImplementation(() => ({
  insert: mockInsert,
  update: mockUpdate,
  select: mockSelect,
}));
const mockClient = { from: mockFrom };

import {
  generateSessionId,
  createWorkflowSession,
  updateWorkflowSessionStatus,
  insertWorkflowStep,
  updateWorkflowStep,
  recordWorkflowEvent,
  getWorkflowSessionSummary,
} from './workflowPersistenceService';

describe('workflowPersistenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);
  });

  describe('generateSessionId', () => {
    it('generates unique session IDs with wf- prefix', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      expect(id1).toMatch(/^wf-/);
      expect(id2).toMatch(/^wf-/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('createWorkflowSession', () => {
    it('inserts session into workflow_sessions table', async () => {
      const result = await createWorkflowSession({
        sessionId: 'wf-test-123',
        workflowName: 'goal-pipeline',
        stage: 'planning',
        scope: 'guild-1',
        status: 'proposed',
      });

      expect(result.ok).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('workflow_sessions');
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'wf-test-123',
        workflow_name: 'goal-pipeline',
        stage: 'planning',
        scope: 'guild-1',
        status: 'proposed',
      }));
    });

    it('returns error when insert fails', async () => {
      mockInsert.mockResolvedValueOnce({ error: { message: 'duplicate key' } });

      const result = await createWorkflowSession({
        sessionId: 'wf-dup',
        workflowName: 'test',
        stage: 'test',
        status: 'proposed',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('duplicate key');
    });
  });

  describe('updateWorkflowSessionStatus', () => {
    it('updates session status', async () => {
      const result = await updateWorkflowSessionStatus('wf-test-123', 'executing');
      expect(result.ok).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('workflow_sessions');
    });

    it('sets completed_at when flag is true', async () => {
      const eq1 = vi.fn().mockResolvedValue({ error: null });
      mockUpdate.mockReturnValueOnce({ eq: vi.fn().mockReturnValue(eq1) });

      await updateWorkflowSessionStatus('wf-test-123', 'released', true);

      expect(mockFrom).toHaveBeenCalledWith('workflow_sessions');
    });
  });

  describe('insertWorkflowStep', () => {
    it('inserts step with correct data', async () => {
      const result = await insertWorkflowStep({
        sessionId: 'wf-test-123',
        stepOrder: 1,
        stepName: 'web.search',
        agentRole: 'review',
        status: 'passed',
        durationMs: 150,
        details: { query: 'test' },
      });

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'wf-test-123',
        step_order: 1,
        step_name: 'web.search',
        agent_role: 'review',
        status: 'passed',
        duration_ms: 150,
      }));
    });
  });

  describe('recordWorkflowEvent', () => {
    it('records event with payload', async () => {
      const result = await recordWorkflowEvent({
        sessionId: 'wf-test-123',
        eventType: 'state_transition',
        fromState: 'proposed',
        toState: 'executing',
        decisionReason: 'Planned 3 actions',
        payload: { actionCount: 3 },
      });

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'wf-test-123',
        event_type: 'state_transition',
        from_state: 'proposed',
        to_state: 'executing',
        decision_reason: 'Planned 3 actions',
      }));
    });
  });

  describe('updateWorkflowStep', () => {
    it('updates step status and duration', async () => {
      const eq2 = vi.fn().mockResolvedValue({ error: null });
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
      mockUpdate.mockReturnValueOnce({ eq: eq1 });

      const result = await updateWorkflowStep('wf-test-123', 1, {
        status: 'passed',
        durationMs: 250,
      });

      expect(result.ok).toBe(true);
    });
  });

  // ─── getWorkflowSessionSummary ────────────────────────────────────────

  describe('getWorkflowSessionSummary', () => {
    it('returns summary with step aggregation', async () => {
      const sessionEq = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { session_id: 'wf-1', workflow_name: 'goal-pipeline', status: 'released' },
        }),
      });
      const stepsEq = vi.fn().mockResolvedValue({
        data: [
          { status: 'passed', duration_ms: 100 },
          { status: 'passed', duration_ms: 200 },
          { status: 'failed', duration_ms: 50 },
          { status: 'skipped', duration_ms: null },
        ],
      });
      mockFrom.mockImplementation((table: string) => ({
        insert: mockInsert,
        update: mockUpdate,
        select: vi.fn().mockReturnValue({
          eq: table === 'workflow_sessions' ? sessionEq : stepsEq,
        }),
      }));

      const summary = await getWorkflowSessionSummary('wf-1');

      expect(summary).not.toBeNull();
      expect(summary!.sessionId).toBe('wf-1');
      expect(summary!.workflowName).toBe('goal-pipeline');
      expect(summary!.status).toBe('released');
      expect(summary!.stepCount).toBe(4);
      expect(summary!.passedSteps).toBe(2);
      expect(summary!.failedSteps).toBe(1);
      expect(summary!.totalDurationMs).toBe(350);
    });

    it('returns null when session not found', async () => {
      mockFrom.mockImplementationOnce(() => ({
        insert: mockInsert,
        update: mockUpdate,
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }));

      const summary = await getWorkflowSessionSummary('wf-nonexistent');
      expect(summary).toBeNull();
    });

    it('returns null when Supabase throws', async () => {
      mockFrom.mockImplementationOnce(() => { throw new Error('connection lost'); });

      const summary = await getWorkflowSessionSummary('wf-err');
      expect(summary).toBeNull();
    });

    it('returns null when Supabase not configured', async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);

      const summary = await getWorkflowSessionSummary('wf-1');
      expect(summary).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ─── Supabase not configured early-returns ────────────────────────────

  describe('Supabase not configured', () => {
    beforeEach(() => {
      mockIsSupabaseConfigured.mockReturnValue(false);
    });

    it('createWorkflowSession returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await createWorkflowSession({
        sessionId: 'wf-x', workflowName: 'test', stage: 'planning', status: 'proposed',
      });
      expect(result).toEqual({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('updateWorkflowSessionStatus returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await updateWorkflowSessionStatus('wf-x', 'executing');
      expect(result).toEqual({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
    });

    it('insertWorkflowStep returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await insertWorkflowStep({
        sessionId: 'wf-x', stepOrder: 1, stepName: 'test', status: 'queued',
      });
      expect(result).toEqual({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
    });

    it('updateWorkflowStep returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await updateWorkflowStep('wf-x', 1, { status: 'passed' });
      expect(result).toEqual({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
    });

    it('recordWorkflowEvent returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await recordWorkflowEvent({
        sessionId: 'wf-x', eventType: 'state_transition',
      });
      expect(result).toEqual({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
    });
  });

  // ─── Exception handling ───────────────────────────────────────────────

  describe('exception handling', () => {
    it('createWorkflowSession catches thrown errors', async () => {
      mockFrom.mockImplementationOnce(() => { throw new Error('db down'); });
      const result = await createWorkflowSession({
        sessionId: 'wf-err', workflowName: 'test', stage: 'test', status: 'proposed',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('db down');
    });

    it('insertWorkflowStep catches thrown errors', async () => {
      mockFrom.mockImplementationOnce(() => { throw new Error('timeout'); });
      const result = await insertWorkflowStep({
        sessionId: 'wf-err', stepOrder: 1, stepName: 'test', status: 'queued',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('timeout');
    });

    it('recordWorkflowEvent catches thrown errors', async () => {
      mockFrom.mockImplementationOnce(() => { throw new Error('network'); });
      const result = await recordWorkflowEvent({
        sessionId: 'wf-err', eventType: 'error',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('network');
    });
  });
});
