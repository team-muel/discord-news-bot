# Muel Skillset Layer (v1)

## Scope Clarification

This document distinguishes four separate layers:

- external model/provider layer
- external runtime/tool layer
- repository-local runtime action layer
- repository-local collaboration label layer

Legacy internal labels such as OpenCode, OpenDev, NemoClaw, OpenJarvis, and Local Orchestrator belong to repository-local layers and must not be interpreted as external framework installation status.

Canonical naming and runtime surface source of truth:

- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`
- `docs/ROLE_RENAME_MAP.md`

Muel is now designed as a server-operations agent with a generic skill layer.

## Goals

- Keep orchestration simple: goal -> skill execution -> session state.
- Support multiple LLM providers (OpenAI, Gemini) without branching logic in bot commands.
- Support multiple LLM providers without branching logic in bot commands.
- Let users choose either:
  - Multi-agent pipeline mode (plan -> execution -> critique)
  - Single skill mode (`skillId` specified)

## Components

1. `src/services/llmClient.ts`

- Provider-agnostic text generation client.
- Resolution order:
  1. `AI_PROVIDER` if configured and key exists
  2. OpenAI key (`OPENAI_API_KEY`)
  3. Anthropic key (`ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`)
  4. Gemini key (`GEMINI_API_KEY` or `GOOGLE_API_KEY`)
  5. OpenClaw base URL (`OPENCLAW_BASE_URL`)
  6. Ollama model/base URL (`OLLAMA_MODEL`, `OLLAMA_BASE_URL`)

1. `src/services/skills/registry.ts`

- Built-in skill catalog and metadata.
- Current skills:
  - `ops-plan`
  - `ops-execution`
  - `ops-critique`
  - `guild-onboarding-blueprint`
  - `incident-review`
  - `webhook`

1. `src/services/skills/engine.ts`

- Normalized skill execution interface: `executeSkill(skillId, context)`.
- Supports specialized module dispatch:
  - `ops-plan` -> `src/services/skills/modules/opsPlan.ts`
  - `ops-execution` -> `src/services/skills/modules/opsExecution.ts`
  - `ops-critique` -> `src/services/skills/modules/opsCritique.ts`
  - `guild-onboarding-blueprint` -> `src/services/skills/modules/guildOnboardingBlueprint.ts`
  - `incident-review` -> `src/services/skills/modules/incidentReview.ts`
  - `webhook` -> `src/services/skills/modules/webhook.ts`

## Output Policy

- User-facing Muel request flow is result-first.
- Intermediate reasoning/process text is suppressed.
- Final response should contain deliverable-oriented output, not chain-of-thought style narration.
- Context engineering strategy for coding actions: `docs/CONTEXT_ENGINEERING_STRATEGY.md`.
- Harness playbook: `docs/HARNESS_ENGINEERING_PLAYBOOK.md`.
- Harness release gates: `docs/HARNESS_RELEASE_GATES.md`.

## Action Execution Path

- `ops-execution` follows a commercial-style action pipeline before LLM fallback:
  1. Action Planner: `src/services/skills/actions/planner.ts`
     1.1 Planner Rule Source: `docs/SKILL_ACTION_RULES.json` (intent-to-action mapping; editable without code changes)
  2. Action Registry: `src/services/skills/actions/registry.ts`
  3. Action Executor: `src/services/skills/actionRunner.ts`
  4. Action Logging: `src/services/skills/actionExecutionLogService.ts`
  5. Action Modules:
  - `youtube.search.first`
- Planner can return a chain (max 3 actions) and executor runs them sequentially.
- Retry and circuit-breaker are built-in for action reliability.
- Optional headless-browser path is available for YouTube via Playwright.
- If action execution is not applicable, it falls back to LLM-generated deliverable output.

1. `src/services/multiAgentService.ts`

- Session state machine.
- Supports pipeline mode and single-skill mode.
- Queue + retry + deadletter runtime included.

1. `src/services/agentPolicyService.ts`

- Governance layer for runtime limits and guardrails.
- Validates goal length and concurrent session caps.

1. `src/services/agentMemoryService.ts`

- Hybrid memory hint provider.
- Reads long-memory hints from Supabase (`guild_lore_docs`) and optional Obsidian integrations:
  - Runtime CLI execution (`OBSIDIAN_CLI_COMMAND`) for headless query
  - Markdown file wrapper fallback (`OBSIDIAN_VAULT_PATH`)

1. `src/services/agentSessionStore.ts`

- Best-effort persistence to Supabase (`agent_sessions`, `agent_steps`) for audit and long-term recall.

## Discord Interface

- `뮤엘 <요청>` 또는 `@Muel <요청>`
- `/해줘 요청:<text> [공개범위]` (호환 명령)
- `/시작 목표:<text> [공개범위]` (관리자: 운영용 작업을 직접 시작)
- `/상태` (런타임 상태 확인)
- `/온보딩` (관리자: 서버 기본 안내와 준비 작업 재실행)
- `/학습 [목표]`
- `/중지 작업아이디:<id>` (관리자: 진행 중인 작업 중지)

## API Interface

- `GET /api/bot/agent/skills`
- `GET /api/bot/agent/sessions?guildId=<id>&limit=<n>`
- `GET /api/bot/agent/sessions/:sessionId`
- `GET /api/bot/agent/policy`
- `POST /api/bot/agent/onboarding/run`
- `POST /api/bot/agent/learning/run`
- `POST /api/bot/agent/sessions` with body:
  - `guildId` (required)
  - `goal` (required)
  - `skillId` (optional)
  - `priority` (optional: `fast` | `balanced` | `precise`)
- `POST /api/bot/agent/sessions/:sessionId/cancel`
- `GET /api/bot/agent/deadletters`

## Environment

- `AI_PROVIDER` = `openai|gemini|anthropic|openclaw|ollama|local` (optional)
- `OPENAI_API_KEY` (optional)
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` (optional)
- `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` (optional)
- `OPENCLAW_BASE_URL` (optional)
- `OPENCLAW_API_KEY` (optional)
- `OLLAMA_MODEL` and `OLLAMA_BASE_URL` (optional)
- `OPENAI_ANALYSIS_MODEL` / `GEMINI_MODEL` (optional)
- `OBSIDIAN_VAULT_PATH` (optional)
- `OBSIDIAN_CLI_ENABLED` (optional)
- `OBSIDIAN_CLI_COMMAND` (optional)
- `OBSIDIAN_CLI_ARGS_JSON` (optional)
- `OBSIDIAN_CLI_TIMEOUT_MS` (optional)
- `OBSIDIAN_CLI_MAX_HINTS` (optional)
- `AGENT_MAX_CONCURRENT_SESSIONS` (optional)
- `AGENT_MAX_GOAL_LENGTH` (optional)
- `AGENT_AUTO_ONBOARDING_ENABLED` (optional)
- `AGENT_DAILY_LEARNING_ENABLED` (optional)
- `AGENT_DAILY_LEARNING_HOUR` (optional)
- `AGENT_DAILY_MAX_GUILDS` (optional)

## Notes

- If no LLM key is configured, skill execution fails with explicit config error.
- News monitor default is opt-in (`AUTOMATION_NEWS_ENABLED=false` by default).
- Session persistence is best-effort and requires optional tables (`agent_sessions`, `agent_steps`).
- Auto onboarding can run on guild join and daily learning can run on scheduled loop.
