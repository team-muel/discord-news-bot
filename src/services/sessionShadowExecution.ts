import { LANGGRAPH_EXECUTOR_SHADOW_ENABLED, LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE, LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS } from '../config';
import crypto from 'crypto';
import logger from '../logger';
import { appendTrace, type LangGraphNodeId, type LangGraphState } from './langgraph/stateContract';
import { executeLangGraph } from './langgraph/executor';
import { getErrorMessage } from '../utils/errorMessage';
import type { AgentSession, AgentSessionStatus } from './multiAgentTypes';

// Config imported from ../config — no process.env here

export const LANGGRAPH_NODE_IDS: LangGraphNodeId[] = [
  'ingest',
  'compile_prompt',
  'route_intent',
  'select_execution_strategy',
  'hydrate_memory',
  'plan_actions',
  'execute_actions',
  'critic_review',
  'requested_skill_run',
  'requested_skill_refine',
  'fast_path_run',
  'fast_path_refine',
  'full_review_plan',
  'full_review_execute',
  'full_review_critique',
  'full_review_tot',
  'hitl_review',
  'full_review_compose',
  'full_review_promote',
  'policy_gate',
  'compose_response',
  'persist_and_emit',
];

export const isLangGraphNodeId = (value: string): value is LangGraphNodeId => {
  return (LANGGRAPH_NODE_IDS as string[]).includes(value);
};

export const shouldRunLangGraphExecutorShadow = (sessionId: string): boolean => {
  if (!LANGGRAPH_EXECUTOR_SHADOW_ENABLED) {
    return false;
  }
  if (LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE >= 1) {
    return true;
  }
  if (LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE <= 0) {
    return false;
  }

  const digest = crypto.createHash('sha1').update(sessionId).digest('hex').slice(0, 8);
  const bucket = Number.parseInt(digest, 16) / 0xffffffff;
  return bucket < LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE;
};

export const runLangGraphExecutorShadowReplay = async (session: AgentSession, terminalStatus: AgentSessionStatus): Promise<void> => {
  if (!shouldRunLangGraphExecutorShadow(session.id)) {
    return;
  }

  const shadowGraph = session.shadowGraph;
  if (!shadowGraph || shadowGraph.trace.length === 0) {
    return;
  }

  const traceNodes = shadowGraph.trace
    .map((entry) => String(entry.node || '').trim())
    .filter(isLangGraphNodeId);
  if (traceNodes.length === 0) {
    return;
  }

  const replayNodes = traceNodes.slice(0, LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS);
  const handlers = LANGGRAPH_NODE_IDS.reduce((acc, node) => {
    acc[node] = async ({ state }) => appendTrace(state, node, 'executor_shadow_replay');
    return acc;
  }, {} as Record<LangGraphNodeId, (params: { state: LangGraphState; context: {} }) => Promise<LangGraphState>>);

  const initialState: LangGraphState = {
    ...shadowGraph,
    trace: [],
  };

  let cursor = 0;
  const startedAt = Date.now();
  try {
    const replayResult = await executeLangGraph({
      initialNode: replayNodes[0],
      initialState,
      handlers,
      resolveNext: () => {
        cursor += 1;
        return replayNodes[cursor] || null;
      },
      options: {
        context: {},
        maxSteps: replayNodes.length,
      },
    });

    const visited = replayResult.visitedNodes;
    const firstMismatch = visited.findIndex((node, index) => node !== replayNodes[index]);
    const matched = firstMismatch < 0 && visited.length === replayNodes.length;
    const elapsedMs = Date.now() - startedAt;

    if (matched) {
      logger.info(
        '[AGENT] langgraph executor shadow match session=%s status=%s nodes=%d elapsedMs=%d traceTruncated=%s',
        session.id,
        terminalStatus,
        visited.length,
        elapsedMs,
        traceNodes.length > replayNodes.length,
      );
      return;
    }

    logger.warn(
      '[AGENT] langgraph executor shadow mismatch session=%s status=%s mismatchAt=%d expected=%s actual=%s expectedNodes=%d visitedNodes=%d elapsedMs=%d',
      session.id,
      terminalStatus,
      firstMismatch,
      firstMismatch >= 0 ? replayNodes[firstMismatch] : 'n/a',
      firstMismatch >= 0 ? visited[firstMismatch] : 'n/a',
      replayNodes.length,
      visited.length,
      elapsedMs,
    );
  } catch (error) {
    logger.warn('[AGENT] langgraph executor shadow replay failed session=%s error=%s', session.id, getErrorMessage(error));
  }
};
