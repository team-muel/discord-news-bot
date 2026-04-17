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
  getLatestWorkflowArtifactRefs,
  getLatestWorkflowCapabilityDemands,
  getLatestWorkflowDecisionDistillate,
  getLatestWorkflowRecallRequest,
  inferWorkflowRuntimeLane,
  normalizeWorkflowRuntimeLane,
  recordWorkflowArtifactRefs,
  recordWorkflowCapabilityDemands,
  updateWorkflowSessionStatus,
  insertWorkflowStep,
  updateWorkflowStep,
  recordWorkflowDecisionDistillate,
  recordWorkflowEvent,
  recordWorkflowRecallRequest,
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
        metadata: expect.objectContaining({ runtime_lane: 'public-guild' }),
      }));
    });

    it('preserves explicit runtime lane metadata', async () => {
      const result = await createWorkflowSession({
        sessionId: 'wf-operator-1',
        workflowName: 'goal-pipeline',
        stage: 'interactive',
        scope: 'guild-1',
        status: 'proposed',
        metadata: { runtime_lane: 'operator-personal' },
      });

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ runtime_lane: 'operator-personal' }),
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

    it('records structured recall requests as recall_request events', async () => {
      const result = await recordWorkflowRecallRequest({
        sessionId: 'wf-test-123',
        decisionReason: 'Planner produced no executable actions',
        nextAction: 'clarify the goal and rerun planning',
        blockedAction: 'planActions',
        requestedBy: 'mcp-adapter',
        runtimeLane: 'system-internal',
        failedStepNames: ['planActions'],
      });

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'wf-test-123',
        event_type: 'recall_request',
        decision_reason: 'Planner produced no executable actions',
        payload: expect.objectContaining({
          next_action: 'clarify the goal and rerun planning',
          blocked_action: 'planActions',
          requested_by: 'mcp-adapter',
          runtime_lane: 'system-internal',
          failed_step_names: ['planActions'],
        }),
      }));
    });

    it('records structured decision distillates as decision_distillate events', async () => {
      const result = await recordWorkflowDecisionDistillate({
        sessionId: 'wf-test-123',
        summary: 'Pipeline released after bounded execution completed.',
        nextAction: 'promote durable operator-visible results into Obsidian if needed',
        runtimeLane: 'operator-personal',
        sourceEvent: 'session_complete',
        promoteAs: 'development_slice',
        tags: ['goal-pipeline', 'released'],
      });

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'wf-test-123',
        event_type: 'decision_distillate',
        decision_reason: 'Pipeline released after bounded execution completed.',
        payload: expect.objectContaining({
          next_action: 'promote durable operator-visible results into Obsidian if needed',
          runtime_lane: 'operator-personal',
          source_event: 'session_complete',
          promote_as: 'development_slice',
          tags: ['goal-pipeline', 'released'],
        }),
      }));
    });

    it('records structured capability demands as capability_demand events', async () => {
      const result = await recordWorkflowCapabilityDemands({
        sessionId: 'wf-test-123',
        runtimeLane: 'operator-personal',
        sourceEvent: 'session_complete',
        demands: [
          {
            summary: 'Planner produced no executable actions inside the current boundary.',
            objective: 'stabilize shared tooling handoff',
            missingCapability: 'executable plan inside current boundary',
            missingSource: 'planner',
            failedOrInsufficientRoute: 'planActions',
            cheapestEnablementPath: 'clarify the goal or expand the approved action surface before retrying',
            proposedOwner: 'gpt',
            evidenceRefs: ['docs/CHANGELOG-ARCH.md'],
            evidenceRefDetails: [
              {
                locator: 'docs/CHANGELOG-ARCH.md',
                refKind: 'repo-file',
                title: 'Architecture changelog',
                artifactPlane: 'github',
                githubSettlementKind: 'repo-file',
              },
            ],
            recallCondition: 'Planner produced no executable actions; GPT recall required',
            tags: ['goal-pipeline', 'planner-empty'],
          },
        ],
        payload: {
          final_status: 'failed',
        },
      });

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'wf-test-123',
        event_type: 'capability_demand',
        decision_reason: 'Planner produced no executable actions inside the current boundary.',
        payload: expect.objectContaining({
          runtime_lane: 'operator-personal',
          source_event: 'session_complete',
          final_status: 'failed',
          demands: [
            expect.objectContaining({
              summary: 'Planner produced no executable actions inside the current boundary.',
              objective: 'stabilize shared tooling handoff',
              missing_capability: 'executable plan inside current boundary',
              missing_source: 'planner',
              failed_or_insufficient_route: 'planActions',
              cheapest_enablement_path: 'clarify the goal or expand the approved action surface before retrying',
              proposed_owner: 'gpt',
              evidence_refs: ['docs/CHANGELOG-ARCH.md'],
              evidence_ref_details: [
                {
                  locator: 'docs/CHANGELOG-ARCH.md',
                  ref_kind: 'repo-file',
                  title: 'Architecture changelog',
                  artifact_plane: 'github',
                  github_settlement_kind: 'repo-file',
                },
              ],
              recall_condition: 'Planner produced no executable actions; GPT recall required',
              tags: ['goal-pipeline', 'planner-empty'],
            }),
          ],
        }),
      }));
    });

    it('records structured artifact refs as artifact_ref events', async () => {
      const result = await recordWorkflowArtifactRefs({
        sessionId: 'wf-test-123',
        runtimeLane: 'operator-personal',
        sourceStepName: 'collect-artifacts',
        sourceEvent: 'step_passed',
        refs: [
          { locator: 'docs/CHANGELOG-ARCH.md', refKind: 'repo-file', title: 'Architecture changelog' },
          { locator: 'branch:feat/runtime-hot-state', refKind: 'git-ref', title: 'feat/runtime-hot-state' },
          { locator: 'abc1234def5678', refKind: 'git-ref', title: 'commit abc1234def56' },
          { locator: 'https://github.com/team-muel/discord-news-bot/pull/123', refKind: 'url', title: 'PR 123' },
          { locator: 'https://example.com/runbook?utm_source=test', refKind: 'url', title: 'Runbook' },
        ],
      });

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'wf-test-123',
        event_type: 'artifact_ref',
        decision_reason: 'artifact refs from collect-artifacts',
        payload: expect.objectContaining({
          runtime_lane: 'operator-personal',
          source_step_name: 'collect-artifacts',
          source_event: 'step_passed',
          refs: [
            {
              locator: 'docs/CHANGELOG-ARCH.md',
              ref_kind: 'repo-file',
              title: 'Architecture changelog',
              artifact_plane: 'github',
              github_settlement_kind: 'repo-file',
            },
            {
              locator: 'branch:feat/runtime-hot-state',
              ref_kind: 'git-ref',
              title: 'feat/runtime-hot-state',
              artifact_plane: 'github',
              github_settlement_kind: 'branch',
            },
            {
              locator: 'abc1234def5678',
              ref_kind: 'git-ref',
              title: 'commit abc1234def56',
              artifact_plane: 'github',
              github_settlement_kind: 'commit',
            },
            {
              locator: 'https://github.com/team-muel/discord-news-bot/pull/123',
              ref_kind: 'url',
              title: 'PR 123',
              artifact_plane: 'github',
              github_settlement_kind: 'pull-request',
            },
            {
              locator: 'https://example.com/runbook?utm_source=test',
              ref_kind: 'url',
              title: 'Runbook',
              artifact_plane: 'external',
            },
          ],
        }),
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
          data: {
            session_id: 'wf-1',
            workflow_name: 'goal-pipeline',
            status: 'released',
            scope: 'guild-1',
            metadata: { runtime_lane: 'public-guild' },
          },
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
      const workflowEventsSessionEq = vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation((_column: string, eventType: string) => ({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eventType === 'recall_request'
                  ? {
                    created_at: '2026-04-12T12:00:00.000Z',
                    decision_reason: 'Pipeline failed after replanning',
                    evidence_id: 'wf-1-ev',
                    payload: {
                      next_action: 'inspect failed steps and revise the plan',
                      requested_by: 'ops-execution',
                      failed_step_names: ['replan-step-1-web.search'],
                    },
                  }
                  : eventType === 'decision_distillate'
                    ? {
                      created_at: '2026-04-12T12:00:45.000Z',
                      decision_reason: 'Pipeline failed after replanning and now needs GPT boundary review.',
                      evidence_id: 'wf-1-distillate',
                      payload: {
                        next_action: 'clarify the objective and rerun the bounded plan',
                        runtime_lane: 'public-guild',
                        source_event: 'session_complete',
                        promote_as: 'development_slice',
                        tags: ['goal-pipeline', 'failed'],
                      },
                    }
                    : eventType === 'capability_demand'
                      ? {
                        created_at: '2026-04-12T12:00:30.000Z',
                        decision_reason: 'Pipeline step replan-step-1-web.search was blocked by policy and needs a narrower route or approval.',
                        payload: {
                          runtime_lane: 'public-guild',
                          source_event: 'session_complete',
                          demands: [
                            {
                              summary: 'Pipeline step replan-step-1-web.search was blocked by policy and needs a narrower route or approval.',
                              objective: 'repair the failed automation route',
                              missing_capability: 'ACTION_NOT_ALLOWED',
                              failed_or_insufficient_route: 'replan-step-1-web.search',
                              cheapest_enablement_path: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
                              proposed_owner: 'operator',
                              evidence_refs: ['docs/CHANGELOG-ARCH.md'],
                              evidence_ref_details: [
                                {
                                  locator: 'docs/CHANGELOG-ARCH.md',
                                  ref_kind: 'repo-file',
                                  title: 'Architecture changelog',
                                  artifact_plane: 'github',
                                  github_settlement_kind: 'repo-file',
                                },
                              ],
                              recall_condition: 'Pipeline failed after replanning; GPT recall required',
                              tags: ['goal-pipeline', 'failed', 'replanned'],
                            },
                          ],
                        },
                      }
                    : eventType === 'artifact_ref'
                      ? {
                        created_at: '2026-04-12T12:00:20.000Z',
                        payload: {
                          runtime_lane: 'public-guild',
                          source_step_name: 'collect-artifacts',
                          source_event: 'step_passed',
                          refs: [
                            {
                              locator: 'docs/CHANGELOG-ARCH.md',
                              ref_kind: 'repo-file',
                              title: 'Architecture changelog',
                              artifact_plane: 'github',
                              github_settlement_kind: 'repo-file',
                            },
                            {
                              locator: 'branch:feat/runtime-hot-state',
                              ref_kind: 'git-ref',
                              title: 'feat/runtime-hot-state',
                              artifact_plane: 'github',
                              github_settlement_kind: 'branch',
                            },
                            {
                              locator: 'abc1234def5678',
                              ref_kind: 'git-ref',
                              title: 'commit abc1234def56',
                              artifact_plane: 'github',
                              github_settlement_kind: 'commit',
                            },
                            {
                              locator: 'https://github.com/team-muel/discord-news-bot/pull/123',
                              ref_kind: 'url',
                              title: 'PR 123',
                              artifact_plane: 'github',
                              github_settlement_kind: 'pull-request',
                            },
                            {
                              locator: 'https://example.com/runbook',
                              ref_kind: 'url',
                              title: 'Runbook',
                              artifact_plane: 'external',
                            },
                          ],
                        },
                      }
                    : null,
              }),
            }),
          }),
        })),
      });
      mockFrom.mockImplementation((table: string) => ({
        insert: mockInsert,
        update: mockUpdate,
        select: vi.fn().mockReturnValue({
          eq: table === 'workflow_sessions'
            ? sessionEq
            : table === 'workflow_steps'
              ? stepsEq
              : workflowEventsSessionEq,
        }),
      }));

      const summary = await getWorkflowSessionSummary('wf-1');

      expect(summary).not.toBeNull();
      expect(summary!.sessionId).toBe('wf-1');
      expect(summary!.workflowName).toBe('goal-pipeline');
      expect(summary!.status).toBe('released');
      expect(summary!.runtimeLane).toBe('public-guild');
      expect(summary!.lastRecallRequest).toEqual({
        createdAt: '2026-04-12T12:00:00.000Z',
        decisionReason: 'Pipeline failed after replanning',
        evidenceId: 'wf-1-ev',
        blockedAction: null,
        nextAction: 'inspect failed steps and revise the plan',
        requestedBy: 'ops-execution',
        runtimeLane: 'public-guild',
        failedStepNames: ['replan-step-1-web.search'],
      });
      expect(summary!.lastDecisionDistillate).toEqual({
        createdAt: '2026-04-12T12:00:45.000Z',
        summary: 'Pipeline failed after replanning and now needs GPT boundary review.',
        evidenceId: 'wf-1-distillate',
        nextAction: 'clarify the objective and rerun the bounded plan',
        runtimeLane: 'public-guild',
        sourceEvent: 'session_complete',
        promoteAs: 'development_slice',
        tags: ['goal-pipeline', 'failed'],
      });
      expect(summary!.lastCapabilityDemands).toEqual([
        {
          createdAt: '2026-04-12T12:00:30.000Z',
          summary: 'Pipeline step replan-step-1-web.search was blocked by policy and needs a narrower route or approval.',
          objective: 'repair the failed automation route',
          missingCapability: 'ACTION_NOT_ALLOWED',
          missingSource: null,
          failedOrInsufficientRoute: 'replan-step-1-web.search',
          cheapestEnablementPath: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
          proposedOwner: 'operator',
          evidenceRefs: ['docs/CHANGELOG-ARCH.md'],
          evidenceRefDetails: [
            {
              createdAt: '2026-04-12T12:00:30.000Z',
              locator: 'docs/CHANGELOG-ARCH.md',
              refKind: 'repo-file',
              title: 'Architecture changelog',
              artifactPlane: 'github',
              githubSettlementKind: 'repo-file',
              runtimeLane: 'public-guild',
              sourceStepName: null,
              sourceEvent: 'session_complete',
            },
          ],
          recallCondition: 'Pipeline failed after replanning; GPT recall required',
          runtimeLane: 'public-guild',
          sourceEvent: 'session_complete',
          tags: ['goal-pipeline', 'failed', 'replanned'],
        },
      ]);
      expect(summary!.lastArtifactRefs).toEqual([
        {
          createdAt: '2026-04-12T12:00:20.000Z',
          locator: 'docs/CHANGELOG-ARCH.md',
          refKind: 'repo-file',
          title: 'Architecture changelog',
          artifactPlane: 'github',
          githubSettlementKind: 'repo-file',
          runtimeLane: 'public-guild',
          sourceStepName: 'collect-artifacts',
          sourceEvent: 'step_passed',
        },
        {
          createdAt: '2026-04-12T12:00:20.000Z',
          locator: 'branch:feat/runtime-hot-state',
          refKind: 'git-ref',
          title: 'feat/runtime-hot-state',
          artifactPlane: 'github',
          githubSettlementKind: 'branch',
          runtimeLane: 'public-guild',
          sourceStepName: 'collect-artifacts',
          sourceEvent: 'step_passed',
        },
        {
          createdAt: '2026-04-12T12:00:20.000Z',
          locator: 'abc1234def5678',
          refKind: 'git-ref',
          title: 'commit abc1234def56',
          artifactPlane: 'github',
          githubSettlementKind: 'commit',
          runtimeLane: 'public-guild',
          sourceStepName: 'collect-artifacts',
          sourceEvent: 'step_passed',
        },
        {
          createdAt: '2026-04-12T12:00:20.000Z',
          locator: 'https://github.com/team-muel/discord-news-bot/pull/123',
          refKind: 'url',
          title: 'PR 123',
          artifactPlane: 'github',
          githubSettlementKind: 'pull-request',
          runtimeLane: 'public-guild',
          sourceStepName: 'collect-artifacts',
          sourceEvent: 'step_passed',
        },
        {
          createdAt: '2026-04-12T12:00:20.000Z',
          locator: 'https://example.com/runbook',
          refKind: 'url',
          title: 'Runbook',
          artifactPlane: 'external',
          githubSettlementKind: null,
          runtimeLane: 'public-guild',
          sourceStepName: 'collect-artifacts',
          sourceEvent: 'step_passed',
        },
      ]);
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

  describe('getLatestWorkflowRecallRequest', () => {
    it('returns null when no recall request exists', async () => {
      const recallEq = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      });
      mockFrom.mockImplementation(() => ({
        insert: mockInsert,
        update: mockUpdate,
        select: vi.fn().mockReturnValue({ eq: recallEq }),
      }));

      const recall = await getLatestWorkflowRecallRequest('wf-empty', 'operator-personal');

      expect(recall).toBeNull();
    });
  });

  describe('getLatestWorkflowDecisionDistillate', () => {
    it('returns null when no decision distillate exists', async () => {
      const distillateEq = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      });
      mockFrom.mockImplementation(() => ({
        insert: mockInsert,
        update: mockUpdate,
        select: vi.fn().mockReturnValue({ eq: distillateEq }),
      }));

      const distillate = await getLatestWorkflowDecisionDistillate('wf-empty', 'operator-personal');

      expect(distillate).toBeNull();
    });
  });

  describe('getLatestWorkflowCapabilityDemands', () => {
    it('returns empty array when no capability demand exists', async () => {
      const demandEq = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      });
      mockFrom.mockImplementation(() => ({
        insert: mockInsert,
        update: mockUpdate,
        select: vi.fn().mockReturnValue({ eq: demandEq }),
      }));

      const demands = await getLatestWorkflowCapabilityDemands('wf-empty', 'operator-personal');

      expect(demands).toEqual([]);
    });
  });

  describe('getLatestWorkflowArtifactRefs', () => {
    it('returns empty array when no artifact refs exist', async () => {
      const artifactEq = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      });
      mockFrom.mockImplementation(() => ({
        insert: mockInsert,
        update: mockUpdate,
        select: vi.fn().mockReturnValue({ eq: artifactEq }),
      }));

      const refs = await getLatestWorkflowArtifactRefs('wf-empty', 'operator-personal');

      expect(refs).toEqual([]);
    });
  });

  describe('runtime lane helpers', () => {
    it('normalizes empty runtime lane to system-internal', () => {
      expect(normalizeWorkflowRuntimeLane('')).toBe('system-internal');
    });

    it('infers public-guild lane for goal-pipeline with a guild scope', () => {
      expect(inferWorkflowRuntimeLane({ workflowName: 'goal-pipeline', scope: 'guild-1' })).toBe('public-guild');
    });

    it('infers system-internal lane for MCP goal-pipeline runs', () => {
      expect(inferWorkflowRuntimeLane({ workflowName: 'goal-pipeline', scope: 'MCP' })).toBe('system-internal');
    });

    it('prefers explicit runtime lane metadata over inferred defaults', () => {
      expect(inferWorkflowRuntimeLane({
        workflowName: 'goal-pipeline',
        scope: 'guild-1',
        metadata: { runtime_lane: 'operator-personal' },
      })).toBe('operator-personal');
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

    it('recordWorkflowRecallRequest returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await recordWorkflowRecallRequest({
        sessionId: 'wf-x', decisionReason: 'Need GPT recall',
      });
      expect(result).toEqual({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
    });

    it('recordWorkflowDecisionDistillate returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await recordWorkflowDecisionDistillate({
        sessionId: 'wf-x', summary: 'Need a durable decision summary',
      });
      expect(result).toEqual({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
    });

    it('recordWorkflowArtifactRefs returns SUPABASE_NOT_CONFIGURED', async () => {
      const result = await recordWorkflowArtifactRefs({
        sessionId: 'wf-x', refs: [{ locator: 'docs/CHANGELOG-ARCH.md', refKind: 'repo-file' }],
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
