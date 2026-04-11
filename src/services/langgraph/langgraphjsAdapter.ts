import { Annotation, Command, END, START, StateGraph } from '@langchain/langgraph';
import type {
  LangGraphEdgeResolver,
  LangGraphExecutorOptions,
  LangGraphExecutorResult,
  LangGraphNodeHandler,
} from './executor';
import type { LangGraphNodeId, LangGraphState } from './stateContract';

type LangGraphEnvelope = {
  state: LangGraphState;
};

const LangGraphJsStateAnnotation = Annotation.Root({
  state: Annotation<LangGraphState>(),
});

export const executeLangGraphWithLangGraphJs = async <TContext = unknown>(params: {
  initialNode: LangGraphNodeId;
  initialState: LangGraphState;
  handlers: Record<LangGraphNodeId, LangGraphNodeHandler<TContext>>;
  resolveNext: LangGraphEdgeResolver<TContext>;
  options: LangGraphExecutorOptions<TContext>;
}): Promise<LangGraphExecutorResult> => {
  const maxSteps = Math.max(1, Math.min(200, Number(params.options.maxSteps || 20) || 20));
  const nodeIds = Object.keys(params.handlers) as LangGraphNodeId[];

  if (!nodeIds.includes(params.initialNode)) {
    throw new Error(`LANGGRAPH_HANDLER_MISSING:${params.initialNode}`);
  }

  const runtime = {
    step: 0,
    visitedNodes: [] as LangGraphNodeId[],
    transitionCount: 0,
  };

  const graph = new StateGraph(LangGraphJsStateAnnotation) as StateGraph<any, LangGraphEnvelope, Partial<LangGraphEnvelope>, string>;

  for (const nodeId of nodeIds) {
    graph.addNode(nodeId, async (envelope: LangGraphEnvelope) => {
      const currentState = envelope.state;

      if (params.options.shouldStop?.({ state: currentState, step: runtime.step })) {
        return new Command({
          update: { state: currentState },
          goto: END,
        });
      }

      const nextState = await params.handlers[nodeId]({
        state: currentState,
        context: params.options.context,
      });

      runtime.visitedNodes.push(nodeId);

      const nextNode = params.resolveNext({
        from: nodeId,
        state: nextState,
        context: params.options.context,
      });

      runtime.transitionCount += 1;
      params.options.onTransition?.({
        from: nodeId,
        to: nextNode,
        step: runtime.step,
        state: nextState,
      });
      runtime.step += 1;

      return new Command({
        update: { state: nextState },
        goto: nextNode ?? END,
      });
    }, {
      ends: [...nodeIds, END],
    });
  }

  graph.addEdge(START, params.initialNode);

  const compiled = graph.compile({
    name: 'muel-agent-graph-shadow',
    description: 'External LangGraph.js adapter for the internal agentGraph contract',
  });

  const output = await compiled.invoke(
    { state: params.initialState },
    { recursionLimit: maxSteps + 1 },
  ) as LangGraphEnvelope;

  return {
    finalState: output.state,
    visitedNodes: [...runtime.visitedNodes],
    transitionCount: runtime.transitionCount,
  };
};