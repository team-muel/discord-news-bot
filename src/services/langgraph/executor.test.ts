import { describe, expect, it } from 'vitest';
import { appendTrace, createInitialLangGraphState, type LangGraphNodeId } from './stateContract';
import { createLinearEdgeResolver, executeLangGraph } from './executor';

describe('executeLangGraph', () => {
  it('linear resolver로 노드를 순차 실행한다', async () => {
    const order: LangGraphNodeId[] = ['ingest', 'compile_prompt', 'select_execution_strategy', 'persist_and_emit'];
    const handlers = {
      ingest: async ({ state }: any) => appendTrace(state, 'ingest', 'ok'),
      compile_prompt: async ({ state }: any) => appendTrace(state, 'compile_prompt', 'ok'),
      route_intent: async ({ state }: any) => state,
      select_execution_strategy: async ({ state }: any) => appendTrace(state, 'select_execution_strategy', 'ok'),
      hydrate_memory: async ({ state }: any) => state,
      plan_actions: async ({ state }: any) => state,
      execute_actions: async ({ state }: any) => state,
      critic_review: async ({ state }: any) => state,
      policy_gate: async ({ state }: any) => state,
      compose_response: async ({ state }: any) => state,
      persist_and_emit: async ({ state }: any) => appendTrace(state, 'persist_and_emit', 'done'),
    };

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
    const handlers = {
      ingest: async ({ state }: any) => appendTrace(state, 'ingest', 'ok'),
      compile_prompt: async ({ state }: any) => appendTrace(state, 'compile_prompt', 'ok'),
      route_intent: async ({ state }: any) => state,
      select_execution_strategy: async ({ state }: any) => appendTrace(state, 'select_execution_strategy', 'ok'),
      hydrate_memory: async ({ state }: any) => state,
      plan_actions: async ({ state }: any) => state,
      execute_actions: async ({ state }: any) => state,
      critic_review: async ({ state }: any) => state,
      policy_gate: async ({ state }: any) => state,
      compose_response: async ({ state }: any) => state,
      persist_and_emit: async ({ state }: any) => appendTrace(state, 'persist_and_emit', 'done'),
    };

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
});
