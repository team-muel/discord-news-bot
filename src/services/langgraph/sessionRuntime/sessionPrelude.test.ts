import { beforeEach, describe, expect, it, vi } from 'vitest';

const preludeMocks = vi.hoisted(() => ({
  buildAgentMemoryHints: vi.fn(),
  recordPrivacyGateSample: vi.fn(),
  fetchRecentTurnsForUser: vi.fn(),
  runCompilePromptNode: vi.fn(),
  runClassifyIntentNode: vi.fn(),
  runPolicyGateNode: vi.fn(),
  enrichIntentSignals: vi.fn(),
  persistIntentExemplar: vi.fn(),
  runHydrateMemoryNode: vi.fn(),
  runNonTaskIntentNode: vi.fn(),
  runTaskPolicyGateTransitionNode: vi.fn(),
  generateCasualChatResult: vi.fn(),
  generateIntentClarificationResult: vi.fn(),
  buildPolicyBlockMessage: vi.fn((reasons: string[]) => `blocked:${reasons.join(',')}`),
}));

vi.mock('../../agent/agentMemoryService', () => ({
  buildAgentMemoryHints: preludeMocks.buildAgentMemoryHints,
}));
vi.mock('../../agent/agentPrivacyTuningService', () => ({
  recordPrivacyGateSample: preludeMocks.recordPrivacyGateSample,
}));
vi.mock('../../agent/agentIntentClassifier', () => ({
  buildPolicyBlockMessage: preludeMocks.buildPolicyBlockMessage,
  generateCasualChatResult: preludeMocks.generateCasualChatResult,
  generateIntentClarificationResult: preludeMocks.generateIntentClarificationResult,
}));
vi.mock('../../conversationTurnService', () => ({
  fetchRecentTurnsForUser: preludeMocks.fetchRecentTurnsForUser,
}));
vi.mock('../nodes/coreNodes', () => ({
  runCompilePromptNode: preludeMocks.runCompilePromptNode,
  runClassifyIntentNode: preludeMocks.runClassifyIntentNode,
  runPolicyGateNode: preludeMocks.runPolicyGateNode,
}));
vi.mock('../nodes/intentSignalEnricher', () => ({
  enrichIntentSignals: preludeMocks.enrichIntentSignals,
}));
vi.mock('../nodes/intentExemplarStore', () => ({
  persistIntentExemplar: preludeMocks.persistIntentExemplar,
}));
vi.mock('../nodes/runtimeNodes', () => ({
  runHydrateMemoryNode: preludeMocks.runHydrateMemoryNode,
  runNonTaskIntentNode: preludeMocks.runNonTaskIntentNode,
  runTaskPolicyGateTransitionNode: preludeMocks.runTaskPolicyGateTransitionNode,
}));

import {
  applySessionCompiledPrompt,
  applySessionExecutionStrategy,
  applySessionPolicyGateState,
  applySessionPolicyTransition,
  hydrateSessionMemory,
  maybeCompleteNonTaskSession,
  resolveComposeResponseState,
  runSessionIntentClassification,
  type SessionPreludeDependencies,
} from './sessionPrelude';
import type { AgentSession } from '../../multiAgentTypes';

const buildSession = (): AgentSession => ({
  id: 'session-1',
  guildId: 'guild-1',
  requestedBy: 'user-1',
  goal: 'help me',
  priority: 'balanced',
  requestedSkillId: null,
  routedIntent: 'task',
  status: 'running',
  createdAt: '2026-04-16T00:00:00.000Z',
  updatedAt: '2026-04-16T00:00:00.000Z',
  startedAt: '2026-04-16T00:00:00.000Z',
  endedAt: null,
  result: null,
  error: null,
  cancelRequested: false,
  memoryHints: [],
  steps: [],
  shadowGraph: {} as NonNullable<AgentSession['shadowGraph']>,
  personalization: null,
});

const buildDeps = (): SessionPreludeDependencies => ({
  agentMemoryHintTimeoutMs: 1000,
  agentSessionTimeoutMs: 10_000,
  getRecentSessionOutcomes: vi.fn(() => []),
  resolveEffectiveSessionProviderProfile: vi.fn(() => undefined),
  ensureShadowGraph: vi.fn((session: AgentSession) => session.shadowGraph || ({} as NonNullable<AgentSession['shadowGraph']>)),
  traceShadowNode: vi.fn(),
  nowIso: vi.fn(() => '2026-04-16T12:00:00.000Z'),
  cancelAllPendingSteps: vi.fn(),
  markSessionTerminal: vi.fn(),
  touch: vi.fn(),
});

beforeEach(() => {
  Object.values(preludeMocks).forEach((mock) => {
    if ('mockReset' in mock) {
      mock.mockReset();
    }
  });
});

describe('runSessionIntentClassification', () => {
  it('hydrates hints, appends recent failure hints, and updates session intent fields', async () => {
    const session = buildSession();
    const deps = buildDeps();
    preludeMocks.buildAgentMemoryHints.mockResolvedValue(['memory-hint']);
    preludeMocks.enrichIntentSignals.mockResolvedValue({
      compiledPrompt: { intentTags: ['ops'] },
      graphClusterHint: 'cluster-a',
      graphNeighborTags: ['ops', 'memory'],
      turnPosition: 2,
      recentTurns: [],
    });
    preludeMocks.runClassifyIntentNode.mockResolvedValue({
      primary: 'action_execute',
      confidence: 0.91,
      secondary: null,
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'mock',
      source: 'llm',
    });
    (deps.getRecentSessionOutcomes as ReturnType<typeof vi.fn>).mockReturnValue([
      { status: 'failed', error: 'TIMEOUT', goalSnippet: 'older failed goal', stepCount: 2 },
    ]);

    const result = await runSessionIntentClassification({
      session,
      taskGoal: 'execute bounded task',
      compiledPrompt: {
        originalGoal: 'execute bounded task',
        normalizedGoal: 'execute bounded task',
        executionGoal: 'execute bounded task',
        compiledGoal: 'execute bounded task',
        droppedNoise: false,
        intentTags: [],
        directives: [],
      },
      sessionStartedAtMs: Date.now(),
      deps,
    });

    expect(result.intentHints).toContain('memory-hint');
    expect(result.intentHints.some((line) => line.includes('older failed goal'))).toBe(true);
    expect(session.routedIntent).toBe('task');
    expect(session.intentClassification).toMatchObject({ primary: 'action_execute' });
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'route_intent', expect.stringContaining('action_execute'));
    expect(preludeMocks.persistIntentExemplar).toHaveBeenCalledTimes(1);
  });
});

describe('applySessionCompiledPrompt', () => {
  it('stores compiled prompt and derived task goal on the session shadow graph', () => {
    const session = buildSession();
    const deps = buildDeps();
    preludeMocks.runCompilePromptNode.mockReturnValue({
      originalGoal: 'help me',
      normalizedGoal: 'normalized goal',
      executionGoal: 'execution goal',
      compiledGoal: 'compiled goal',
      intentTags: ['ops'],
      directives: ['response.short'],
      droppedNoise: false,
    });

    const result = applySessionCompiledPrompt({ session, deps });

    expect(result.taskGoal).toBe('execution goal');
    expect(session.shadowGraph).toMatchObject({
      compiledPrompt: expect.objectContaining({ executionGoal: 'execution goal' }),
      executionGoal: 'execution goal',
    });
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'compile_prompt', 'structured_directive');
  });
});

describe('hydrateSessionMemory', () => {
  it('hydrates memory hints and mirrors them onto the session shadow graph', async () => {
    const session = buildSession();
    const deps = buildDeps();
    preludeMocks.runHydrateMemoryNode.mockResolvedValue({
      maxItems: 10,
      memoryHints: ['hint-a', 'hint-b'],
    });

    const result = await hydrateSessionMemory({
      session,
      taskGoal: 'goal',
      deps,
    });

    expect(result).toEqual({ maxItems: 10, memoryHints: ['hint-a', 'hint-b'] });
    expect(session.memoryHints).toEqual(['hint-a', 'hint-b']);
    expect(session.shadowGraph).toMatchObject({ memoryHints: ['hint-a', 'hint-b'] });
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'hydrate_memory', 'count=2');
    expect(deps.touch).toHaveBeenCalledWith(session);
  });
});

describe('applySessionPolicyTransition', () => {
  it('writes policy state and records privacy samples when present', () => {
    const session = buildSession();
    const deps = buildDeps();
    preludeMocks.runTaskPolicyGateTransitionNode.mockReturnValue({
      deliberationMode: 'guarded',
      riskScore: 0.7,
      policyGate: { decision: 'review', reasons: ['pii'] },
      traceNote: 'review:0.7',
      privacySample: {
        mode: 'guarded',
        decision: 'review',
        riskScore: 0.7,
        reasons: ['pii'],
        goal: 'goal',
      },
      shouldBlock: false,
      blockResult: null,
    });

    const result = applySessionPolicyTransition({ session, taskGoal: 'goal', deps });

    expect(result.policyGate.decision).toBe('review');
    expect(session.policyGate).toEqual({ decision: 'review', reasons: ['pii'] });
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'policy_gate', 'review:0.7');
    expect(preludeMocks.recordPrivacyGateSample).toHaveBeenCalledTimes(1);
  });
});

describe('applySessionPolicyGateState', () => {
  it('terminalizes blocked sessions and returns the final text', () => {
    const session = buildSession();
    const deps = buildDeps();
    preludeMocks.runTaskPolicyGateTransitionNode.mockReturnValue({
      deliberationMode: 'strict',
      riskScore: 0.95,
      policyGate: { decision: 'block', reasons: ['unsafe'] },
      traceNote: 'block:0.95',
      privacySample: null,
      shouldBlock: true,
      blockResult: 'blocked result',
    });

    const result = applySessionPolicyGateState({ session, taskGoal: 'goal', deps });

    expect(result).toEqual({ status: 'completed', finalText: 'blocked result' });
    expect(deps.cancelAllPendingSteps).toHaveBeenCalledWith(session, '2026-04-16T12:00:00.000Z');
    expect(deps.markSessionTerminal).toHaveBeenCalledWith(session, 'completed', {
      result: 'blocked result',
      error: null,
    });
    expect(deps.touch).not.toHaveBeenCalled();
  });

  it('touches the session and returns no terminal status when policy allows progress', () => {
    const session = buildSession();
    const deps = buildDeps();
    preludeMocks.runTaskPolicyGateTransitionNode.mockReturnValue({
      deliberationMode: 'guarded',
      riskScore: 0.4,
      policyGate: { decision: 'allow', reasons: [] },
      traceNote: 'allow:0.4',
      privacySample: null,
      shouldBlock: false,
      blockResult: null,
    });

    const result = applySessionPolicyGateState({ session, taskGoal: 'goal', deps });

    expect(result).toEqual({ status: null, finalText: null });
    expect(deps.touch).toHaveBeenCalledWith(session);
    expect(deps.markSessionTerminal).not.toHaveBeenCalled();
  });
});

describe('applySessionExecutionStrategy', () => {
  it('updates the shadow graph with execution strategy information', () => {
    const session = buildSession();
    const deps = buildDeps();
    session.policyGate = { decision: 'allow', reasons: [] };

    applySessionExecutionStrategy({
      session,
      selection: { strategy: 'fast_path', traceNote: 'fast_path:priority=fast' },
      deps,
    });

    expect(session.shadowGraph).toMatchObject({ executionStrategy: 'fast_path', policyDecision: 'allow' });
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'select_execution_strategy', 'fast_path:priority=fast');
  });
});

describe('maybeCompleteNonTaskSession', () => {
  it('terminalizes casual-chat sessions when non-task output is produced', async () => {
    const session = buildSession();
    const deps = buildDeps();
    session.routedIntent = 'casual_chat';
    preludeMocks.fetchRecentTurnsForUser.mockResolvedValue([{ role: 'user', content: 'hello' }]);
    preludeMocks.runNonTaskIntentNode.mockResolvedValue({
      traceNote: 'casual_chat',
      result: 'reply text',
    });

    const status = await maybeCompleteNonTaskSession({
      session,
      intentHints: ['hint-1'],
      deps,
    });

    expect(status).toBe('completed');
    expect(deps.cancelAllPendingSteps).toHaveBeenCalledWith(session, '2026-04-16T12:00:00.000Z');
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'compose_response', 'casual_chat');
    expect(deps.markSessionTerminal).toHaveBeenCalledTimes(1);
  });
});

describe('resolveComposeResponseState', () => {
  it('completes task sessions using the resolved trace label and final raw text', async () => {
    const session = buildSession();
    const deps = buildDeps();
    const completeTaskSession = vi.fn(() => {
      session.result = 'formatted output';
      return 'completed' as const;
    });

    const out = await resolveComposeResponseState({
      session,
      intentHints: [],
      executionStrategy: 'fast_path',
      finalCandidate: 'draft output',
      selectedFinalRaw: null,
      finalText: null,
      errorCode: null,
      deps,
      completeTaskSession,
    });

    expect(out).toMatchObject({
      status: 'completed',
      finalText: 'formatted output',
      selectedFinalRaw: 'draft output',
    });
    expect(completeTaskSession).toHaveBeenCalledWith('draft output', 'fast_path');
  });

  it('throws when task sessions have no final raw content', async () => {
    const session = buildSession();
    const deps = buildDeps();

    await expect(resolveComposeResponseState({
      session,
      intentHints: [],
      executionStrategy: 'full_review',
      finalCandidate: null,
      selectedFinalRaw: null,
      finalText: null,
      errorCode: null,
      deps,
      completeTaskSession: vi.fn(() => 'completed' as const),
    })).rejects.toThrow('LANGGRAPH_PRIMARY_RESULT_MISSING');
  });
});