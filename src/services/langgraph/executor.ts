/**
 * NAMING NOTE: "LangGraph" here is a repository-internal label for a custom
 * loop-based state machine executor. This is NOT LangChain's @langchain/langgraph.
 * No checkpointing, HITL, branching/merging, or time-travel debugging.
 * See docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md → Name Collision Matrix.
 */
import type { LangGraphNodeId, LangGraphState } from './stateContract';

export type LangGraphNodeHandler<TContext = unknown> = (params: {
  state: LangGraphState;
  context: TContext;
}) => Promise<LangGraphState>;

export type LangGraphEdgeResolver<TContext = unknown> = (params: {
  from: LangGraphNodeId;
  state: LangGraphState;
  context: TContext;
}) => LangGraphNodeId | null;

export type LangGraphExecutorOptions<TContext = unknown> = {
  maxSteps?: number;
  shouldStop?: (params: { state: LangGraphState; step: number }) => boolean;
  onTransition?: (params: { from: LangGraphNodeId; to: LangGraphNodeId | null; step: number; state: LangGraphState }) => void;
  context: TContext;
};

export type LangGraphExecutorResult = {
  finalState: LangGraphState;
  visitedNodes: LangGraphNodeId[];
  transitionCount: number;
};

const DEFAULT_MAX_STEPS = 20;

export const executeLangGraph = async <TContext = unknown>(params: {
  initialNode: LangGraphNodeId;
  initialState: LangGraphState;
  handlers: Record<LangGraphNodeId, LangGraphNodeHandler<TContext>>;
  resolveNext: LangGraphEdgeResolver<TContext>;
  options: LangGraphExecutorOptions<TContext>;
}): Promise<LangGraphExecutorResult> => {
  const maxSteps = Math.max(1, Math.min(200, Number(params.options.maxSteps || DEFAULT_MAX_STEPS) || DEFAULT_MAX_STEPS));

  let currentNode: LangGraphNodeId | null = params.initialNode;
  let currentState: LangGraphState = params.initialState;
  const visitedNodes: LangGraphNodeId[] = [];
  let transitionCount = 0;

  for (let step = 0; step < maxSteps && currentNode; step += 1) {
    if (params.options.shouldStop?.({ state: currentState, step })) {
      break;
    }

    const handler = params.handlers[currentNode];
    if (!handler) {
      throw new Error(`LANGGRAPH_HANDLER_MISSING:${currentNode}`);
    }

    const nextState = await handler({
      state: currentState,
      context: params.options.context,
    });

    visitedNodes.push(currentNode);
    const nextNode = params.resolveNext({
      from: currentNode,
      state: nextState,
      context: params.options.context,
    });

    transitionCount += 1;
    params.options.onTransition?.({
      from: currentNode,
      to: nextNode,
      step,
      state: nextState,
    });

    currentState = nextState;
    currentNode = nextNode;
  }

  return {
    finalState: currentState,
    visitedNodes,
    transitionCount,
  };
};

export const createLinearEdgeResolver = (order: LangGraphNodeId[]): LangGraphEdgeResolver => {
  const indexByNode = new Map<LangGraphNodeId, number>(order.map((node, index) => [node, index]));

  return ({ from }) => {
    const index = indexByNode.get(from);
    if (index === undefined) {
      return null;
    }
    const next = order[index + 1];
    return next || null;
  };
};
