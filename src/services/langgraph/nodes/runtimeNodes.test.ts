import { describe, expect, it, vi } from 'vitest';
import { createInitialLangGraphState } from '../stateContract';
import {
  runHydrateMemoryNode,
  runNonTaskIntentNode,
  runPersistAndEmitNode,
  runTaskPolicyGateTransitionNode,
} from './runtimeNodes';

describe('runHydrateMemoryNode', () => {
  it('priority에 따라 maxItems를 계산한다', async () => {
    const loadHints = vi.fn(async () => ['h1']);

    const fast = await runHydrateMemoryNode({
      guildId: 'g1',
      goal: 'goal',
      priority: 'fast',
      requestedBy: 'u1',
      loadHints,
    });
    const precise = await runHydrateMemoryNode({
      guildId: 'g1',
      goal: 'goal',
      priority: 'precise',
      requestedBy: 'u1',
      loadHints,
    });

    expect(fast.maxItems).toBe(4);
    expect(precise.maxItems).toBe(16);
  });
});

describe('runPersistAndEmitNode', () => {
  it('patch result를 우선 적용하고 assistant payload를 생성한다', () => {
    const shadow = createInitialLangGraphState({
      sessionId: 's1',
      guildId: 'g1',
      requestedBy: 'u1',
      priority: 'balanced',
      goal: 'goal',
    });

    const out = runPersistAndEmitNode({
      shadowGraph: shadow,
      status: 'completed',
      currentResult: null,
      currentError: null,
      patch: { result: 'done' },
    });

    expect(out.nextResult).toBe('done');
    expect(out.assistantPayload).toBe('done');
    expect(out.shadowGraph.trace.at(-1)?.node).toBe('persist_and_emit');
  });
});

describe('runNonTaskIntentNode', () => {
  it('casual_chat이면 casual reply를 반환한다', async () => {
    const out = await runNonTaskIntentNode({
      routedIntent: 'casual_chat',
      goal: '안녕',
      intentHints: [],
      generateCasualReply: async () => '반가워요',
      generateClarification: async () => 'clarify',
    });

    expect(out).toMatchObject({
      traceNote: 'casual_chat',
      result: '반가워요',
    });
  });

  it('task이면 null을 반환한다', async () => {
    const out = await runNonTaskIntentNode({
      routedIntent: 'task',
      goal: '작업',
      intentHints: [],
      generateCasualReply: async () => 'x',
      generateClarification: async () => 'y',
    });

    expect(out).toBeNull();
  });
});

describe('runTaskPolicyGateTransitionNode', () => {
  it('task intent에서 block이면 block payload를 생성한다', () => {
    const out = runTaskPolicyGateTransitionNode({
      routedIntent: 'task',
      guildId: 'g1',
      taskGoal: '민감정보 요청',
      evaluateGate: () => ({
        mode: 'guarded',
        score: 88,
        decision: 'block',
        reasons: ['sensitive_request'],
      }),
      buildPolicyBlockMessage: (reasons) => `blocked:${reasons.join(',')}`,
    });

    expect(out.deliberationMode).toBe('guarded');
    expect(out.policyGate.decision).toBe('block');
    expect(out.shouldBlock).toBe(true);
    expect(out.blockResult).toBe('blocked:sensitive_request');
  });

  it('non-task intent면 allow 기본값을 반환한다', () => {
    const out = runTaskPolicyGateTransitionNode({
      routedIntent: 'casual_chat',
      guildId: 'g1',
      taskGoal: '안녕',
      evaluateGate: () => ({
        mode: 'guarded',
        score: 70,
        decision: 'review',
        reasons: ['x'],
      }),
      buildPolicyBlockMessage: () => 'blocked',
    });

    expect(out.deliberationMode).toBe('direct');
    expect(out.riskScore).toBe(0);
    expect(out.policyGate.decision).toBe('allow');
    expect(out.shouldBlock).toBe(false);
    expect(out.privacySample).toBeNull();
  });
});
