// Barrel export — agent graph execution domain services
// NAMING NOTE: "LangGraph" here is an internal label for a custom loop-based
// state machine. It is NOT LangChain's @langchain/langgraph library.
// See docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md → Name Collision Matrix.
// Usage: import { executeGraph, GraphState } from '../langgraph';

// --- State contract ---
export * from './stateContract';

// --- Execution ---
export * from './executor';
export * from './shadowGraphRunner';

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
