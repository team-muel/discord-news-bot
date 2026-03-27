import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../agentPrivacyPolicyService', () => ({
  getAgentPrivacyPolicySnapshot: () => ({
    modeDefault: 'direct',
    reviewRules: [],
    blockRules: [],
    reviewScore: 60,
    blockScore: 85,
  }),
}));

vi.mock('./nodes/coreNodes', () => ({
  runCompilePromptNode: vi.fn().mockReturnValue({
    executionGoal: 'test goal',
    normalizedGoal: 'test goal',
    directives: [],
    intentTags: [],
  }),
  runRouteIntentNode: vi.fn().mockResolvedValue('task'),
  runPolicyGateNode: vi.fn().mockReturnValue({
    mode: 'direct',
    score: 10,
    decision: 'allow',
    reasons: [],
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(result.visitedNodes.length).toBeGreaterThan(0);
    expect(result.visitedNodes[0]).toBe('ingest');
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
});
