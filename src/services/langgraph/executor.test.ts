import { describe, expect, it } from 'vitest';
import { appendTrace, createInitialLangGraphState, type LangGraphNodeId } from './stateContract';
import { createLinearEdgeResolver, executeLangGraph } from './executor';
import { executeLangGraphWithLangGraphJs } from './langgraphjsAdapter';

const createHandlers = () => ({
  ingest: async ({ state }: any) => appendTrace(state, 'ingest', 'ok'),
  compile_prompt: async ({ state }: any) => appendTrace(state, 'compile_prompt', 'ok'),
  route_intent: async ({ state }: any) => state,
  select_execution_strategy: async ({ state }: any) => appendTrace(state, 'select_execution_strategy', 'ok'),
  hydrate_memory: async ({ state }: any) => state,
  plan_actions: async ({ state }: any) => state,
  execute_actions: async ({ state }: any) => state,
  critic_review: async ({ state }: any) => state,
  requested_skill_run: async ({ state }: any) => state,
  requested_skill_refine: async ({ state }: any) => state,
  fast_path_run: async ({ state }: any) => state,
  fast_path_refine: async ({ state }: any) => state,
  full_review_plan: async ({ state }: any) => state,
  full_review_execute: async ({ state }: any) => state,
  full_review_critique: async ({ state }: any) => state,
  full_review_tot: async ({ state }: any) => state,
  hitl_review: async ({ state }: any) => state,
  full_review_compose: async ({ state }: any) => state,
  full_review_promote: async ({ state }: any) => state,
  policy_gate: async ({ state }: any) => state,
  compose_response: async ({ state }: any) => state,
  persist_and_emit: async ({ state }: any) => appendTrace(state, 'persist_and_emit', 'done'),
});

describe('executeLangGraph', () => {
  it('linear resolver로 노드를 순차 실행한다', async () => {
    const order: LangGraphNodeId[] = ['ingest', 'compile_prompt', 'select_execution_strategy', 'persist_and_emit'];
    const handlers = createHandlers();

    const result = await executeLangGraph({
      initialNode: 'ingest',
      initialState: createInitialLangGraphState({
        sessionId: 's1',
        guildId: 'g1',
        requestedBy: 'u1',
        priority: 'balanced',
        goal: 'test',
      }),
      handlers,
      resolveNext: createLinearEdgeResolver(order),
      options: {
        context: {},
      },
    });

    expect(result.visitedNodes).toEqual(['ingest', 'compile_prompt', 'select_execution_strategy', 'persist_and_emit']);
    expect(result.finalState.trace.length).toBe(4);
  });

  it('shouldStop 조건으로 중간 종료할 수 있다', async () => {
    const order: LangGraphNodeId[] = ['ingest', 'compile_prompt', 'persist_and_emit'];
    const handlers = createHandlers();

    const result = await executeLangGraph({
      initialNode: 'ingest',
      initialState: createInitialLangGraphState({
        sessionId: 's1',
        guildId: 'g1',
        requestedBy: 'u1',
        priority: 'balanced',
        goal: 'test',
      }),
      handlers,
      resolveNext: createLinearEdgeResolver(order),
      options: {
        context: {},
        shouldStop: ({ step }) => step >= 1,
      },
    });

    expect(result.visitedNodes).toEqual(['ingest']);
  });

  it('neutral agentGraph aliases stay wired to the current executor surface', async () => {
    const graphModule = await import('./index');

    expect(graphModule.executeAgentGraph).toBe(executeLangGraph);
    expect(graphModule.createLinearAgentGraphEdgeResolver).toBe(createLinearEdgeResolver);
    expect(graphModule.createInitialAgentGraphState).toBe(createInitialLangGraphState);
    expect(graphModule.appendAgentGraphTrace).toBe(appendTrace);
  });

  it('LangGraph.js adapter preserves the current linear executor behavior', async () => {
    const order: LangGraphNodeId[] = ['ingest', 'compile_prompt', 'select_execution_strategy', 'persist_and_emit'];
    const handlers = createHandlers();

    const initialState = createInitialLangGraphState({
      sessionId: 's2',
      guildId: 'g1',
      requestedBy: 'u1',
      priority: 'balanced',
      goal: 'adapter test',
    });

    const [customResult, externalResult] = await Promise.all([
      executeLangGraph({
        initialNode: 'ingest',
        initialState,
        handlers,
        resolveNext: createLinearEdgeResolver(order),
        options: { context: {} },
      }),
      executeLangGraphWithLangGraphJs({
        initialNode: 'ingest',
        initialState,
        handlers,
        resolveNext: createLinearEdgeResolver(order),
        options: { context: {} },
      }),
    ]);

    expect(externalResult.visitedNodes).toEqual(customResult.visitedNodes);
    expect(externalResult.transitionCount).toBe(customResult.transitionCount);
    expect(externalResult.finalState.trace.map((entry) => entry.node)).toEqual(
      customResult.finalState.trace.map((entry) => entry.node),
    );
  });
});
