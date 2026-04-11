// Barrel export — agent graph execution domain services
// NAMING NOTE: "LangGraph" here is a legacy internal label for a custom
// loop-based state machine. It is NOT LangChain's @langchain/langgraph library.
// Neutral canonical surface for new internal callers is "agentGraph".
// See docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md → Name Collision Matrix.
// Usage: import { executeAgentGraph, AgentGraphState } from '../langgraph';

// --- State contract ---
export * from './stateContract';
export type {
	LangGraphEdgeLabel as AgentGraphEdgeLabel,
	LangGraphNodeId as AgentGraphNodeId,
	LangGraphPlanItem as AgentGraphPlanItem,
	LangGraphState as AgentGraphState,
} from './stateContract';
export {
	appendTrace as appendAgentGraphTrace,
	createInitialLangGraphState as createInitialAgentGraphState,
	deriveEdgeLabelFromOutcome as deriveAgentGraphEdgeLabelFromOutcome,
} from './stateContract';

// --- Execution ---
export * from './executor';
export * from './langgraphjsAdapter';
export * from './shadowGraphRunner';
export type {
	LangGraphEdgeResolver as AgentGraphEdgeResolver,
	LangGraphExecutorOptions as AgentGraphExecutorOptions,
	LangGraphExecutorResult as AgentGraphExecutorResult,
	LangGraphNodeHandler as AgentGraphNodeHandler,
} from './executor';
export {
	createLinearEdgeResolver as createLinearAgentGraphEdgeResolver,
	executeLangGraph as executeAgentGraph,
} from './executor';
export {
	executeLangGraphWithLangGraphJs as executeAgentGraphWithLangGraphJs,
} from './langgraphjsAdapter';

// --- Nodes (key exports) ---
export * from './nodes/composeNodes';
export * from './nodes/coreNodes';
export * from './nodes/intentExemplarStore';
export * from './nodes/intentOutcomeAttributor';
export * from './nodes/intentSignalEnricher';
export * from './nodes/runtimeNodes';
export * from './nodes/strategyNodes';

// --- Runtime support ---
export * from './runtimeSupport/runtimeBudget';
export * from './runtimeSupport/runtimeEvaluation';
export * from './runtimeSupport/runtimeFormatting';
export * from './runtimeSupport/runtimeSessionState';

// --- Session runtime ---
export * from './sessionRuntime/branchRuntime';
export * from './sessionRuntime/fullReviewDeliberationNodes';
export * from './sessionRuntime/fullReviewNodes';
