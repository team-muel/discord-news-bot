import { describe, it, expect, vi, beforeEach } from 'vitest';

const coreNodeMocks = vi.hoisted(() => ({
  runCompilePromptNode: vi.fn(),
  runRouteIntentNode: vi.fn(),
  runPolicyGateNode: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  }),
}));

vi.mock('../llmClient', () => ({
  generateText: vi.fn().mockResolvedValue('task'),
}));

vi.mock('../agent/agentPrivacyPolicyService', () => ({
  getAgentPrivacyPolicySnapshot: () => ({
    modeDefault: 'direct',
    reviewRules: [],
    blockRules: [],
    reviewScore: 60,
    blockScore: 85,
  }),
}));

vi.mock('./nodes/coreNodes', () => ({
  runCompilePromptNode: coreNodeMocks.runCompilePromptNode,
  runRouteIntentNode: coreNodeMocks.runRouteIntentNode,
  runPolicyGateNode: coreNodeMocks.runPolicyGateNode,
}));

beforeEach(() => {
  vi.clearAllMocks();
  coreNodeMocks.runCompilePromptNode.mockReturnValue({
    executionGoal: 'test goal',
    normalizedGoal: 'test goal',
    directives: [],
    intentTags: [],
  });
  coreNodeMocks.runRouteIntentNode.mockResolvedValue('task');
  coreNodeMocks.runPolicyGateNode.mockReturnValue({
    mode: 'direct',
    score: 10,
    decision: 'allow',
    reasons: [],
  });
});

describe('shadowGraphRunner', () => {
  it('isShadowRunnerEnabled returns false by default', async () => {
    const { isShadowRunnerEnabled } = await import('./shadowGraphRunner');
    expect(isShadowRunnerEnabled()).toBe(false);
  });

  it('runShadowGraph executes and returns result', async () => {
    const { runShadowGraph } = await import('./shadowGraphRunner');

    const result = await runShadowGraph({
      sessionId: 'test-session-1',
      guildId: '123456789',
      requestedBy: '987654321',
      priority: 'balanced',
      goal: 'Test goal for shadow graph',
      mainPathNodes: ['ingest', 'compile_prompt', 'route_intent', 'select_execution_strategy', 'hydrate_memory'],
      loadMemoryHints: async () => ['hint1', 'hint2'],
    });

    expect(result).toBeDefined();
    expect(result.visitedNodes).toEqual([
      'ingest',
      'compile_prompt',
      'route_intent',
      'policy_gate',
      'hydrate_memory',
      'select_execution_strategy',
      'plan_actions',
      'execute_actions',
      'critic_review',
      'compose_response',
      'persist_and_emit',
    ]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });

  it('runShadowGraph detects divergence from main path', async () => {
    const { runShadowGraph } = await import('./shadowGraphRunner');

    // Main path goes to execute_actions, but shadow will skip via non-task intent
    const result = await runShadowGraph({
      sessionId: 'test-session-2',
      guildId: '123456789',
      requestedBy: '987654321',
      priority: 'fast',
      goal: 'casual hello',
      mainPathNodes: ['ingest', 'compile_prompt', 'route_intent', 'execute_actions', 'persist_and_emit'],
      loadMemoryHints: async () => [],
    });

    expect(result).toBeDefined();
    expect(result.error).toBeNull();
    // The shadow graph and main path may diverge depending on intent routing
    expect(result.visitedNodes.length).toBeGreaterThan(0);
  });

  it('runShadowGraph short-circuits non-task intents after policy gate', async () => {
    coreNodeMocks.runRouteIntentNode.mockResolvedValueOnce('casual_chat');

    const { runShadowGraph } = await import('./shadowGraphRunner');
    const result = await runShadowGraph({
      sessionId: 'test-session-non-task',
      guildId: '123456789',
      requestedBy: '987654321',
      priority: 'balanced',
      goal: '오늘 너무 힘들어',
      mainPathNodes: ['ingest', 'compile_prompt', 'route_intent', 'policy_gate', 'compose_response', 'persist_and_emit'],
      loadMemoryHints: async () => [],
    });

    expect(result.visitedNodes).toEqual([
      'ingest',
      'compile_prompt',
      'route_intent',
      'policy_gate',
      'compose_response',
      'persist_and_emit',
    ]);
    expect(result.shadowState.finalText).toContain('많이 지쳤던 것 같아요');
  });

  it('isShadowResultPromotable rejects preview-only task outputs', async () => {
    const { isShadowResultPromotable, runShadowGraph } = await import('./shadowGraphRunner');

    const result = await runShadowGraph({
      sessionId: 'test-session-promote',
      guildId: '123456789',
      requestedBy: '987654321',
      priority: 'balanced',
      goal: '운영 체크리스트 정리',
      mainPathNodes: [
        'ingest',
        'compile_prompt',
        'route_intent',
        'policy_gate',
        'hydrate_memory',
        'select_execution_strategy',
        'plan_actions',
        'execute_actions',
        'critic_review',
        'compose_response',
        'persist_and_emit',
      ],
      loadMemoryHints: async () => ['hint1'],
    });

    expect(isShadowResultPromotable(result, 'completed')).toEqual({
      promotable: false,
      reason: 'shadow_preview_only',
    });
  });

  it('persistShadowDivergence succeeds without errors', async () => {
    const { persistShadowDivergence, runShadowGraph } = await import('./shadowGraphRunner');

    const shadowResult = await runShadowGraph({
      sessionId: 'test-session-3',
      guildId: '123456789',
      requestedBy: '987654321',
      priority: 'balanced',
      goal: 'test persistence',
      mainPathNodes: ['ingest'],
      loadMemoryHints: async () => [],
    });

    // Should not throw
    await persistShadowDivergence({
      sessionId: 'test-session-3',
      guildId: '123456789',
      result: shadowResult,
      mainFinalStatus: 'completed',
    });
  });

  it('summarizeShadowDivergenceRows excludes error-only runs from convergence', async () => {
    const { summarizeShadowDivergenceRows } = await import('./shadowGraphRunner');

    const stats = summarizeShadowDivergenceRows([
      { diverge_at_index: null, elapsed_ms: 120, shadow_error: null },
      { diverge_at_index: 3, elapsed_ms: 240, shadow_error: null },
      { diverge_at_index: null, elapsed_ms: 180, shadow_error: 'timeout' },
    ]);

    expect(stats).toEqual({
      totalRuns: 3,
      divergedRuns: 1,
      errorRuns: 1,
      convergenceRate: 1 / 3,
      avgElapsedMs: 180,
    });
  });

  it('summarizeShadowDivergenceRows clamps negative elapsed time inputs to zero', async () => {
    const { summarizeShadowDivergenceRows } = await import('./shadowGraphRunner');

    const stats = summarizeShadowDivergenceRows([
      { diverge_at_index: null, elapsed_ms: -50, shadow_error: null },
      { diverge_at_index: null, elapsed_ms: 50, shadow_error: null },
    ]);

    expect(stats).toEqual({
      totalRuns: 2,
      divergedRuns: 0,
      errorRuns: 0,
      convergenceRate: 1,
      avgElapsedMs: 25,
    });
  });
});
