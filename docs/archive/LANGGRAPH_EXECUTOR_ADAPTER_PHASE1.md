# LangGraph Executor Adapter - Phase 1

This phase introduces a minimal executor adapter to prepare migration from manual orchestration.

## Added

- `src/services/langgraph/executor.ts`
  - `executeLangGraph(...)`: generic node executor
  - `createLinearEdgeResolver(...)`: helper for fixed-order transitions
- `src/services/langgraph/executor.test.ts`
  - linear execution path test
  - early-stop behavior test

## Scope

- This phase does **not** replace current production runtime.
- Current runtime remains in `src/services/multiAgentService.ts`.
- Adapter is designed for incremental adoption in dual-run/shadow mode.
- Shadow replay hook is now wired at terminal stage behind env flags:
  - `LANGGRAPH_EXECUTOR_SHADOW_ENABLED`
  - `LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE`
  - `LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS`

## Next Integration Steps

1. Build an edge resolver that maps current policy/intent branches.
2. Replace replay-only handlers with real node wrappers (`compile_prompt`, `route_intent`, etc.).
3. Add side-by-side quality/latency diff logging to go/no-go weekly report.
