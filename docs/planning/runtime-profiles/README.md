# Runtime Profiles

These profiles are copy-paste templates for `.env` tuning.

Files:

- `low-latency.env`: fastest interactive responses.
- `balanced.env`: recommended default for mixed workloads.
- `quality-first.env`: stronger reasoning with higher latency budget.

Usage:

1. Pick one profile file.
2. Copy keys into your deployment environment.
3. Run `npm run env:check`.
4. Monitor p95 using `npm run perf:llm-latency`.
5. Generate weekly latency snapshot using `npm run perf:llm-latency:weekly`.

Notes:

- Keep `LLM_PROVIDER_POLICY_ACTIONS` aligned with action names emitted by runtime (`intent.route`, `tot.self_eval`, `planner.action_chain`, etc.).
- For Discord UX, keep `DISCORD_SESSION_PROGRESS_TIMEOUT_MS` close to your session timeout and avoid large drifts.
- Enable `LANGGRAPH_EXECUTOR_SHADOW_ENABLED=true` only for staged rollout; start with `LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE=0.1~0.2`.
- Weekly snapshot sinks default to `supabase,obsidian`; markdown generation is optional (`npm run perf:llm-latency:weekly:md`).
