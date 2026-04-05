# Architecture Changelog

Use this log for architecture-significant changes only.

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

## Template

Copy this block for each change:

```text
## YYYY-MM-DD - <change title>
- Why: <problem or risk being addressed>
- Scope: <modules/routes/services affected>
- Impacted Routes: <list or N/A>
- Impacted Services: <list>
- Impacted Tables/RPC: <list>
- Risk/Regression Notes: <key behavior changes>
- Validation: <tests/smoke commands run>
```

## Entries

## 2026-04-06 - Render Adapter + Platform Dashboard + Obsidian Headless Sync

- Why: 에이전트가 Render 인프라를 자율적으로 관리하고, 모든 플랫폼 상태를 시각적으로 모니터링하며, Obsidian Cloud와 서버 vault를 양방향 동기화한다.
- Scope: 12 files — `renderAdapter.ts` (new, 9 caps), `renderAdapter.test.ts` (new, 20 tests), `dashboard.ts` (new, visual HTML), `obsidian-headless-startup.sh` (new, startup sync), `app.ts`, `health.ts`, `bot.ts` (contracts), `externalAdapterRegistry.ts`, `externalAdapterTypes.ts`, `externalToolProbe.test.ts`, `render.yaml`, `.env.example`
- Impacted Routes: `GET /dashboard` (visual platform status page)
- Impacted Services: Render adapter (service/deploy/events/env management), Obsidian headless sync pipeline, health endpoint (vault readiness), dashboard (adapter chain + capability routing)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Render adapter read-only by default (env.update requires explicit call). Headless sync gracefully degrades if `ob` CLI unavailable. Dashboard is public (no auth) — shows only operational metadata, no secrets.
- Validation: 36/36 tests passed, tsc clean, live API verified (7/7 Render capabilities).

## 2026-04-06 - M-15 Pluggable Adapter Framework

- Why: 기존 ExternalAdapterId가 closed union literal (`'openshell' | 'nemoclaw' | 'openclaw' | 'openjarvis'`)이라 새 어댑터를 추가할 때마다 타입 파일 수정이 필요했다. 동적 어댑터 등록과 glob scan 자동 발견으로 확장성을 확보한다.
- Scope: 7 files — `externalAdapterTypes.ts`, `externalAdapterRegistry.ts`, `adapterAutoLoader.ts` (new), `externalToolProbe.test.ts`, `runtimeBootstrap.ts` → `bootstrapServerInfra.ts`, `generate-onboarding-checklist.mjs`, `package.json`
- Impacted Routes: N/A
- Impacted Services: `externalAdapterTypes.ts` (branded string ID + `ADAPTER_ID_PATTERN` + `validateAdapterId` + `KNOWN_ADAPTER_IDS`), `externalAdapterRegistry.ts` (`registerExternalAdapter`/`unregisterExternalAdapter`), `adapterAutoLoader.ts` (glob scan + duck-type check), `bootstrapServerInfra.ts` (startup auto-load)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 기존 4개 built-in 어댑터 호환 유지. built-in ID 덮어쓰기/해제 차단.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (151 files, 1365 tests), `npm run tools:onboarding` dry run 검증.

## 2026-04-05 - Phase F+G+H Autonomous Agent Evolution Loop

- Why: 에이전트의 자율 진화를 위해 환경 스캔(F) → 의도 형성(G) → 신뢰 기반 자율 실행(H) 3단계 루프를 구축한다.
- Scope: 30+ files — `src/services/observer/` (11 files), `src/services/intent/` (5 files), `src/services/sprint/trustScoreService.ts`, `src/services/runtime/signalBusWiring.ts`, `src/services/runtime/bootstrapServerInfra.ts`, config, migration SQL, profile env
- Impacted Routes: `src/routes/bot-agent/intentRoutes.ts` (Phase G API)
- Impacted Services: Observer (6 channels + orchestrator + store), Intent Formation (6 rules + engine + store), Progressive Trust (trust score computation + trust decay + loop breaker)
- Impacted Tables/RPC: `observations` (Phase F), `intents` (Phase G), `agent_trust_scores` (Phase H)
- Risk/Regression Notes: 모든 Phase는 env flag로 통제 (OBSERVER_ENABLED, INTENT_FORMATION_ENABLED, TRUST_ENGINE_ENABLED). 기본값 비활성화. production-pilot.profile.env에서 활성화.
- Validation: 1365 tests passed, tsc clean.

## 2026-04-04 - Observer Layer: Autonomous Environment Scanning (Phase F)

- Why: Agent 자율 진화를 위해 환경(에러 패턴, 메모리 갭, LLM 성능 드리프트, 코드 건강도, 수렴 추세, Discord 활동량)을 주기적으로 스캔하고 위험 신호를 자동 감지하는 계층이 필요했다.
- Scope: 11 files — `src/services/observer/` 전체 디렉토리 (types, orchestrator, store, 7 channels)
- Impacted Routes: N/A (internal scanning layer)
- Impacted Services: `src/services/observer/observerOrchestrator.ts` (주기적 스캔 코디네이터 + 신호 발신), `observationStore.ts` (Supabase 영속화 + in-memory fallback), `errorPatternChannel.ts` (런타임 에러 클러스터링), `memoryGapChannel.ts` (오래된/저신뢰 메모리 탐지), `perfDriftChannel.ts` (LLM latency/cost 회귀), `codeHealthChannel.ts` (TypeScript 타입체크 에러), `convergenceDigestChannel.ts` (수렴 리포트 래핑), `discordPulseChannel.ts` (길드 활동량 모니터링)
- Impacted Tables/RPC: `scripts/migrations/008_observer_layer.sql` (pending migration)
- Risk/Regression Notes: 미커밋 상태. 스캐닝은 fire-and-forget이며 핵심 응답 경로를 블로킹하지 않음. 각 channel은 독립적으로 비활성화 가능.
- Validation: 미커밋 — 컴파일은 기존 빌드에 포함되지 않음.

## 2026-04-04 - Platform Signal Bus: In-Process Event Hub

- Why: "Supabase에 쓰고 누가 읽기를 기대하는" 패턴을 즉시 인프로세스 신호 전파로 대체하여 eval 루프, go/no-go, convergence, memory quality, workflow 이벤트를 sprint trigger, runtime alert, traffic routing에 즉시 연결한다.
- Scope: 3 files — `src/services/runtime/signalBus.ts`, `signalBusWiring.ts`, `signalBus.test.ts`
- Impacted Routes: N/A (runtime internal event bus)
- Impacted Services: `signalBus.ts` (17개 시그널 타입, typed payload, async fire-and-forget, cooldown/dedup, diagnostics snapshot), `signalBusWiring.ts` (producer→consumer 자동 배선)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 리스너는 비동기이며 producer를 블로킹하지 않음. `SIGNAL_BUS_ENABLED` env로 통제.
- Validation: 미커밋 — 로컬 테스트 존재.

## 2026-04-04 - Bot Auto-Recovery Service

- Why: Discord gateway 연결 끊김이나 예상치 못한 크래시 이후 수동 개입 없이 봇이 자동 복구되어야 하는 운영 요구사항.
- Scope: 2 files — `src/services/runtime/botAutoRecoveryService.ts`, `botAutoRecoveryService.test.ts`
- Impacted Routes: N/A (runtime lifecycle)
- Impacted Services: `botAutoRecoveryService.ts` (자동 복구 로직), `runtimeBootstrap.ts`에서 소비
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 복구 실패 시 기존 프로세스 재시작 경로(pm2/Render)로 폴백.
- Validation: 미커밋 — 로컬 테스트 존재.

## 2026-04-04 - [UNCOMMITTED] Workflow Persistence + Traffic Routing Service

- Why: A/B 트래픽 라우팅 결정 및 워크플로 이벤트를 영속화하여, sprint/session 실행 경로의 관찰 가능성과 회귀 분석을 지원한다.
- Scope: 4 files — `src/services/workflow/trafficRoutingService.ts`, `trafficRoutingService.test.ts`, `workflowPersistenceService.ts`, `workflowPersistenceService.test.ts`
- Impacted Routes: N/A (consumed by multiAgentService, sprintOrchestrator)
- Impacted Services: `trafficRoutingService.ts` (트래픽 라우팅 결정 + 영속화), `workflowPersistenceService.ts` (워크플로 이벤트 기록)
- Impacted Tables/RPC: `scripts/migrations/007_workflow_traffic_routing.sql` (pending migration — `workflow_sessions`, `workflow_steps`, `workflow_events`)
- Risk/Regression Notes: 미커밋 상태. `TRAFFIC_ROUTING_ENABLED` env 통제. 미설정 시 기존 경로에 영향 없음.
- Validation: 미커밋 — 로컬 테스트 존재.

## 2026-04-04 - [UNCOMMITTED] Security Pipeline Orchestrator

- Why: OWASP Top 10 기반 보안 스캔을 코드 레벨에서 자동화하기 위한 파이프라인.
- Scope: 1 file — `src/services/security/securityPipelineOrchestrator.ts`
- Impacted Routes: N/A (consumed by `scripts/generate-security-candidates.ts`)
- Impacted Services: `securityPipelineOrchestrator.ts` (보안 후보 탐지 + STRIDE 위협 모델 자동화)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 스캔 전용, 런타임 동작 변경 없음.
- Validation: 미커밋.

## 2026-04-04 - [UNCOMMITTED] Sprint Event Sourcing + Metrics Collector + Worker Router

- Why: 스프린트 파이프라인의 관찰 가능성 강화를 위해 이벤트 소싱 기반 상태 추적, 위상 메트릭 수집, 외부 어댑터 라우터를 분리한다.
- Scope: 5+ files — `src/services/sprint/eventSourcing/` (bridge), `sprintMetricsCollector.ts`, `sprintWorkerRouter.ts`, `sprintDiffSummarizer.ts`
- Impacted Routes: N/A (sprint internal)
- Impacted Services: `eventSourcing/bridge.ts` (pipeline/phase/file/cancel/block 이벤트 발행), `sprintMetricsCollector.ts` (phase 타이밍, loop-back 카운트), `sprintWorkerRouter.ts` (PHASE_WORKER_KIND, PHASE_EXTERNAL_ADAPTER, circuit breaker, secondary adapter 매핑), `sprintDiffSummarizer.ts` (diff → 구조적 변경 요약 생성)
- Impacted Tables/RPC: `scripts/migrations/011_ventyd_event_sourcing.sql` (pending)
- Risk/Regression Notes: 미커밋 상태. sprintOrchestrator에서 이미 import 중이나 git에 미추적.
- Validation: 미커밋 — sprintDiffSummarizer.test.ts 존재.

## 2026-04-04 - [UNCOMMITTED] MCP Unified Server + Obsidian Tool Adapter

- Why: 여러 MCP 서버(기본, 인덱싱, Obsidian)를 단일 진입점으로 통합하고, Obsidian 볼트 조작을 MCP 도구로 노출한다.
- Scope: 5 files — `src/mcp/unifiedServer.ts`, `src/mcp/unifiedToolAdapter.ts`, `unifiedToolAdapter.test.ts`, `src/mcp/obsidianToolAdapter.ts`, `obsidianToolAdapter.test.ts`, `scripts/unified-mcp-stdio.ts`
- Impacted Routes: N/A (MCP stdio transport)
- Impacted Services: `unifiedServer.ts` (MCP 라우터 통합), `unifiedToolAdapter.ts` (ext.* MCP bridge 포함), `obsidianToolAdapter.ts` (vault search/read/write/backlinks 도구)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. MCP stdio 서버는 IDE 연결 전용이며 런타임에 영향 없음.
- Validation: 미커밋 — 테스트 파일 존재.

## 2026-04-04 - [UNCOMMITTED] Agent Collab Decomposition + Guild Analytics + n8n Delegation

- Why: `agentCollab.ts`가 600+ 줄로 비대해져 역할별/기능별 분리 필요. 길드 분석과 n8n 위임도 독립 모듈로 추출.
- Scope: 10+ files — `src/services/skills/actions/agentCollabHelpers.ts`, `agentCollabJarvis.ts`, `agentCollabOrchestrator.ts`, `agentCollabRoles.ts`, `agentCollabSprint.ts`, `guildAnalytics.ts`, `n8n.ts`, `src/services/automation/n8nDelegationService.ts` + 테스트
- Impacted Routes: `src/routes/bot-agent/crmRoutes.ts` (new)
- Impacted Services: 기존 `agentCollab.ts`의 기능을 역할 기반 모듈로 분리
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 기존 agentCollab export는 유지되며 내부 분해만 진행.
- Validation: 미커밋 — guildAnalytics.test.ts, n8n.test.ts, n8n.delegation.test.ts 존재.

## 2026-04-04 - [UNCOMMITTED] Shared Utilities: Circuit Breaker, Discord Channel Meta, Vector Math

- Why: 여러 서비스에서 반복되던 circuit breaker 패턴, Discord 채널 메타데이터 추출, 벡터 연산을 공유 유틸리티로 추출한다.
- Scope: 6 files — `src/utils/circuitBreaker.ts`, `circuitBreaker.test.ts`, `discordChannelMeta.ts`, `discordChannelMeta.test.ts`, `vectorMath.ts`, `errorMessage.ts`
- Impacted Routes: N/A
- Impacted Services: `circuitBreaker.ts` (actionRunner + sprintWorkerRouter의 인라인 CB 대체), `discordChannelMeta.ts` (채널/스레드 메타 표준화), `vectorMath.ts` (코사인 유사도 등)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. sprintOrchestrator, multiAgentService 등에서 이미 import 중.
- Validation: 미커밋 — 각 테스트 파일 존재.

## 2026-04-04 - Obsidian Native CLI Adapter + Graph-First Retrieval + Advanced Integrations

- Why: Obsidian CLI 1.12.7+ native 어댑터를 도입하여 검색/backlinks/read/write/graph_metadata를 CLI 네이티브로 지원하고, graph connectivity 기반 검색 점수 부스트, 레트로 결과 자동 볼트 기록, 2-hop 그래프 탐색, 반응형 학습 루프, 지식 갭 탐지, daily note 자동화, Discord↔Obsidian 태스크 브릿지를 구현한다.
- Scope: 10+ files — `src/services/obsidian/adapters/nativeCliAdapter.ts` (new, 350 lines), `obsidianRagService.ts` (graph-first boost, writeRetroToVault, 2-hop traversal, reactive learning, gap detection, daily note, task bridge), `router.ts`, `scripts/audit-obsidian-graph.ts`, `src/discord/commands/tasks.ts` (new), `src/discord/commands/docs.ts`, `src/discord/messages.ts`
- Impacted Routes: N/A (Discord commands + internal services)
- Impacted Services: `nativeCliAdapter.ts` (CLI adapter), `obsidianRagService.ts` (5개 advanced feature 추가), `router.ts` (native CLI 라우팅)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: native CLI 미설치 시 기존 어댑터 체인으로 자동 폴백. 반응형 학습 루프는 fire-and-forget. 지식 갭 리포트는 threshold 도달 시만 기록.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (670 tests passed), `nativeCliAdapter.test.ts` (21 new tests).

## 2026-04-04 - M-18 Platform Lightweighting Phase B

- Why: pg_cron 이관 확대(login cleanup, obsidian sync, SLO check)와 중복 코드 통합(searchMemoryHybrid 3개 호출자 → 1개 공유 헬퍼)으로 런타임 경량화를 진행한다.
- Scope: 11 files — pgCronBootstrapService, agentMemoryService, agentMemoryStore, agentSloService, memoryEvolutionService, obsidianLoreSyncService, platformLightweightingService, runtimeSchedulerPolicyService, render.yaml
- Impacted Routes: N/A
- Impacted Services: `pgCronBootstrapService.ts` (login/obsidian/SLO cron 추가), `agentMemoryStore.ts` (searchMemoryHybrid 공유 헬퍼), `agentMemoryService.ts` (중복 검색 로직 제거), `memoryEvolutionService.ts` (중복 검색 로직 제거)
- Impacted Tables/RPC: pg_cron 스케줄 3개 추가
- Risk/Regression Notes: owner toggle(`OBSIDIAN_SYNC_LOOP_OWNER`, `AGENT_SLO_ALERT_LOOP_OWNER`, `DISCORD_LOGIN_SESSION_CLEANUP_OWNER`)로 app/db 위임 전환 가능.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (97 files, 635 tests passed).

## 2026-04-03 - M-11 Intent Intelligence Layer (Exemplar Store, Signal Enricher, Outcome Attributor)

- Why: 인텐트 분류 정확도를 대화 턴, 소셜 시그널, 시간 특성으로 강화하고, 세션 종료 시 outcome을 intent에 귀속시켜 분류 정확도 피드백 루프를 구축한다.
- Scope: 10 files — `src/services/langgraph/nodes/intentExemplarStore.ts` (new), `intentSignalEnricher.ts` (new), `intentOutcomeAttributor.ts` (new), `coreNodes.ts` (enriched signal intent classification), `agentRuntimeTypes.ts` (AgentIntentSignal type), `multiAgentService.ts` (intent attribution on session close), `conversationTurnService.ts` (recent turn query), + 3 test files
- Impacted Routes: N/A (internal classification pipeline)
- Impacted Services: `intentExemplarStore.ts` (Supabase-backed exemplar CRUD + bootstrap), `intentSignalEnricher.ts` (대화턴+소셜시그널+시간 feature 결합), `intentOutcomeAttributor.ts` (세션 outcome → intent 정확도 피드백), `coreNodes.ts` (enriched signals + exemplar matching으로 분류 개선)
- Impacted Tables/RPC: `intent_exemplars` (new table via schema)
- Risk/Regression Notes: Exemplar store 미구축 시 기존 규칙 기반 분류로 폴백. Attribution은 세션 종료 후 비동기 best-effort.
- Validation: `npx tsc --noEmit` (0 errors), 3개 신규 테스트 파일.

## 2026-04-03 - M-12/M-13 External Tool Adapters: OpenShell Sandbox + OpenJarvis Bench + OpenClaw Relay

- Why: 외부 도구 어댑터를 stub에서 실사용 가능한 수준으로 확대. OpenShell sandbox 정책 동기화, OpenJarvis bench JSON 파서, OpenClaw session relay를 구현한다.
- Scope: 10 files — `openshellCliAdapter.ts` (sandbox create/exec/policy), `openjarvisAdapter.ts` (bench --json parser, optimize trigger), `openclawCliAdapter.ts` (session relay, channel routing), `actionRunner.ts` (sandbox delegation path), `opencode.ts` (sandbox-first execution + fallback), + 3 adapter test files, `externalAdapterTypes.ts`
- Impacted Routes: N/A (tool execution layer)
- Impacted Services: `openshellCliAdapter.ts`, `openjarvisAdapter.ts`, `openclawCliAdapter.ts`, `actionRunner.ts` (implement.execute → sandbox delegation), `opencode.ts` (sandbox-first)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 각 어댑터는 CLI 미설치 시 skip/fallback. Sandbox delegation은 `OPENSHELL_ENABLED` 미설정 시 기존 경로 유지.
- Validation: `npx tsc --noEmit` (0 errors), 3개 신규 어댑터 테스트.

## 2026-04-03 - M-11 Self-Improvement Loop + Sprint Learning Enhancements

- Why: 주간 auto-judge 결과와 sprint retro에서 자동으로 개선 패턴을 추출하고, 검증된 패턴을 다음 sprint에 주입하는 자기 개선 루프를 구축한다.
- Scope: 8 files — `src/services/sprint/selfImprovementLoop.ts` (new, 613 lines), `selfImprovementLoop.test.ts` (new), `sprintOrchestrator.ts` (retro 단계 통합), `sprintTriggers.ts` (auto-improve trigger), `sprintPreamble.ts` (improvement context 주입), `sprintLearningJournal.ts`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`
- Impacted Routes: N/A (sprint internal + ops automation)
- Impacted Services: `selfImprovementLoop.ts` (패턴 영속화, 회귀 검증, 개선 적용), `sprintOrchestrator.ts` (retro → self-improvement 연결)
- Impacted Tables/RPC: Supabase에 개선 패턴 영속화 (기존 sprint_pipelines 확장)
- Risk/Regression Notes: Self-improvement은 retro 단계 이후에만 실행. 패턴 적용은 검증 통과 후에만 활성화.
- Validation: `npx tsc --noEmit` (0 errors), `selfImprovementLoop.test.ts` (200 lines).

## 2026-04-03 - M-13 Discord Runtime + OpenClaw Channel Bridge

- Why: OpenClaw gateway를 Discord 런타임에 통합하고, 채널 수준 라우팅 정책을 추가하여 멀티 채널 에이전트 실행을 지원한다.
- Scope: 13 files — `src/bot.ts` (OpenClaw gateway hook), `runtimeRoutes.ts` (channel routing/policy sync/self-improvement admin), `runtimePolicy.ts` (channel-level routing), `discord/auth.ts`, `discord/session.ts` (OpenClaw session relay), `passiveMemoryCapture.ts` (enhanced signal capture), `config.ts` (OpenClaw config entries)
- Impacted Routes: `src/routes/bot-agent/runtimeRoutes.ts` (channel routing, policy sync, self-improvement endpoints)
- Impacted Services: `bot.ts`, `runtimePolicy.ts`, `runtimeRoutes.ts`, `passiveMemoryCapture.ts`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: OpenClaw gateway가 미설정 시 기존 단일 채널 동작 유지. 채널 라우팅 정책은 opt-in.
- Validation: docs regenerated (DEPENDENCY_GRAPH, ROUTES_INVENTORY, SCHEMA_SERVICE_MAP).

## 2026-04-04 - Sprint Pipeline External OSS Capability Expansion (고도화)

- Why: 외부 OSS 6개(OpenClaw, OpenJarvis, NemoClaw, OpenShell, DeepWiki, n8n) 33개 capability 중 18%만 사용 중이었다. 복합 실행(secondary adapter), enrichment 확대, OpenClaw session bootstrap, ext.* MCP bridge를 도입해 capability 활용률을 70%+로 확대한다.
- Scope: 8 files — sprintPreamble.ts, sprintWorkerRouter.ts, sprintOrchestrator.ts, openclawCliAdapter.ts, unifiedToolAdapter.ts, circuitBreaker.ts (new shared util), + 3 test files
- Impacted Routes: N/A (sprint internal pipeline only)
- Impacted Services: `src/services/sprint/sprintPreamble.ts` (PHASE_ENRICHMENT_MAP ~12→28 enrichment actions), `src/services/sprint/sprintWorkerRouter.ts` (PhaseAdapterMapping type with `secondary` field, buildSecondaryAdapterArgs), `src/services/sprint/sprintOrchestrator.ts` (secondary adapter composite execution, OpenClaw bootstrap), `src/services/tools/adapters/openclawCliAdapter.ts` (bootstrapOpenClawSession), `src/mcp/unifiedToolAdapter.ts` (ext.* MCP bridge), `src/utils/circuitBreaker.ts` (new shared CB replacing inline duplicates in actionRunner + sprintWorkerRouter)
- Impacted Tables/RPC: N/A (no schema changes)
- Risk/Regression Notes: Secondary adapter 실패는 primary 결과에 영향 없음 (append-only). OpenClaw bootstrap은 sessionId 기준 idempotent. ext.* bridge는 기존 MCP 라우팅에 `ext.` prefix로 네임스페이스 격리. OPENSHELL_ENABLED/N8N_ENABLED 미설정 시 해당 secondary/enrichment 자동 skip.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (130 files, 1152 tests passed)

## 2026-04-06 - M-17 Infrastructure Optimization + Services Subdirectory Restructure Phase 2

- Why: (1) setInterval 기반 스케줄러를 Supabase pg_cron으로 이관해 단일 진실 원천 통합. (2) Obsidian wikilink 그래프를 Supabase에 동기화해 graph-first retrieval 강화. (3) ollama/litellm-admin/mcp-indexing 어댑터 추가로 외부 도구 커버리지 확대. (4) Planner 반복 목표에 TTL pattern cache 적용. (5) services/ 디렉토리 6개 도메인 서브디렉토리 분리 (eval/, infra/, memory/, news/, obsidian/, trading/).
- Scope: 113 files — 13 new, ~40 renamed/moved, ~60 import path updates
- Impacted Routes: `src/routes/bot-agent/` (memoryRoutes, qualityPrivacyRoutes, rewardEvalRoutes, runtimeRoutes), `src/routes/trades.ts`, `src/routes/trading.ts`
- Impacted Services: `src/services/infra/pgCronBootstrapService.ts` (new), `src/services/tools/adapters/{ollamaAdapter,litellmAdminAdapter,mcpIndexingAdapter}.ts` (new), `src/services/eval/index.ts`, `src/services/infra/index.ts`, `src/services/memory/index.ts`, `src/services/news/index.ts`, `src/services/obsidian/index.ts`, `src/services/trading/index.ts` (new barrels), `scripts/sync-obsidian-lore.ts` (wikilink extraction), `src/services/skills/actions/planner.ts` (pattern cache)
- Impacted Tables/RPC: `ensure_pg_cron_job` (new RPC via migration SQL), `memory_item_links` (graph sync writes)
- Risk/Regression Notes: 런타임 동작 변경 없음 for subdirectory moves. pg_cron migration SQL은 Supabase SQL editor에서 수동 실행 필요. Pattern cache는 `PLANNER_PATTERN_CACHE_ENABLED` env로 opt-in.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (97 files, 635 tests passed).

## 2026-04-02 - M-10 Codebase Health: Agent Services Subdirectory Restructure

- Why: `src/services/` flat directory에 100+ 파일이 혼재해 탐색이 어려웠다. agent 관련 25개 서비스 + 9개 테스트를 `src/services/agent/`로 분리하여 도메인 경계를 명확히 한다.
- Scope: 34개 파일을 `src/services/` → `src/services/agent/`로 이동. 33개 외부 파일의 import 경로, 11개 `vi.mock()` 경로, 동적 `import()` 및 인라인 타입 참조를 일괄 수정.
- Impacted Routes: `src/routes/bot-agent/` (6개 route 파일 import 경로 변경)
- Impacted Services: `src/services/agent/*` (25 source + 9 test), `src/bot.ts`, `src/services/multiAgentService.ts`, `src/services/multiAgentTypes.ts`, `src/services/runtimeBootstrap.ts`, `src/services/runtimeSchedulerPolicyService.ts`, `src/services/langgraph/` (6 files), `src/services/skills/actionRunner.ts`, `src/services/skills/actions/` (2 files), `src/discord/` (4 files)
- Impacted Tables/RPC: N/A (import path changes only)
- Risk/Regression Notes: 런타임 동작 변경 없음. import 경로만 변경. 모든 export/import이 동일한 모듈을 참조.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (88 files, 550 tests passed), `npm run docs:build`, `npm run docs:check`.

## 2026-03-27 - Entity Nervous System Feedback Circuits

- Why: Discord 안에서 동작하는 자율 진화 엔티티라는 목표에 맞춰, 기존의 분리된 루프들을 감각→기억, 보상→행동, 자기 성찰→자기 수정의 닫힌 피드백 회로로 연결할 필요가 있었다.
- Scope: added `entityNervousSystem` integration service, wired session terminal state into `durable_extraction` memory jobs, connected reward snapshot persistence to behavior adjustment, and persisted retro optimize/failure insights as self-notes injected into subsequent agent memory hints.
- Impacted Routes: N/A (runtime/service boundary and persistence change only).
- Impacted Services: `src/services/entityNervousSystem.ts`, `src/services/multiAgentService.ts`, `src/services/rewardSignalService.ts`, `src/services/agentMemoryService.ts`, `src/services/sprint/sprintOrchestrator.ts`, `src/services/entityNervousSystem.test.ts`.
- Impacted Tables/RPC: `public.entity_self_notes` (new), `public.memory_jobs`, `public.agent_tot_policies`, `public.retrieval_ranker_active_profiles`, `public.reward_signal_snapshots`.
- Risk/Regression Notes: session 종료 후 memory precipitation과 reward-based adjustment는 best-effort 비동기 경로로 연결되어 기존 핵심 응답 경로를 블로킹하지 않는다. `entity_self_notes` 미적용 환경에서는 self-note 주입만 비활성화되고 기존 memory hint 경로는 유지된다.
- Validation: `npx tsc --noEmit`, `npx vitest run`, `npm run docs:build`, `npm run docs:check`.

## 2026-03-27 - Reward Signal Normalization + A/B Eval Auto-Promote + Shadow Graph Runner + Embedding Context Selection

- Why: 자율 진화 아키텍처의 4개 구조적 기반을 동시에 도입한다. (1) Discord reactions, session outcomes, citation rates, LLM latency를 단일 보상 스칼라로 정규화. (2) baseline vs candidate config A/B 평가 + 자동 승격 파이프라인. (3) LangGraph 세션의 대안 노드 핸들러를 shadow 실행하여 divergence를 감지. (4) 메모리 힌트 하이브리드 검색(vector+lexical)으로 전환.
- Scope: 6 new files — `rewardSignalService.ts`, `rewardSignalService.test.ts`, `evalAutoPromoteService.ts`, `evalAutoPromoteService.test.ts`, `langgraph/shadowGraphRunner.ts`, `shadowGraphRunner.test.ts`, + `agentMemoryService.ts` 변경. Migration: `005_reward_signal_and_eval.sql`
- Impacted Routes: N/A (service layer only)
- Impacted Services: `rewardSignalService.ts` (가중치 기반 보상 블렌딩, 스냅샷 영속화, 추세 분석), `evalAutoPromoteService.ts` (eval run 생성, 보상 샘플 수집, LLM judge, 자동 승격), `shadowGraphRunner.ts` (병렬 shadow 실행, divergence 감지/로깅), `agentMemoryService.ts` (hybrid search 전환)
- Impacted Tables/RPC: `reward_signal_snapshots` (new), `eval_runs` (new), `shadow_graph_divergence_logs` (new), `search_memory_items_hybrid` RPC 활용
- Risk/Regression Notes: Shadow runner는 `SHADOW_GRAPH_RUNNER_ENABLED=false` 기본값으로 log-only(트래픽 영향 없음). Eval auto-promote는 threshold 미달 시 기존 config 유지. Hybrid search는 embedding 미존재 시 classic ilike 폴백.
- Validation: `npx tsc --noEmit`, `npx vitest run`.

## 2026-03-23 - Discord Login Rate-Limit Startup Log Downgrade

- Why: Render 부팅 시 Discord session start 429가 이미 보호 동작으로 처리되고 있었지만, 시작 경로 로그가 `error` 위주로 남아 운영자가 실제 장애와 rate-limit cooldown 상태를 구분하기 어려웠다.
- Scope: Discord login rate-limit 에러를 시작 경로에서 별도 식별해 `warn` 레벨로 기록하도록 조정했다. 프로세스 생존, cooldown 보존, auto/manual recovery 제어 동작은 유지한다.
- Impacted Routes: N/A (runtime logging only)
- Impacted Services: `src/bot.ts`, `server.ts`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: 로그 레벨만 조정되며, 비-rate-limit 로그인 실패는 기존처럼 `error`로 유지된다.
- Validation: `npm run lint`.

## 2026-03-23 - Unattended Weekly Report Missing-Table Fail-Open Guard

- Why: `openjarvis-unattended` 스케줄 워크플로가 아직 적용되지 않은 Supabase 주간 리포트 테이블과 소스 스냅샷 부재를 hard fail로 취급해, 운영 자동화 자체가 불필요하게 실패하고 있었다.
- Scope: unattended 주간 리포트 경로에서 `agent_llm_call_logs` 및 `agent_weekly_reports` 누락 시 skip 처리 가드를 추가하고, GitHub Actions 스케줄 워크플로에 해당 fail-open 환경 플래그를 주입했다. 함께 stale 상태였던 dependency graph 산출물을 갱신했다.
- Impacted Routes: N/A (ops automation and generated docs only)
- Impacted Services: `scripts/generate-llm-latency-weekly-report.mjs`, `scripts/generate-hybrid-weekly-report.mjs`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `.github/workflows/openjarvis-unattended.yml`, `docs/DEPENDENCY_GRAPH.md`.
- Impacted Tables/RPC: reads `public.agent_llm_call_logs`, `public.agent_weekly_reports`.
- Risk/Regression Notes: 기본 CLI 동작은 fail-closed를 유지하고, unattended 워크플로에서만 환경 플래그로 skip 허용을 활성화한다. 따라서 수동 점검이나 로컬 검증 경로의 엄격성은 유지된다.
- Validation: `npm run lint`, `npm run docs:build`, `npm run docs:check` (stale diff root cause confirmed to `docs/DEPENDENCY_GRAPH.md` before staging updated artifact).

## 2026-03-21 - External Tool Layer Integration Plan (NemoClaw, OpenShell, OpenClaw, OpenJarvis, Nemotron)

- Why: 내부 역할 라벨(nemoclaw, openjarvis 등)을 실제 외부 OSS 도구로 연결하는 Tool Layer 통합 시작. NVIDIA NemoClaw(★14.5k), OpenShell(★2.8k), OpenClaw(openclaw.ai), Stanford OpenJarvis(★1.6k), Nemotron 모델을 로컬 IDE Tool Layer로 통합하여 recursive/self-learning 자율 에이전트 파이프라인을 구축한다. OpenJarvis는 Stanford Scaling Intelligence Lab(Hazy Research, Christopher Ré, John Hennessy)의 로컬 우선 개인 AI 프레임워크로, 5-primitive composable stack (Intelligence, Engine, Agents, Tools & Memory, Learning)을 제공하며 trace 기반 self-learning loop(자동 최적화)을 내장한다.
- Scope: 신규 `EXTERNAL_TOOL_INTEGRATION_PLAN.md` 생성, `RUNTIME_NAME_AND_SURFACE_MATRIX.md` External Name Reference 및 Surface Matrix 업데이트, `LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`에 구체적 adapter 인터페이스(OpenShell/NemoClaw/OpenClaw/OpenJarvis) 추가, `litellm.config.yaml`에 `muel-nemotron` 모델 등록, `scripts/bootstrap-external-tools.sh` readiness 체크 스크립트 생성.
- Impacted Routes: N/A (planning/documentation/config phase)
- Impacted Services: `litellm.config.yaml` (muel-nemotron entry + fallback chain), future `src/services/tools/adapters/` (openshellCliAdapter, nemoclawCliAdapter, openclawCliAdapter, openjarvisAdapter).
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: (1) litellm.config.yaml에 muel-nemotron 추가는 `NVIDIA_NIM_API_KEY` 미설정 시 해당 모델만 호출 실패하며 기존 모델에 영향 없음. (2) 외부 도구 adapter는 아직 stub/계획 단계이며, 기존 in-process 역할 실행 경로에 영향 없음. (3) 모든 외부 도구는 선택적(optional)이며 미설치 시 기존 폴백 경로 유지.
- Validation: `npm run -s lint`, `bash scripts/bootstrap-external-tools.sh --check-only` (readiness surface 확인).

## 2026-03-21 - Quality Metric Wiring & Null Coercion Fix (Retrieval Eval Fallback + resolveMetric)

- Why: auto-judge weekly quality gate가 영구 `pending`(source-only quality 샘플 0건) 상태였고, `null ?? '' → Number('') → 0` 버그로 데이터 없는 메트릭이 실제 값 0으로 전달되어 잘못된 pass/fail 판정이 발생했음. Retrieval eval 데이터(82건, recall@k=0.1026)가 존재함에도 quality gate에 연결되지 않았음.
- Scope: `scripts/auto-judge-from-weekly.mjs` — strategy_quality_normalization fallback 배선, `resolveMetric` 헬퍼 도입, per-action latency 진단 출력, `top_actions` select 추가.
- Impacted Routes: N/A (ops automation only)
- Impacted Services: `scripts/auto-judge-from-weekly.mjs`.
- Impacted Tables/RPC: reads `public.agent_weekly_reports` (`top_actions` column now selected; `baseline_summary.strategy_quality_normalization` consumed as quality fallback).
- Risk/Regression Notes: (1) Quality gate가 `pending` → `fail`로 전환될 수 있음 (retrieval recall이 threshold 미달 시). 이는 의도된 정직 신호. (2) Safety metrics가 서버 미연결 시 `0` → `null`(pending)로 변경됨 — 이전에는 null→0 변환 버그로 잘못 pass/fail 판정. (3) `hasRetrievalEvalFallback=true` 시 historical gate verdict override를 건너뛰고 gate 자연 평가 적용.
- Validation: `npm run -s lint`, `npx vitest run` (6/6), `npm run -s gates:validate` (35건), `npm run -s gates:fixtures:check`, `npm run -s gates:weekly-report:all:dry` (7단계 통과).

## 2026-03-21 - Weekly Auto-Judge Metric Mapping Fix (Self-Reference + Unit Mismatch)

- Why: weekly auto-judge가 go/no-go weekly 집계의 `no_go` 카운트를 `error_rate_pct`로, LLM delta를 절대 p95로 오용하여 실제 운영 상태와 무관한 no-go를 반복 생성했고, quality 입력이 자기 참조 루프(weekly:auto 산출물 → 다음 주 judge 입력)에 의해 0으로 고정되는 문제가 있었음.
- Scope: `scripts/auto-judge-from-weekly.mjs`의 reliability/quality 입력 매핑을 수정하고, `scripts/summarize-go-no-go-runs.mjs`에 source-only `auto_judge_signal_summary`를 추가해 weekly:auto 파생 run이 다음 주기 judge 입력을 오염하지 않게 했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/auto-judge-from-weekly.mjs`, `scripts/summarize-go-no-go-runs.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads/writes `public.agent_weekly_reports` (`report_kind=go_no_go_weekly` `baseline_summary.auto_judge_signal_summary` added).
- Risk/Regression Notes: 기존 weekly auto-judge 결과에서 error_rate_pct 해석이 달라져 이전 run과 직접 비교 시 차이가 나타남. quality gate override 우선순위가 변경되어 insufficientSamples가 fail보다 앞선다.
- Validation: `npm run -s lint`, `npx vitest run src/services/runtimeSchedulerPolicyService.test.ts src/services/agentWorkerApprovalGateSnapshotService.test.ts`, `npm run -s gates:validate`, `npm run -s gates:fixtures:check`, `npm run -s gates:weekly-report:all:dry`.

## 2026-03-21 - Neutral Role Alias Compatibility Layer

- Why: 문서에서 정의한 neutral 내부 역할명으로 점진 전환할 수 있도록, legacy 이름을 즉시 제거하지 않고 런타임이 양쪽 이름을 모두 수용하게 만들기 위함.
- Scope: added neutral action aliases, neutral worker/env alias resolution, local worker script aliases, and runtime role normalization while preserving legacy action contracts.
- Impacted Routes: `GET /api/bot/agent/actions/catalog`, `POST /api/bot/agent/actions/execute`, `GET /api/bot/agent/runtime/role-workers`.
- Impacted Services: `src/services/skills/actions/types.ts`, `src/services/skills/actions/registry.ts`, `src/services/workerExecution.ts`, `src/services/skills/actionExecutionLogService.ts`, `src/routes/bot-agent/governanceRoutes.ts`, `src/services/agentRoleWorkerService.ts`, `src/services/skills/actions/mcpDelegate.ts`, `scripts/agent-role-worker.ts`, `scripts/check-agent-role-workers.mjs`, `scripts/validate-env.mjs`, `package.json`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: legacy names remain the canonical persisted/logged runtime roles for compatibility, while neutral aliases are accepted for action lookup, worker startup, and env resolution.
- Validation: `npm run lint`, targeted Vitest coverage for alias registration and env alias resolution.

## 2026-03-21 - Collaboration Boundary Documentation Realignment

- Why: 역할 이름, IDE 커스터마이징, 실제 런타임 액션, 향후 로컬 외부 도구 통합 설계가 서로 다른 층위인데도 문서상 한 덩어리처럼 읽히던 문제를 줄이기 위함.
- Scope: clarified customization-vs-runtime boundaries in architecture, operations, runbook, planning, env template, and `.github` collaboration files; added a dedicated planning document for future local external tool adapter architecture.
- Impacted Routes: N/A (documentation only).
- Impacted Services: `docs/ARCHITECTURE_INDEX.md`, `docs/OPERATIONS_24_7.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/planning/README.md`, `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`, `.github/instructions/multi-agent-routing.instructions.md`, `.github/agents/*.agent.md`, `.github/prompts/local-collab-*.prompt.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: no runtime behavior change; intent is to reduce operator and developer confusion by making runtime truth depend on action registration, worker configuration, and runtime endpoints rather than role naming.
- Validation: editor diagnostics on touched markdown/customization files and consistency review against runtime action/worker surfaces.

## 2026-03-21 - Super Agent Facade Initial Slice

- Why: 계획된 슈퍼 에이전트 구현을 한 번에 전면 교체하지 않고, 기존 `multiAgentService` 위에 구조화된 목표 입력과 lead/consult 추천을 제공하는 안전한 facade로 시작하기 위함.
- Scope: added `superAgentService` with structured task recommendation and session start delegation, added admin API endpoints for capabilities/recommendation/session start, and documented the new facade in the architecture index.
- Impacted Routes: `GET /api/bot/agent/super/capabilities`, `POST /api/bot/agent/super/recommend`, `POST /api/bot/agent/super/sessions`.
- Impacted Services: `src/services/superAgentService.ts`, `src/services/superAgentService.test.ts`, `src/routes/bot-agent/coreRoutes.ts`, `docs/ARCHITECTURE_INDEX.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: existing `startAgentSession` execution path remains the runtime owner; the new facade only normalizes structured input into a session goal and recommendation payload, so rollback is limited to removing the facade routes and service.
- Validation: targeted service tests and editor diagnostics for touched route/service/docs files.

## 2026-03-21 - Super Agent Contract Alignment

- Why: Phase 1 계획에 맞춰 supervisor 입력 계약을 `task_id`, `guild_id`, `objective`, `constraints`, `risk_level`, `acceptance_criteria`, `inputs`, `budget` 중심으로 고정하고, route/control-plane 출력과 runtime session 매핑을 분리하기 위함.
- Scope: `superAgentService` now normalizes snake_case supervisor envelopes, emits `task`, `route`, `runtime_mapping` 구조를 반환하며, super-agent routes prefer snake_case request payloads while keeping camelCase compatibility.
- Impacted Routes: `POST /api/bot/agent/super/recommend`, `POST /api/bot/agent/super/sessions`.
- Impacted Services: `src/services/superAgentService.ts`, `src/services/superAgentService.test.ts`, `src/routes/bot-agent/coreRoutes.ts`.
- Impacted Docs: `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, `docs/ARCHITECTURE_INDEX.md`.
- Risk/Regression Notes: newly added super-agent endpoints changed response shape to expose contract-aligned `task`, `route`, `runtime_mapping`; existing stable agent session APIs are unchanged.
- Validation: focused Vitest coverage for snake_case/camelCase normalization and runtime delegation, plus diagnostics on touched files.

## 2026-03-21 - Local Collaborative Agent Control Plane Contracts

- Why: 로컬 IDE에서는 rigid sequential handoff보다 lead + consult 방식이 더 생산적이지만, 기존 runtime handoff 구조와 어긋나지 않도록 prompt/customization 계약을 스키마 수준으로 고정할 필요가 있었다.
- Scope: added local collaborative contract schemas, connected local-collab customization docs to runtime architecture docs, and clarified that local collaborative prompts are control-plane guidance over the existing multi-agent runtime.
- Impacted Routes: N/A (customization/docs only)
- Impacted Services: `.github/instructions/multi-agent-routing.instructions.md`, `.github/agents/local-orchestrator.agent.md`, `.github/prompts/local-collab-route.prompt.md`, `.github/prompts/local-collab-consult.prompt.md`, `.github/prompts/local-collab-synthesize.prompt.md`, `docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json`, `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, `docs/planning/MULTI_AGENT_NODE_EXTRACTION_TARGET_STATE.md`, `docs/ARCHITECTURE_INDEX.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: no runtime behavior change; the new schemas are intended to stabilize prompt outputs and future supervisor alignment without replacing existing `multiAgentService` or `ActionHandoff` contracts.
- Validation: customization file validation via editor diagnostics, schema/doc consistency review against `src/services/multiAgentService.ts`, `src/services/skills/actions/types.ts`, `src/services/workerExecution.ts`, and `src/services/skills/actionExecutionLogService.ts`.

## 2026-03-21 - MCP Indexing Server + Code Index Service

- Why: IDE에서 코드베이스 구조(심볼, 참조, 스코프)를 MCP 프로토콜로 노출하여, 에이전트가 코드 탐색과 분석을 정밀하게 수행할 수 있게 한다.
- Scope: 5 new files — `src/mcp/indexingServer.ts` (MCP stdio 서버, 106 lines), `src/mcp/indexingToolAdapter.ts` (도구 어댑터, 226 lines), `indexingToolAdapter.test.ts`, `src/services/codeIndexService.ts` (코드 인덱스 서비스, 1071 lines), `scripts/indexing-mcp-stdio.ts`
- Impacted Routes: N/A (MCP stdio transport, IDE 전용)
- Impacted Services: `codeIndexService.ts` (심볼 정의/참조 탐색, 파일 아웃라인, 스코프 읽기, 컨텍스트 번들), `indexingServer.ts` (MCP 프로토콜 라우팅), `indexingToolAdapter.ts` (도구 인터페이스 정규화)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: MCP stdio 서버는 IDE 연결 전용이며 런타임 프로세스에 영향 없음. 별도 프로세스로 실행.
- Validation: `indexingToolAdapter.test.ts` (228 lines).

## 2026-03-20 - Static Worker Endpoint Baseline and Cutover Runbooks

- Why: GCP worker를 실제 운영 경로로 붙인 뒤에도 IP 변동과 임시 도메인 의존으로 인한 drift를 줄이고, Render/도메인/원격 추론 분리 절차를 같은 기준으로 남기기 위함.
- Scope: reserved the current GCP worker IP as static, updated Render deployment env baseline to require the remote worker, corrected architecture-index provider docs, and added domain/inference split runbooks.
- Impacted Routes: N/A (deployment/docs/config only)
- Impacted Services: `render.yaml`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/GCP_OPENCODE_WORKER_VM_DEPLOY.md`, `docs/planning/GCP_REMOTE_INFERENCE_NODE.md`, `docs/planning/README.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: Render service now has an explicit remote worker dependency in the deployment definition; temporary `sslip.io` usage remains acceptable short-term but should be replaced by a custom domain before broader rollout.
- Validation: reserved static IP `34.56.232.61` in GCP, verified existing HTTPS worker health, and confirmed local hybrid dry-run remains passing before doc/config sync.

## 2026-03-20 - Local-First Hybrid Inference + Remote Autonomy Guardrails

- Why: 로컬 머신이 켜져 있을 때는 Ollama 우선 추론으로 품질/속도를 높이고, 운영 환경에서는 OpenJarvis unattended autonomy와 원격 worker fail-closed 정책을 동시에 유지하기 위함.
- Scope: added configurable LLM base provider order, introduced `local-first-hybrid` env profile, extended env validation for hybrid guardrails, and synchronized operator docs/runbook/env template.
- Impacted Routes: N/A (provider selection / ops profile / docs only)
- Impacted Services: `src/services/llmClient.ts`, `src/services/llmClient.test.ts`, `scripts/validate-env.mjs`, `scripts/apply-env-profile.mjs`, `config/env/local-first-hybrid.profile.env`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/LOCAL_FIRST_HYBRID_AUTONOMY.md`, `docs/planning/README.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: local-first profile without remote fallback provider or without `MCP_OPENCODE_WORKER_URL` now fails validation earlier, preventing accidental local-only drift in unattended paths.
- Validation: `npm run -s lint`, `npx vitest run src/services/llmClient.test.ts`, `npm run -s env:profile:local-first-hybrid:dry`, `npm run -s env:check`.

## 2026-03-20 - GCP VM Worker Deployment Baseline

- Why: GCP VM를 이미 확보한 상태에서 `opencode.execute`를 로컬 PC 전원 상태와 분리해 운영하기 위한 최소 배포 아티팩트를 제공하기 위함.
- Scope: added worker Dockerfile, GCP VM env example, systemd unit example, and deployment runbook for the HTTP opencode worker.
- Impacted Routes: N/A (deployment artifacts only)
- Impacted Services: `Dockerfile.opencode-worker`, `config/env/opencode-worker.gcp.env.example`, `config/systemd/opencode-local-worker.service.example`, `docs/planning/GCP_OPENCODE_WORKER_VM_DEPLOY.md`, `docs/planning/README.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `package.json`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: worker remains fail-closed by URL contract; deployment still requires operator-managed firewall, TLS, and process supervision on GCP VM.
- Validation: `npm run -s lint`.

## 2026-03-20 - Canonical Document Hierarchy Confirmation

- Why: reduce planning drift by making document ownership explicit at the top of the canonical roadmap, execution board, backlog, runbook, operations, and architecture index.
- Scope: added document-role labels and canonical navigation order across planning and operations docs; confirmed control tower precedence language.
- Impacted Routes: N/A (documentation only)
- Impacted Services: `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/OPERATIONS_24_7.md`, `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`, `docs/planning/EXECUTION_BOARD.md`, `docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md`, `docs/planning/README.md`, `docs/planning/PLATFORM_CONTROL_TOWER.md`, `docs/ARCHITECTURE_INDEX.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: no runtime behavior change; intent is to remove ambiguity about where direction, status, task breakdown, and operating procedure live.
- Validation: manual hierarchy review against `docs/planning/PLATFORM_CONTROL_TOWER.md` and canonical references in the touched docs.

## 2026-03-19 - Weekly Governance Normalization (Legacy Pending Exclusion + Required-Action Completion + Quality Sample Guard)

- Why: no-go 원인 분석과 운영 후속조치 추적을 주간 스냅샷에 내장하고, sparse quality sample(0값)로 인한 weekly auto-judge 오판정을 줄이며, legacy pending no-go를 현재 운영 KPI에서 분리하기 위함.
- Scope: go/no-go 주간 집계 스크립트에 no-go root cause 및 required action completion 집계를 추가하고, legacy pending 보정 옵션 + normalized 별도 산출물을 도입했으며, weekly auto-judge에 최소 quality sample 가드와 quality fail 시 post-fallback 재판정 체인을 추가했다. 또한 self-improvement 주간 패턴 생성이 no-go root cause/후속조치 완료율 신호를 사용하도록 확장했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`, `docs/planning/ROADMAP_STATUS_2026-03-19.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=go_no_go_weekly` baseline summary fields expanded: `no_go_root_cause`, `required_action_completion`, `legacy_pending_*`).
- Risk/Regression Notes: normalized 모드(`excludeLegacyPendingNoGo`)를 활성화하면 요약 KPI가 raw 집계와 달라질 수 있으므로 cutoff를 명시해 운영자가 비교해야 한다.
- Validation: `npm run -s gates:weekly-report:dry`, `npm run -s gates:weekly-report:normalized:dry`, `npm run -s gates:weekly-report:supabase`, `npm run -s gates:auto-judge:weekly:pending`, `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s gates:validate:strict`.

## 2026-03-19 - Remote-Only OpenJarvis Autonomy Baseline Enforcement

- Why: 로컬 의존 0 목표를 운영 기본값으로 고정하고, OpenJarvis unattended 루프가 원격 워커 미연결 상태에서 우회 실행되지 않도록 fail-closed를 강화하기 위함.
- Scope: unattended workflow env를 remote-only 필수값으로 확장하고, 런타임/런북/env 템플릿을 동일 정책으로 동기화했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `.github/workflows/openjarvis-unattended.yml`, `scripts/run-openjarvis-unattended.mjs`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/planning/REMOTE_ONLY_AUTONOMY_IMPLEMENTATION.md`, `docs/planning/README.md`.
- Impacted Tables/RPC: `public.workflow_sessions`, `public.workflow_steps`, `public.workflow_events`, `public.agent_weekly_reports` (운영 검증 대상으로 명시).
- Risk/Regression Notes: GitHub Actions에서 신규 secret 미설정 시 unattended run이 실패하도록 변경되어 초기 설정 누락이 즉시 드러난다(의도된 fail-closed).
- Validation: `npm run -s openjarvis:autonomy:run:dry`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - Stage Rollback Readiness Checklist Auto-Validation Gate

- Why: Later 단계(M-08)의 rollback runbook 자동 점검 체크리스트 운영화를 코드/CI 게이트로 강제해 리허설 증거의 신선도와 10분 목표 준수 여부를 자동 검증하기 위함.
- Scope: rollback rehearsal weekly summary를 읽어 freshness/fail count/p95 recovery SLA를 검증하는 스크립트를 추가하고 strict 체인/CI에 연결했다.
- Impacted Routes: N/A (ops automation/CI only)
- Impacted Services: `scripts/validate-stage-rollback-readiness.mjs`, `package.json`, `.github/workflows/main.yml`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A (markdown artifact validation only)
- Risk/Regression Notes: 주간 리허설 요약이 오래되면 strict gate가 fail-closed로 차단되며, `allowZeroRuns` 플래그로 무증거 환경에서의 초기 도입 리스크를 완화한다.
- Validation: `npm run -s rehearsal:stage-rollback:validate:strict`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - M-05 Opencode Pilot Signals in Self-Improvement Weekly Report

- Why: approval_required 고정 파일럿이 운영 중 실제로 준수되는지 주간 루프에서 자동 점검하고, 승인 큐 적체를 패치 제안으로 연결하기 위함.
- Scope: self-improvement weekly 스크립트가 opencode.execute 실행 로그와 승인 요청 테이블을 집계해 pilot signal 섹션 및 관련 failure pattern을 생성하도록 확장했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-self-improvement-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_action_logs`, `public.agent_action_approval_requests` (or configured `ACTION_APPROVAL_TABLE`).
- Risk/Regression Notes: approval table 미존재 시 missing_table 상태로 degrade하여 리포트를 유지하고, 기존 weekly snapshot 필수 입력 계약은 변경하지 않는다.
- Validation: `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s lint`.

## 2026-03-19 - M-07 Strategy Quality Normalization Metrics in Go/No-Go Weekly Snapshot

- Why: ToT/GoT + baseline 간 품질 추세를 주간 의사결정 스냅샷에서 직접 비교할 수 있도록 정규화 계측값을 영속화한다.
- Scope: go-no-go weekly summary 스크립트가 retrieval_eval_runs + answer quality reviews를 집계해 전략별 normalized quality score와 delta를 markdown/weekly payload에 추가한다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.retrieval_eval_runs`, `public.agent_answer_quality_reviews`; writes `public.agent_weekly_reports` (`report_kind=go_no_go_weekly`, `baseline_summary.strategy_quality_normalization`).
- Risk/Regression Notes: quality source table 미존재 시 missing_table/no_supabase_config 상태로 degrade하여 기존 주간 집계 fail-closed 계약을 깨지 않는다.
- Validation: `npm run -s gates:weekly-report:supabase:dry`, `npm run -s lint`.

## 2026-03-19 - M-07 Labeled Quality Weekly Signals in Self-Improvement Loop

- Why: Next 단계의 M-07 요구사항(라벨 기반 recall@k + hallucination review 자동 리포트)을 기존 주간 self-improvement 체인에 통합해 품질 회귀를 자동 탐지한다.
- Scope: self-improvement weekly 스크립트가 retrieval eval run summary와 human-labeled answer quality review를 읽어 Labeled Quality Signals 섹션과 신규 failure pattern을 생성하도록 확장했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-self-improvement-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.retrieval_eval_runs`, `public.agent_answer_quality_reviews`.
- Risk/Regression Notes: 품질 테이블 미구축 환경에서도 리포트가 중단되지 않도록 missing_table 상태로 degrade 하며, 기존 weekly snapshot 필수 입력(go/llm/hybrid)은 기존 fail-closed를 유지한다.
- Validation: `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s lint`.

## 2026-03-19 - No-Request Missing-Action Proposal Queue + Opencode Approval-Required Pilot Lock

- Why: Close M-03/M-05 운영 공백을 줄이기 위해 요청 공백 구간에서도 누락 액션을 자동 제안 큐로 전환하고, Opencode executor를 approval_required로 고정해 safety gate를 강제한다.
- Scope: bot runtime에 background worker proposal sweep 루프와 opencode policy 자동 보정 로직을 추가했다.
- Impacted Routes: N/A (runtime automation only)
- Impacted Services: `src/bot.ts`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_action_logs`; uses worker approval store (`worker_approvals` or file fallback) to dedupe/cooldown/pending cap.
- Risk/Regression Notes: background sweep은 Supabase 미설정 시 자동 비활성화되며, 생성 품질가드(최근 generation success rate)와 중복/쿨다운 제한으로 과잉 제안을 차단한다.
- Validation: `npm run -s lint`.

## 2026-03-19 - Memory Queue SLO Alert Auto-Trigger (Incident/Comms Draft)

- Why: Close M-08 operational gap by automatically turning queue lag/retry/deadletter threshold breaches into actionable incident/comms evidence.
- Scope: extended memory queue weekly report script with SLO breach evaluation, severity/no-go candidate classification, and automatic alert artifact generation for incident/comms drafts.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/report-memory-queue-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=memory_queue_weekly` baseline now includes `slo_alert`).
- Risk/Regression Notes: alerts are artifact-level automation (no external paging side effects); dry-run keeps preview-only behavior.
- Validation: `npm run -s memory:queue:report:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - Provider Profile Auto-Fallback on Quality Gate Failure

- Why: Close remaining M-06/M-07 gap by making provider profile regression deterministic when weekly quality evidence degrades.
- Scope: extended go/no-go weekly summary with per-gate verdict counts, added quality override input and provider fallback decision fields in auto-judge, wired weekly auto-judge to trigger fallback when quality fails are present, and added stable-window dual profile hinting (`cost-optimized`) for M-06 operations.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `scripts/auto-judge-go-no-go.mjs`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads/writes `public.agent_weekly_reports` (`report_kind=go_no_go_weekly` `baseline_summary.gate_verdict_counts` used as weekly auto-judge signal).
- Risk/Regression Notes: quality override is applied only when weekly aggregation includes gate verdict evidence; weekly quality averages are derived from structured gate metrics and remain nullable when historical logs lack those fields.
- Validation: `npm run -s gates:weekly-report:supabase`, `npm run -s gates:auto-judge:weekly:pending`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - Auto-Judge Checklist Auto-Close and Weekly Chain Integration

- Why: Remove remaining manual operator step after automated no-go decisions by auto-generating closure evidence and pre-closing post-decision checklist items.
- Scope: added auto checklist completion and optional closure document creation in auto-judge; weekly-derived auto-judge now enables these options by default; all-weekly pipeline now chains weekly auto-judge at tail.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/auto-judge-go-no-go.mjs`, `scripts/auto-judge-from-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A (gate md/json artifact generation only for this change)
- Risk/Regression Notes: checklist auto-close applies only when enabled and skips pending decisions; generated closure files are date-scoped and reusable as evidence references.
- Validation: `npm run -s gates:auto-judge:weekly:pending`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - CI Strict Gate Enforcement + Weekly-Derived Auto-Judge Profiles

- Why: Reduce governance drift by enforcing strict checklist validation in CI and deriving gate decisions from weekly operational snapshots with stage-aware thresholds.
- Scope: enabled strict checklist gate in CI workflow, added weekly-derived auto-judge script and npm commands, and upgraded auto-judge with stage/profile presets plus rollback/memory deadletter signals.
- Impacted Routes: N/A (ops automation/CI/documentation only)
- Impacted Services: `.github/workflows/main.yml`, `scripts/auto-judge-go-no-go.mjs`, `scripts/auto-judge-from-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_weekly_reports` for `go_no_go_weekly`, `llm_latency_weekly`, `rollback_rehearsal_weekly`, `memory_queue_weekly`.
- Risk/Regression Notes: weekly-derived auto-judge may produce fail when upstream weekly snapshots are stale; this is intended fail-closed behavior.
- Validation: `npm run -s gates:auto-judge:example`, `npm run -s gates:auto-judge:weekly:pending`, `npm run -s lint`, `npm run -s gates:validate:strict`.

## 2026-03-19 - Memory Queue Weekly Snapshot Integration into Hybrid/Self-Improvement

- Why: Extend roadmap automation so queue/deadletter pressure directly influences weekly decision snapshots and patch proposal generation.
- Scope: expanded memory queue weekly report to support supabase sink (`memory_queue_weekly`), integrated rollback/memory signals into hybrid decision logic, and made self-improvement require/consume rollback+memory snapshots.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/report-memory-queue-weekly.mjs`, `scripts/generate-hybrid-weekly-report.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=memory_queue_weekly` read/write; hybrid and self-improvement read path expanded).
- Risk/Regression Notes: Self-improvement weekly now fails fast if rollback/memory snapshots are missing in the target window, with local markdown fallback used when Supabase snapshots are unavailable; rollback/memory writers can skip upsert when DB report_kind constraint is not yet migrated.
- Validation: `npm run -s memory:queue:report:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s lint`, `npm run -s gates:validate`.

## 2026-03-19 - Go/No-Go Strict Checklist Validation Gate

- Why: Enforce R-008 operational discipline by preventing recent gate runs from passing with incomplete post-decision checklist items.
- Scope: extended go/no-go validator with optional checklist enforcement window and added strict npm command/docs.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/validate-go-no-go-runs.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: strict mode is opt-in; default validation behavior remains backward compatible for historical fixtures.
- Validation: `npm run -s gates:validate`, `npm run -s gates:validate:strict`.

## 2026-03-19 - Week2 Queue Deliverables Closure (Policy + Deadletter SOP + Observability)

- Why: Close remaining Week2 checklist artifacts by turning queue/deadletter operations into explicit policy docs and executable weekly observability reporting.
- Scope: added memory queue policy and deadletter SOP docs, added weekly queue observability report script, and wired npm commands/planning index/checklist.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/report-memory-queue-weekly.mjs`, `package.json`, `docs/planning/MEMORY_QUEUE_POLICY_V1.md`, `docs/planning/MEMORY_DEADLETTER_SOP_V1.md`, `docs/planning/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md`.
- Impacted Tables/RPC: reads `public.memory_jobs`, `public.memory_job_deadletters`.
- Risk/Regression Notes: reporting is read-only and fail-closed when Supabase credentials are missing (except dry-run preview).
- Validation: `npm run -s memory:queue:report:dry`, `npm run -s lint`, `npm run -s gates:validate`.

## 2026-03-19 - Stage Rollback Rehearsal Evidence Automation (R-017)

- Why: Close roadmap item R-017 by making rollback rehearsal results reproducible, persisted, and auditable with a 10-minute recovery target check.
- Scope: added rollback rehearsal recorder and weekly summary scripts; wired npm commands; synchronized runbook/gate docs and migration report_kind allowlist.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/run-stage-rollback-rehearsal.mjs`, `scripts/summarize-rollback-rehearsals.mjs`, `package.json`, `docs/planning/gate-runs/README.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=rollback_rehearsal_weekly`).
- Risk/Regression Notes: Dry-run mode emits preview artifacts without calling runtime endpoints; real mode remains fail-closed on rehearsal failure.
- Validation: `npm run -s rehearsal:stage-rollback:record:dry`, `npm run -s gates:weekly-report:rollback:dry`, `npm run -s lint`.

## 2026-03-19 - Go/No-Go Gate Auto-Judge Rule Implementation

- Why: Close roadmap item R-016 by replacing manual-only stage decision interpretation with a reproducible threshold-based auto-judge flow.
- Scope: added `scripts/auto-judge-go-no-go.mjs`, npm commands (`gates:auto-judge`, `gates:auto-judge:example`), and gate-runs README usage docs.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/auto-judge-go-no-go.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A (writes gate markdown/json logs under docs planning artifacts).
- Risk/Regression Notes: Missing metric inputs default to fail (or pending with allowPending) to avoid false-positive go decisions.
- Validation: `npm run -s gates:auto-judge:example`, `npm run -s gates:validate`.

## 2026-03-19 - Self-Improvement Loop v1 Automation (Failure Pattern -> Patch Proposal)

- Why: Operationalize roadmap item M-05 by converting weekly failures into executable patch proposals with explicit regression checks.
- Scope: added `scripts/generate-self-improvement-weekly.mjs`, new npm commands (`gates:weekly-report:self-improvement`, `gates:weekly-report:self-improvement:dry`), and expanded `gates:weekly-report:all` to include self-improvement generation.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-self-improvement-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_weekly_reports` snapshots (`go_no_go_weekly`, `llm_latency_weekly`, `hybrid_weekly`) as source signals.
- Risk/Regression Notes: script fails fast if any source snapshot is missing in the target window to avoid partial/low-confidence proposals.
- Validation: `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Hybrid Weekly Snapshot Automation (go/no-go + latency)

- Why: Consolidate weekly gate and latency outcomes into one decision artifact for roadmap governance and faster operator triage.
- Scope: added `scripts/generate-hybrid-weekly-report.mjs`, npm commands (`gates:weekly-report:hybrid`, `gates:weekly-report:hybrid:dry`), and promoted `gates:weekly-report:all` to include hybrid snapshot generation.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-hybrid-weekly-report.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=hybrid_weekly`).
- Risk/Regression Notes: Hybrid report requires both `go_no_go_weekly` and `llm_latency_weekly` source snapshots in the same window; if missing, script fails fast to prevent partial governance evidence.
- Validation: `npm run -s gates:weekly-report:hybrid:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Go/No-Go Weekly Report Supabase Sink Integration

- Why: Persist governance weekly decision snapshots into Supabase so roadmap/gate evidence can be queried and audited from a single storage plane.
- Scope: extended `scripts/summarize-go-no-go-runs.mjs` with sink routing (`markdown|supabase|stdout`), optional Supabase upsert to `public.agent_weekly_reports`, and added npm shortcuts/docs for supabase and dry-run paths.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (upsert, `report_kind=go_no_go_weekly`).
- Risk/Regression Notes: Default behavior remains markdown output; supabase sink is opt-in and fail-safe when table missing under allow-missing mode.
- Validation: `npm run -s gates:weekly-report:dry`, `npm run -s gates:weekly-report:supabase:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Weekly Report All-Pipeline Default Promotion

- Why: Make roadmap governance snapshots durable by default in weekly automation, not markdown-only best effort.
- Scope: promoted `gates:weekly-report:all` to execute `gates:weekly-report:supabase` before LLM latency weekly sink run; updated runbook snippet in gate-runs README.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (default weekly write path includes `go_no_go_weekly` + `llm_latency_weekly`).
- Risk/Regression Notes: Existing dry-run behavior preserved; if table is missing, go/no-go sink follows allow-missing mode and logs explicit skip reason.
- Validation: `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Opencode/NemoClaw/OpenDev Execution Plan Integration

- Why: Align newly expanded execution-board milestones with an explicit 3-layer delivery plan and ownership model.
- Scope: added `docs/planning/OPENCODE_NEMOCLAW_OPENDEV_EXECUTION_PLAN.md`, synchronized planning index, and reflected milestone-level additions in execution board.
- Impacted Routes: N/A (planning/governance documentation only)
- Impacted Services: N/A (no runtime code-path changes)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime regression; planning clarity improved for M-04/M-05/M-06 scope ownership.
- Validation: `npm run -s gates:validate`, `npm run -s gates:weekly-report -- --days=7`.

## 2026-03-19 - Go/No-Go Weekly Summary Refresh and Stage Evidence Consolidation

- Why: Keep governance reporting in sync with newly accumulated stage evidence and prevent stale operational decisions.
- Scope: regenerated `docs/planning/gate-runs/WEEKLY_SUMMARY.md` to include recent A-stage and trading-isolation runs.
- Impacted Routes: N/A (ops reporting artifact only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `scripts/validate-go-no-go-runs.mjs` (execution output sync)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime behavior changes; operator decision context now reflects latest gate outcomes.
- Validation: `npm run -s gates:weekly-report -- --days=7`, `npm run -s gates:validate`.

## 2026-03-18 - Agent Route Domain Split Completion and Verification Gates

- Why: Complete `/api/bot/agent/*` domain-level route decomposition safely and prevent regressions from future route movement.
- Scope: moved agent route implementations into `src/routes/bot-agent/*Routes.ts`, converted `src/routes/botAgentRoutes.ts` to composer-only registration, added modular route verification script and route smoke tests, and updated route inventory generator to include nested route files.
- Impacted Routes: `/api/bot/agent/*` (no contract change; source files moved from monolithic module to domain modules).
- Impacted Services: `src/routes/botAgentRoutes.ts`, `src/routes/bot-agent/coreRoutes.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/bot-agent/gotRoutes.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/routes/bot-agent/governanceRoutes.ts`, `src/routes/bot-agent/memoryRoutes.ts`, `src/routes/bot-agent/learningRoutes.ts`, `scripts/verify-bot-agent-routes.mjs`, `scripts/generate-route-inventory.mjs`.
- Impacted Tables/RPC: N/A (routing surface and tooling only).
- Risk/Regression Notes: route registration ordering is now explicitly module-driven; duplicate path registration is gate-checked by script and smoke test.
- Validation: `npm run routes:check:agent`, `npm run docs:routes`, `npm run test -- src/routes/botAgentRoutes.smoke.test.ts`, `npm run lint`.

## 2026-03-18 - Bot Route Modularization and Runtime Bootstrap Consolidation

- Why: Reduce control-plane complexity by splitting oversized bot route composition, clarifying startup boundaries, and lowering env misconfiguration risk.
- Scope: extracted `/api/bot/agent/*` route registration to dedicated module, introduced centralized runtime bootstrap service, and added deployment-profile-based env validation.
- Impacted Routes: `/api/bot/agent/*` (no contract change, composition moved), `/api/bot/status`, `/api/bot/automation/:jobName/run`, `/api/bot/reconnect`, `/api/bot/usage`.
- Impacted Services: `src/routes/bot.ts`, `src/routes/botAgentRoutes.ts`, `src/services/runtimeBootstrap.ts`, `src/discord/runtime/readyWorkloads.ts`, `server.ts`, `scripts/validate-env.mjs`.
- Impacted Tables/RPC: N/A (no schema/rpc contract changes).
- Risk/Regression Notes: API behavior is preserved, but route registration order is now split across modules; startup loops are orchestrated through one bootstrap surface to avoid duplicate starts.
- Validation: `npm run lint`.

## 2026-03-18 - Gate Log Robustness Hardening (JSON Sidecar + Legacy-safe Summary)

- Why: Prevent weekly gate summary corruption from legacy placeholder values and improve machine-readable operability of go/no-go run logs.
- Scope: go/no-go log generator now writes paired markdown+json outputs; weekly summary parser now prefers json, normalizes legacy placeholders, and sanitizes table cells.
- Impacted Routes: N/A
- Impacted Services: N/A (ops scripting and governance reporting only)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Existing markdown logs remain compatible; legacy entries are normalized as `pending/unknown` instead of producing malformed rows.
- Validation: `npm run gates:init-log -- --stage=A --scope=guild:demo --operator=auto --decision=go`, `npm run gates:weekly-report -- --days=7`, `npm run test:contracts`, `npm run contracts:validate`, `npm run lint`.

## 2026-03-18 - Full Session-Allowlist Execution (Automation Completion)

- Why: Execute all approved follow-up actions from the session end-to-end: weekly gate reporting, schema-to-test integration, and no-go rollback autofill.
- Scope: added gate-run weekly summary script, added autonomy contract schema test, enhanced go/no-go log generator with decision-aware rollback autofill, and wired npm commands.
- Impacted Routes: N/A
- Impacted Services: N/A (testing/ops automation and documentation only)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime request-path behavior changed; CI/test strictness increased for contract drift prevention.
- Validation: `npm run test:contracts`, `npm run gates:init-log -- --stage=B --scope=guild:demo --operator=auto --decision=no-go --rollbackType=queue --rollbackDeadlineMin=10`, `npm run gates:weekly-report -- --days=7`, `npm run lint`.

## 2026-03-18 - Progressive Blueprint Automation Enforcement

- Why: Complete end-to-end execution of progressive autonomy blueprint by adding executable scripts and CI enforcement, not only planning docs.
- Scope: automation scripts for contract validation and go/no-go run-log creation; npm script wiring; CI gate step addition; planning index update.
- Impacted Routes: N/A
- Impacted Services: N/A (no runtime request path changed)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: CI now fails when autonomy contract schema integrity check fails; this is intended fail-closed behavior for governance consistency.
- Validation: `npm run lint`, `npm run contracts:validate`, `npm run gates:init-log -- --stage=A --scope=guild:demo --operator=auto`.

## 2026-03-18 - Progressive Autonomy Execution Artifacts Finalization

- Why: Convert roadmap-level methodology into operator-ready execution artifacts for immediate stage-based rollout.
- Scope: added 30-day checklist, go/no-go decision template, and contract JSON schema set; linked from roadmap and unified runbook.
- Impacted Routes: N/A (documentation and governance artifact update)
- Impacted Services: N/A (no runtime code path changed)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime regression; execution ambiguity reduced through standardized checklist/template/schema artifacts.
- Validation: `npm run lint`.

## 2026-03-18 - Progressive Autonomy Evolution Methodology Adoption

- Why: Reduce migration risk while scaling autonomous operations by formalizing strangler-first, queue-first, contract-first, and SLO-driven decomposition into canonical governance docs.
- Scope: roadmap, execution board, sprint backlog, and unified runbook synchronization for staged evolution operations.
- Impacted Routes: N/A (documentation and operational governance update)
- Impacted Services: N/A (no runtime behavior changed in this documentation change set)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime regression; stage gate strictness increased and rollback policy clarified to reduce operational ambiguity.
- Validation: `npm run lint`.

## 2026-03-18 - Runtime Bottleneck and Reliability Hardening

- Why: Mitigate control-plane read bottlenecks and reduce runtime hang risks from upstream network latency and server shutdown edge cases.
- Scope: bot status endpoint caching/in-flight dedupe/rate-limit, Supabase fetch timeout wrapper, HTTP server timeout and graceful shutdown controls.
- Impacted Routes: `/api/bot/status`
- Impacted Services: `src/routes/bot.ts`, `src/services/supabaseClient.ts`, `server.ts`
- Impacted Tables/RPC: Indirect impact on Supabase calls through shared client timeout policy.
- Risk/Regression Notes: Status payload freshness now follows short TTL caching; extreme low-latency dashboards may observe up to cache TTL delay.
- Validation: `npm run lint`.

## 2026-03-18 - GoT/LangGraph 실행 엔진 + Task Routing + SLO 모니터링 + Community Graph

- Why: (1) Graph-of-Thought 추론 전략을 LangGraph-style 상태 그래프 노드로 구조화. (2) 태스크를 기술/연산/창작/검색 경로로 자동 라우팅. (3) 에이전트 SLO(응답 시간, 품질) 실시간 추적. (4) Discord 상호작용 기반 커뮤니티 소셜 그래프 구축. (5) OpenCode GitHub 큐 + publish worker 추가.
- Scope: 30+ new files — `src/services/agent/agentGot{PolicyService,CutoverService,Store,AnalyticsService}.ts`, `agentSloService.ts`, `agentTelemetryQueue.ts`, `agentQualityReviewService.ts`, `src/services/opencode/{opcodeGitHubQueueService,opcodeOpsService,opencodePublishWorker}.ts`, `taskRoutingService.ts`, `taskRoutingAnalyticsService.ts`, `taskRoutingMetricsService.ts`, `toolLearningService.ts`, `communityGraphService.ts`, `conversationTurnService.ts`, `llmExperimentAnalyticsService.ts`, `semanticAnswerCacheService.ts`, `efficiencyOptimizationService.ts`, `platformLightweightingService.ts`, `runtimeSchedulerPolicyService.ts`, `supabaseExtensionOpsService.ts`, `userPersonaService.ts`, `langgraph/nodes/{coreNodes,runtimeNodes,composeNodes}.ts` + tests
- Impacted Routes: `/api/bot/agent/*` (GoT/SLO/telemetry endpoints), `/api/bot/status` (확장)
- Impacted Services: `multiAgentService.ts` (GoT policy gating, cutover logic), `agentMemoryService.ts` (hybrid search), `obsidianRagService.ts` (graph-first 통합), `llmClient.ts` (실험 분석 연동)
- Impacted Tables/RPC: `agent_got_shadow_runs`, `agent_slo_metrics`, `agent_telemetry_queue`, `task_routing_decisions`, `community_interactions` (schema additions)
- Risk/Regression Notes: GoT는 `AGENT_GOT_ENABLED=false` 기본값. Task routing은 기존 단일경로 폴백 유지. SLO alert는 임계값 미도달 시 비활성.
- Validation: `npx tsc --noEmit`, `npx vitest run`.

## 2026-03-17 - Unified Roadmap and Ops Document Integration (Social Ops Baseline)

- Why: Resolve roadmap/runbook/backlog fragmentation and align documentation to current implementation progress (social graph + autonomous loop + reasoning gates).
- Scope: planning and operations documentation governance layer.
- Impacted Routes: N/A (documentation integration change)
- Impacted Services: N/A (no runtime behavior changed in this update)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime regression; planning ambiguity reduced by canonical roadmap and milestone-bound execution board.
- Validation: `npm run lint`.

## 2026-03-15 - Autonomous Guild Context Ops Loop Baseline

- Why: Move from static lore sync into autonomous multi-guild context operations with feedback/reward signals.
- Scope: Obsidian sync pipeline, guild bootstrap flow, Discord ingestion hooks, operations loop controls.
- Impacted Routes: N/A (runtime loop and Discord event pipeline focused change)
- Impacted Services: obsidianBootstrapService, discordTopologySyncService, discordChannelTelemetryService, discordReactionRewardService, action/session orchestration touchpoints.
- Impacted Tables/RPC: `guild_lore_docs` (primary sync target), memory-related read/write paths (indirect).
- Risk/Regression Notes: Increased automation surface; requires strict timeout/retry/failure-rate guard tuning and lock-file hygiene.
- Validation: `npm run lint`, operational smoke via `obsidian:ops-cycle` and `obsidian:ops-loop` configuration checks.

## 2026-03-15 - Frontier 2026 Roadmap Sync for Personal AGI Testbed

- Why: Align planning and operations docs with current direction: AI-built user services, real-time context learning, Discord UX/CS automation, and single-operator execution model.
- Scope: Program roadmap, execution board, unified runbook ownership/risk framing.
- Impacted Routes: N/A (planning/operations documentation synchronization)
- Impacted Services: Planning and governance layers (no runtime code path changed in this update)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime behavior change; delivery risk reduced by clearer priorities and single-operator governance model.
- Validation: `npm run lint`.

## 2026-03-15 - Graph-First Doctrine and Hardcoding Remediation Sync

- Why: Prevent context drift by enforcing Obsidian CLI/Headless split, graph-first retrieval policy, and structured hardcoding cleanup.
- Scope: Obsidian sync runbook, beta go/no-go gates, frontier roadmap, sprint backlog, hardcoding checklist.
- Impacted Routes: N/A (documentation/governance layer update)
- Impacted Services: N/A (no runtime code path changed in this update)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime change; operational consistency and deployment gate strictness increased.
- Validation: `npm run lint`.

## 2026-03-15 - Discord Runtime Policy Centralization (Hardcoding Phase 1)

- Why: Reduce hardcoding drift by centralizing Discord intent patterns and output length limits into a shared runtime policy layer.
- Scope: `src/discord/runtimePolicy.ts` added; command definitions, docs command handlers, market handler, and UI builders migrated to shared limits/patterns.
- Impacted Routes: N/A (Discord interaction/runtime layer refactor)
- Impacted Services: Discord command handling and rendering policy only.
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Existing imports remained compatible by re-exporting intent patterns from command definitions.
- Validation: `npm run lint`.

## 2026-03-15 - Obsidian Code Map Sync (Sourcetrail-style View)

- Why: Enable full-code observability in personal Obsidian vault with function/class notes, backlinks, and lightweight auto-sync on file changes.
- Scope: `scripts/sync-obsidian-code-map.ts`, npm scripts, environment options, and operations runbook.
- Impacted Routes: N/A (offline tooling and vault generation)
- Impacted Services: N/A (no runtime API behavior changed)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Watch mode relies on recursive fs watcher support; if unavailable on environment, run one-shot generation via cron/task scheduler.
- Validation: `npm run lint`; one-shot and watch command smoke in local path.

## 2026-03-15 - Obsidian Code Map Tag Policy Flexibility

- Why: Support project-specific taxonomy by making code-map tags configurable instead of fixed values.
- Scope: `scripts/sync-obsidian-code-map.ts`, `.env.example`, runbook documentation for tag policy controls.
- Impacted Routes: N/A (offline tooling only)
- Impacted Services: N/A
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Custom tag inputs are normalized (lowercase/safe chars) which may alter user-provided raw casing.
- Validation: `npm run lint`; one-shot generation smoke with default tag policy.

## 2026-03-15 - Obsidian Code Map Post-Processing for Tag De-duplication

- Why: Reduce Obsidian tag duplication noise and improve architecture-level scanability in generated code-map notes.
- Scope: `scripts/sync-obsidian-code-map.ts`, `.env.example`, runbook tag policy section.
- Impacted Routes: N/A (offline tooling only)
- Impacted Services: N/A
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Inline hashtag lines are disabled by default; users depending on inline-only tag parsing should re-enable via config.
- Validation: `npm run lint`; `npm run obsidian:code-map -- --repo <repo> --vault <vault>`.

## 2026-03-15 - Obsidian Code Map Structural Navigation Upgrade

- Why: Improve human readability by shifting from flat file/symbol lists to guided navigation and dependency-first layout.
- Scope: `scripts/sync-obsidian-code-map.ts` index/file/symbol rendering and graph construction strategy.
- Impacted Routes: N/A (offline tooling only)
- Impacted Services: N/A
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Entrypoint detection is heuristic/path-based and may over-include scripts until rule tuning is refined.
- Validation: `npm run lint`; `npm run obsidian:code-map -- --repo <repo> --vault <vault>`.

## 2026-03-14 - Obsidian Headless RAG System Phase 1 + Worker Generation Pipeline

- Why: (1) 전통적 벡터 DB 한계를 넘어 Obsidian 그래프 구조를 활용한 컨텍스트 보존 RAG 시스템을 구축한다. (2) 에이전트가 누락된 능력을 자체 생성할 수 있는 동적 워커 생성 파이프라인을 도입한다.
- Scope: 10+ new files — `src/services/obsidianHeadlessService.ts` (CLI 기반 vault 검색/읽기, 폴백 직접 파일 I/O, 메타데이터 추출), `obsidianCacheService.ts` (Supabase 백드 캐싱/TTL/히트 추적), `obsidianRagService.ts` (인텐트 기반 문서 라우팅), `obsidianRagService.test.ts`, `src/services/workerGeneration/workerGenerationPipeline.ts` (worker 코드 생성 파이프라인), `dynamicWorkerRegistry.ts` (생성된 worker 등록/캐시), `workerApprovalStore.ts` (승인 게이트), `workerSandbox.ts` (샌드박스 검증)
- Impacted Routes: `/api/bot/agent/*` (docs command RAG 연동)
- Impacted Services: `obsidianHeadlessService.ts` (CLI vault 접근), `obsidianCacheService.ts` (캐시 관리), `obsidianRagService.ts` (인텐트→문서 라우팅), `workerGenerationPipeline.ts` (LLM 코드 생성 → 승인 → 등록), `dynamicWorkerRegistry.ts` (부팅 시 승인된 worker 복원), `workerApprovalStore.ts` (file + Supabase 듀얼 모드), `workerSandbox.ts` (격리 실행 검증)
- Impacted Tables/RPC: `guild_lore_docs` (cache read/write), `worker_approvals` (new table)
- Risk/Regression Notes: Obsidian CLI 미설치 시 직접 파일 I/O 폴백. Worker generation은 승인 게이트 통과 필수. 샌드박스 검증 실패 시 등록 차단.
- Validation: `npx tsc --noEmit`, `npx vitest run` (76 tests).

## 2026-03-14 - Ops Observability: Dynamic Worker Hardening + Policy UX + News Dedup

- Why: (1) actionRunner에 fail-closed 거버넌스와 트렌드/Top-N 장애 코드 진단을 추가. (2) workerApprovalStore에 파일/Supabase 듀얼 모드 + 진단 스냅샷. (3) 뉴스 캡처 시맨틱 중복 제거. (4) 봇-에이전트 세션의 정책 차단 진단과 worker 제안 UX 개선.
- Scope: 15+ files — `actionRunner.ts` (fail-closed, diagnostics, trend), `workerApprovalStore.ts` (dual mode), `dynamicWorkerRegistry.ts` (boot restore, cache-busting), `workerProposalMetrics.ts` (funnel metrics), `newsCaptureDedupService.ts` (new), `userLearningPrefsService.ts` (new), `webSearch.ts` (new), `newsVerify.ts` (new), `discord/messages.ts` (catalog)
- Impacted Routes: `/api/bot/status` (worker proposal metrics + action diagnostics 포함)
- Impacted Services: `actionRunner.ts`, `workerApprovalStore.ts`, `dynamicWorkerRegistry.ts`, `workerProposalMetrics.ts`, `newsCaptureDedupService.ts`, `userLearningPrefsService.ts`
- Impacted Tables/RPC: `worker_approvals` (RLS, index, trigger), `MIGRATION_DEDUPE_LEARNING.sql` (뉴스 핑거프린트 스키마)
- Risk/Regression Notes: 거버넌스 기본값이 fail-closed로 변경. `ACTION_GOVERNANCE_DEFAULT_MODE` env로 통제 가능.
- Validation: `npx tsc --noEmit`, `npx vitest run` (76 tests, 9 modules).
