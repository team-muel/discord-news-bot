# Muel Skillset Layer (v1)

Muel is now designed as a server-operations agent with a generic skill layer.

## Goals

- Keep orchestration simple: goal -> skill execution -> session state.
- Support multiple LLM providers (OpenAI, Gemini) without branching logic in bot commands.
- Let users choose either:
  - Multi-agent pipeline mode (plan -> execution -> critique)
  - Single skill mode (`skillId` specified)

## Components

1. `src/services/llmClient.ts`

- Provider-agnostic text generation client.
- Resolution order:
  1. `AI_PROVIDER` if configured and key exists
  2. OpenAI key (`OPENAI_API_KEY`)
  3. Gemini key (`GEMINI_API_KEY` or `GOOGLE_API_KEY`)

2. `src/services/skills/registry.ts`

- Built-in skill catalog and metadata.
- Current skills:
  - `ops-plan`
  - `ops-execution`
  - `ops-critique`
  - `guild-onboarding-blueprint`
  - `incident-review`

3. `src/services/skills/engine.ts`

- Normalized skill execution interface: `executeSkill(skillId, context)`.

4. `src/services/multiAgentService.ts`

- Session state machine.
- Supports pipeline mode and single-skill mode.

5. `src/services/agentPolicyService.ts`

- Governance layer for runtime limits and guardrails.
- Validates goal length and concurrent session caps.

6. `src/services/agentMemoryService.ts`

- Hybrid memory hint provider.
- Reads long-memory hints from Supabase (`guild_lore_docs`) and optional Obsidian vault markdown wrappers.

7. `src/services/agentSessionStore.ts`

- Best-effort persistence to Supabase (`agent_sessions`, `agent_steps`) for audit and long-term recall.

## Discord Interface

- `/해줘 목표:<text> [스킬:<id>] [우선순위:빠름|균형|정밀] [공개범위]`
- `/시작 목표:<text> [스킬:<id>] [우선순위:빠름|균형|정밀] [공개범위]` (호환 명령)
- `/상태 [세션아이디]`
- `/스킬목록`
- `/정책`
- `/온보딩`
- `/학습 [목표]`
- `/중지 세션아이디:<id>`

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

## Environment

- `AI_PROVIDER` = `openai` or `gemini` (optional)
- `OPENAI_API_KEY` (optional)
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` (optional)
- `OPENAI_ANALYSIS_MODEL` / `GEMINI_MODEL` (optional)
- `OBSIDIAN_VAULT_PATH` (optional)
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
