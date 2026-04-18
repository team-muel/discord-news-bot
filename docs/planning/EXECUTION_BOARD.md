# 실행 보드 (Frontier 2026)

기준 문서: `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md` (canonical)

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

프로그램 보조 문서: `docs/archive/FRONTIER_2026_PROGRAM.md` (ARCHIVED)

마일스톤 기준 문서: `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`

문서 역할:

- Canonical for current execution state only (`Now`, `Next`, `Later`).
- Every item must bind to roadmap milestone IDs from the unified roadmap.
- Detailed ticket breakdown belongs in [docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md](docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md).
- Active WIP must stay at 3 items or fewer; the rest remain queued even if approved.

표기 규칙:

- 각 항목은 `M-xx` milestone ID를 반드시 포함한다.

## Autonomous Focus (Single Objective Override)

- 현재 override 없음. 명시적 safe queue와 Active/Queued 순서를 따른다.

## Active Now (WIP <= 3)

1. [M-24] 채널 ingress 추상화 + Chat SDK actual migration
   - eligible surface `/해줘`, `/뮤엘`, `뮤엘 ...`를 real Chat SDK transport 위로 올린다
   - 기존 discord.js session은 유지하고 Chat SDK public API로 slash/prefixed path를 인-프로세스 브리지한다
   - 별도 `/만들어줘` 공개 slash surface는 제거하고, build/automation intent는 `/뮤엘` canonical entry에서 기존 vibe/session flow로 흡수한다
   - eligible `/뮤엘` full-session reply contract와 slash dispatch helper 정리는 코드에서 이미 닫혔다
   - current `chat-sdk` owner window의 default-on/100과 deployed-internal rollback 근거는 `2026-04-18_chat-sdk-cutover-20260418-124225.*`로 닫혔고, 남은 것은 grace-close와 exact-unit cleanup이다
   - full-resolution execution contract는 `docs/planning/DISCORD_CHAT_SURFACE_FULL_CLOSURE_PLAN.md`를 따른다
2. [M-21] [M-24] Legacy cleanup inventory lock
   - replacement-complete 근거가 닫힌 exact unit부터 rollback-only → remove-now로 이동한다
   - transport actualization 이후 Discord ingress residue와 naming residue를 우선 정리한다
   - Discord eligible chat surface 종결 순서는 `docs/planning/DISCORD_CHAT_SURFACE_FULL_CLOSURE_PLAN.md` 기준으로 묶는다
3. [M-19] User CRM 심화 + Social Graph 고도화
   - 상단 두 목표 종료 후 execution board와 Obsidian 계획 기준으로 즉시 이어간다

## Queued Now (Approved, Not In Active WIP)

1. [M-20] LLM 레이턴시 SLO 자동 Fallback
   - p95 > LATENCY_P95_THRESHOLD_MS 시 자동 provider 다운그레이드
   - p95 레이턴시를 go/no-go gate 판정 입력에 포함
   - 세션 품질 집계: 기존 quality_score 기반 SQL view (코드 최소화)
2. [M-22] 외부 OSS 어댑터 활용률 80%+ — M-24/M-21 종료 후 승격
   - 이미 들어온 것: local n8n starter closeout은 `preview -> request approval -> approve/apply -> rollback` baseline path까지 닫혔다
   - `muelUnified` 로컬 stdio 진입점을 `.vscode/mcp.json`에 추가 (현재 GCP SSH만)
   - 남은 범위: NemoClaw / n8n 어댑터 통합 테스트, 헬스 페이지 문서화, 활용률 증거 surface 정리
   - 어댑터 활용률 대시보드 (성공률, p95 레이턴시 per tool) 추가
   - 참조: `docs/planning/CAPABILITY_GAP_ANALYSIS.md` § 4
3. [M-23] 운영 문서 통합 경량화 — 코드 무관, Active 슬롯 확보 시 승격
   - `docs/archive/` 가치 있는 내용을 living doc으로 통합
   - MCP Tool Spec v2 기준으로 관련 문서 정렬 완료 (2026-04-05 일부 완료)
   - Obsidian 중심 운영체계 기준 문서 3종 고정: `OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md`, `OBSIDIAN_OBJECT_MODEL.md`, `OBSIDIAN_TRANSITION_PLAN.md`
   - 참조: `docs/planning/CAPABILITY_GAP_ANALYSIS.md` § 5
4. [M-21] 코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상
   - Chat SDK migration과 legacy cleanup 이후 다시 승격한다
   - 얽힌 service boundary 리팩토링, 순환 의존성 해소, stale fallback pruning을 이어간다
   - wave 1은 close되었다: A `runtime-builders/paramValidation.ts` + `runtime-subareas/workerHealthRoutes.ts`, B `obsidianPathUtils.ts`, C `src/config/configCore.ts` + `src/config/index.ts` + `src/config.ts` shim
   - wave 2도 close되었다: A `runtime-subareas/openjarvisRoutes.ts`, B `obsidianCatalogService.ts`, C `src/config/configDiscord.ts` + `src/config/index.ts` re-export 확장
   - wave 2 validation: route smoke + obsidian catalog + config focused tests green (`14 passed`), `tsc --noEmit` green, current lint gate green, full Vitest suite green (`2053 passed`)
   - wave 3도 close되었다: A `runtime-subareas/snapshotRoutes.ts` + `runtime-builders/snapshotReports.ts`, B `src/config/configSprint.ts` + `src/config/index.ts` re-export 확장
   - wave 3 validation: route smoke + config focused tests green (`11 passed`), `tsc --noEmit` green, full Vitest suite green (`2034 passed`)
   - M-21 structural baseline과 serial hardening closeout이 모두 완료됐다: runtime route subarea는 `workerHealth`, `infrastructure`, `openjarvis`, `snapshot`으로 분리되었고, knowledge compiler boundary는 `path utils`, `catalog`, `promotion`, `semantic lint`, `supervisor/control-surface`로 나뉘었다
   - Wave 4 closeout: `obsidianPromotionService.ts` + `runtime-subareas/infrastructureRoutes.ts`
   - Wave 5 closeout: `obsidianSemanticLintService.ts` + `obsidianKnowledgeSupervisorService.ts`
   - validation: focused regression green (`87 passed`), `tsc --noEmit` green, full Vitest suite green (`2037 passed`)
   - 남은 M-21 follow-up은 structural extraction이 아니라 stale fallback pruning, circular dependency 해소, domain ownership cleanup 같은 후속 hardening 범주다
   - worker guardrail: one objective, bounded shard, separate worktree when available, shard-local validation 후 full suite 재검증
   - detailed decomposition contract는 `docs/planning/GOD_OBJECT_DECOMPOSITION_PLAN.md`를 따른다
5. [M-19] User CRM 심화 + Social Graph 고도화
   - 코호트 세그먼트 자동 태깅 (power_user/casual/dormant)
   - communityGraphService 클러스터 탐지 (connected component → community_clusters)
   - 에스컬레이션 패턴 탐지 (escalation_signals)
   - CRM snapshot에 social graph 요약 포함
6. [M-24] 채널 ingress 추상화 + Chat SDK grace-close
   - 이미 들어온 것: eligible surface `/해줘`, `/뮤엘`, `뮤엘 ...`는 live cutover gate가 green이고 current canary slice에서 `chat-sdk` selected owner와 forced legacy fallback rollback evidence가 확보되었다
   - `2026-04-18_chat-sdk-cutover-20260418-095009.*` local-process artifact는 현재 코드 기준 rollout 100과 양 surface rollback rehearsal을 다시 확인했다
   - `2026-04-18_chat-sdk-cutover-20260418-124225.*` deployed-internal artifact는 rollout 100, live selected-path parity, 그리고 양 surface forced legacy fallback rollback evidence를 현재 `chat-sdk` owner window에서 닫았다
   - actual transport migration 이후 남은 것은 rollback grace-close 종료와 legacy demotion/removal이다
   - 아직 실 owner 전환 전인 것: admin/persona/task/CRM/market/runtime-control surface는 phase 2 이후 범위다
   - 다음 단계는 이미 닫힌 ingress envelope와 live policy contract 위에서 grace-close, exact-unit demotion, legacy removal 순서를 안전하게 진행하는 것이다
   - Hermes는 continuity/operator lane으로 유지하고, Supabase/Obsidian/OpenJarvis ownership은 바꾸지 않는다
   - 참조: `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`, `docs/planning/DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`
7. [M-21] [M-24] Legacy cleanup inventory lock — replacement-complete 이후에만 삭제 개방
   - scope: Discord legacy path, provider alias sprawl, naming compatibility residue, control-plane compatibility glue, deterministic inline residue
   - current gate: remove-now=none, rollback-only=docs.ask post-ingress fallback + prefixed muel-message post-ingress fallback exact units, keep-for-now=all remaining scoped units
   - predecessor lanes: Chat SDK cutover grace-close (live canary entered, full grace-close pending), provider cleanup closure (entered), naming/control-plane canonicalization closure (pending), deterministic task extraction closure (pending)
   - 참조: `docs/planning/LEGACY_CLEANUP_LANE.md`

## Closed on 2026-04-06

1. [M-18] Platform Lightweighting Phase B ✅
   - timer-001: pg_cron job expansion — login cleanup, obsidian sync, SLO check added to pgCronBootstrapService
   - dup-001: Unified memory search — `searchMemoryHybrid` shared helper (agentMemoryStore, agentMemoryService, memoryEvolutionService)
   - timer-002: Ops loop owner toggles — `OBSIDIAN_SYNC_LOOP_OWNER`, `AGENT_SLO_ALERT_LOOP_OWNER` env vars for app/db delegation
   - timer-002: Scheduler policy snapshot now reflects dynamic owner for obsidian sync and SLO loops
   - dup-002: Deferred (low priority) — no dead code found in llmClient, consolidation opp only

2. [M-17] Infrastructure Optimization ✅
   - Axis 1: pg_cron bootstrap service — `pgCronBootstrapService.ts` + migration SQL
   - Axis 2: Obsidian graph→Supabase sync — wikilink extraction + memory_item_links upsert
   - Axis 3: Tool adapter expansion — ollama, litellm-admin, mcp-indexing adapters (auto-loaded)
   - Axis 4: Planner pattern cache — TTL-based goal→plan cache with Jaccard similarity
   - Axis 5: render.yaml production activation — 9 new env vars
   - Bonus: services/ subdirectory reorganization — eval/, infra/, memory/, news/, obsidian/, trading/ (113 files, all imports updated)

## Closed on 2026-04-05

1. [M-16] Dormant Asset Activation ✅
   - self-improvement loop, cross-model voice, ToT shadow, LangGraph executor shadow 프로덕션 활성화
   - ENS Circuit 2를 sprint completion/blocked에 연결
   - memory consolidation/evolution config 중앙화 (config.ts memoryConfig namespace)
   - GCP e2-medium baseline/upgrade script (24/7 jarvis serve)
   - pilot 프로필: `config/env/production-pilot.profile.env`

## Closed on 2026-04-04

1. [M-15] Pluggable Adapter Framework ✅
   - F-01: `ExternalAdapterId` union literal → branded string 기반 + `ADAPTER_ID_PATTERN` schema validation + `registerExternalAdapter`/`unregisterExternalAdapter` 동적 등록
   - F-02: `adapterAutoLoader.ts` glob scan → 자동 registry 등록 (duck-type check, built-in skip, runtimeBootstrap 연동)
   - F-03: `generate-onboarding-checklist.mjs` adapter kind 확장 (4 prerequisite checks + 15-item checklist)

## Closed on 2026-04-03

1. [M-11] OpenJarvis Learning Loop 완결 ✅
   - D-01: `jarvis.bench --json` version guard + `parseBenchResult` schemaVersion 필드 추가
   - D-02: `jarvis.optimize` 출력 캡처 + Supabase 결과 영속화 + CLI fallback
   - D-03: trace→learning→bench 폐순환 — convergence monitor에서 structured JSON bench result + optimize result 데이터 포인트 수집
2. [M-12] OpenShell Sandbox 격리 실행 ✅
   - D-04: `OPENSHELL_REMOTE_GATEWAY` env로 remote gateway fallback 경로 추가
   - D-05: `sandbox.exec` 전 sandbox 존재 확인 + auto-create 로직 추가
   - D-06: startup sync + 6시간 주기 periodic re-sync 추가
3. [M-13] OpenClaw Gateway 채널 브릿지 ✅
   - E-01: 기 구현 확인 (agent.chat, agent.session.relay adapter)
   - E-02: 기 구현 확인 (GET/PUT /api/bot/agent/runtime/channel-routing)
   - E-03: skill name 길이 제한(100자) + Supabase 성공 추적 추가

## Closed on 2026-04-02

1. [M-10] 코드베이스 구조 정리 — agent* 서비스 하위 디렉토리 재구성 + import 경로 정리 + DIRECTORY_MAP 최신화 ✅
2. [M-10] CI/인프라 안정화 — openjarvis-unattended 스크립트 복원, smoke-api 환경변수 수정, 생성 docs 동기화, rollback summary 갱신 단계 추가 ✅
3. [M-10] 프로젝트 이름 통일 — infra 파일(systemd, render.yaml, env) `discord-news-bot` → `muel-platform` 완료 ✅

## Closed on 2026-03-24 (All Remaining WIP)

1. [M-04] [M-05] [M-06] worker quality gate + Opencode approval 흐름 + model binding/fallback 운영 고정 → ✅ 운영 검증 완료 (evidence ID + audit trail + snapshot API + HIGH_RISK_APPROVAL_ACTIONS + workflow model bindings)
2. [M-09] External Tool Integration Phase 2-4 잔여 병목 해소 → ✅ Phase 1-5.1 구현 완료, 잔여 Phase 3-4 runtime binding은 외부 도구 GA 이후 재개 예정

## Recently closed

- 2026-03-23: [M-08] Later 전체 Frontier Hardening 구현 완료 (7/7)
  - validate-runbook-readiness-checklist.mjs — 5-checkpoint runbook 자동 점검
  - verify-monthly-blocked-status.mjs — 월간 policyBlocked/finopsBlocked 0 검증
  - compute-consecutive-pass-status.mjs — 연속 통과 카운트 + beta 확장 승인 판정
  - run-multi-guild-scale-test.mjs — 3+길드 병렬 baseline 수집 + per-guild 평가
  - generate-onboarding-checklist.mjs — 신모델/신도구 온보딩 체크리스트 생성
  - validate-trading-rw-boundary.mjs — static code boundary + runtime isolation + canary cutover 검증
  - run-failure-injection-test.mjs — 4 failure + 2 security injection 시나리오 프레임워크
- 2026-03-22: [M-03] [M-08] Memory job queue-first 분리 v1 — MemoryJobPhase 타입, getMemoryQueueHealthSnapshot export, phase 상태 추적 (enqueue/consume/retry/deadletter/recover)
- 2026-03-22: [M-08] Queue lag/retry/deadletter SLO 알림 자동화 — agentSloService에 queue_lag_p95_sec, retry_rate_pct, deadletter_pending, deadletter_ignored 4개 SLO 체크 추가
- 2026-03-22: [M-05] Self-improvement loop v1 — 패턴 지속성 기록(persistSelfImprovementPatterns), 이전 주 회귀 검증(verifyPatternRegression: resolved/ongoing/worsened/newly), improvement_score 계산
- 2026-03-22: [Opt] llmClient 코드 경량화 — env parser lazy cache 3건, resolveModel binding 호이스트, OpenAI-compatible request dedup (~80→35 lines)
- 2026-03-22: [M-07] Provider 품질 정규화 — computeNormalizedQualityScore (latency 25% + logprob 50% + completeness 25%), persistLlmCallLog quality_score 필드 추가
- 2026-03-22: [M-07] recall@k + hallucination auto-fetch — go-no-go gate에 --autoFetchQuality 플래그, Supabase retrieval_eval_runs/agent_answer_quality_reviews 자동 수집 연동
- 2026-03-22: [M-06] [M-07] Provider profile 자동 회귀 — gate verdict → setGateProviderProfileOverride → resolveProviderChain effectiveProfile 적용
- 2026-03-22: [M-03] Feature Lacuna Detector 강화 — retry exhaustion/external failure 패턴 탐지, lacuna type 분류, scored ranking (frequency × distinctUsers × recency decay × type weight)
- 2026-03-22: [M-09] Phase 5.1 Gate→Jarvis trace feed — `jarvis.trace` capability + openjarvisAdapter trace store action + auto-judge-go-no-go.mjs trace feed hook
- 2026-03-22: [M-04] [M-07] Go/no-go gate verdict 런타임 강제 — GATE_VERDICT_ENFORCEMENT_ENABLED + cached gate verdict check + GATE_VERDICT_NO_GO failure classification
- 2026-03-22: [M-06] Workflow slot model binding/fallback matrix — LLM_WORKFLOW_MODEL_BINDINGS + LLM_WORKFLOW_PROFILE_DEFAULTS 환경변수, resolveWorkflowModelBinding/resolveWorkflowProfile 통합
- 2026-03-22: [M-06] Provider dual profile — LlmProviderProfile type + COST/QUALITY_OPTIMIZED_ORDER + reorderByProfile
- 2026-03-21: [M-04] [M-05] Worker quality gate 경화 + Opencode 고위험 approval 강제 구현
  - evidence ID 필드 (discover/verify/release) 추가, 승인 감사 추적 (approvedAt/approvedBy)
  - HIGH_RISK_APPROVAL_ACTIONS 환경변수로 opencode.execute 기본 approval_required 강제
  - snapshot API에 evidence 필드 노출
- 2026-03-21: [M-09] External Tool Integration Phase 2 완료 — OpenShell sandbox `muel-ollama` 생성 (Phase: Ready)
- 2026-03-21: [M-09] External Tool Integration Phase 3 core 완료 — `code.review` capability + SSH sandbox exec + action routing
- 2026-03-21: [M-09] External Tool Integration Phase 4 partial — OpenJarvis scheduler 설정 + `jarvis.ask` adapter routing
- 2026-03-21: [M-09] External Tool Integration Phase 1 완료 — Nemotron/LiteLLM/OpenJarvis/adapter probe 7/7 (`EXTERNAL_TOOL_INTEGRATION_PLAN.md`)
- 2026-03-21: [M-01] [M-03] Control Tower 기준 고정 + Core Decision Engine 인터페이스/이벤트 계약 수렴 (`A-001`)
- 2026-03-21: [M-02] [M-07] social graph 운영 지표 + quality telemetry 통합 점수화 (`A-002`)

운영 규칙:

- 아래 Active Now만 현재 진행 중으로 취급한다.
- 추가 항목은 `Queued Now`에서만 대기한다.
- 새 요청이 들어와도 기존 Active Now를 닫기 전에는 WIP를 늘리지 않는다.
- Queued 항목은 `A-001`~`A-003` backlog owner가 붙어 있지 않으면 Active Now로 승격하지 않는다.

## Closed Queued Now (Phase A-D, Owner-Bound)

### Closed Queued Items (Phase A-D)

1. ~~[A-003] [M-04] 동적 worker 품질 게이트(정적/정책/샌드박스) 운영 규칙 고정~~ → ✅ P0 경화 완료 (evidence ID + audit trail)
2. ~~[A-003] [M-05] Opencode adapter 계약(입출력/승인흐름/감사로그) 명세 확정~~ → ✅ evidence 필드 + snapshot 반영
3. ~~[A-003] [M-04] [M-07] 단계별 go/no-go 게이트(신뢰성/품질/안전/거버넌스) 운영 강제~~ → ✅ GATE_VERDICT_ENFORCEMENT_ENABLED + cached gate verdict + GATE_VERDICT_NO_GO classification
4. ~~[A-003] [M-05] [M-04] OpenDev -> NemoClaw sandbox 강제 위임 경로 검증(미경유 실행 0건)~~ → ✅ code.review SSH sandbox 경로 연결
5. ~~[A-003] [M-05] Opencode 고위험 액션 approval_required 강제 + 무증거 반영 차단~~ → ✅ HIGH_RISK_APPROVAL_ACTIONS 구현
6. ~~[A-003] [M-05] [M-06] workflow 슬롯별 모델 바인딩/폴백 매트릭스 운영 설정 고정~~ → ✅ LLM_WORKFLOW_MODEL_BINDINGS + LLM_WORKFLOW_PROFILE_DEFAULTS 환경변수 구현

## Next

(다음 마일스톤 승격 대기)

## Closed Next (Phase E: Pluggable Adapter Framework) — All ✅

1. ~~[M-15] `ExternalAdapterId` union literal → string 기반 + schema validation~~ → ✅ branded string + ADAPTER_ID_PATTERN + registerExternalAdapter/unregisterExternalAdapter
2. ~~[M-15] `src/services/tools/adapters/` glob scan → 자동 registry 등록~~ → ✅ adapterAutoLoader.ts + runtimeBootstrap 연동
3. ~~[M-15] adapter onboarding checklist 자동 생성 확장~~ → ✅ kind='adapter' + 4 prereq checks + 15-item checklist

## Closed Next (Phase D: Deep Integration Unlock) — All ✅

1. ~~[M-11] `jarvis.bench --json` → `computeNormalizedQualityScore` 입력 연결~~ → ✅ parseBenchResult schemaVersion guard
2. ~~[M-11] weekly auto-judge 후 `jarvis.optimize` 자동 트리거~~ → ✅ output capture + CLI fallback + Supabase persist
3. ~~[M-11] trace→learning→bench 폐순환 검증~~ → ✅ convergence monitor structured JSON + optimize result data points
4. ~~[M-12] Docker Desktop WSL2 통합 또는 remote gateway 경로 확보~~ → ✅ OPENSHELL_REMOTE_GATEWAY env fallback
5. ~~[M-12] actionRunner `implement.execute` → OpenShell sandbox 위임~~ → ✅ auto-create + sandbox existence check
6. ~~[M-12] `HIGH_RISK_APPROVAL_ACTIONS` ↔ OpenShell network policy YAML 동기화~~ → ✅ startup + 6h periodic re-sync

## Closed Later (Phase E: Channel Expansion) — All ✅

1. ~~[M-13] `openclaw agent --message` 경로를 Muel↔OpenClaw 양방향 메시지 파이프로 확장~~ → ✅ 기 구현 확인
2. ~~[M-13] guild 설정에 채널 라우팅 매핑 저장/조회 API~~ → ✅ 기 구현 확인
3. ~~[M-13] Muel feature lacuna → OpenClaw skill 자동 생성 트리거~~ → ✅ name length cap + success tracking

## Later

(다음 마일스톤 구체화 대기)

## Closed Next/Later (Phase A-C, All Completed)

### Next (D31-D60: Autonomous Loops) — All ✅

1. ~~[M-03] 요청 없음 구간에서도 누락 기능 탐지 -> 제안 큐 자동 생성 강화~~ → ✅ lacuna type 분류(missing_action/retry_exhaustion/external_failure) + scored ranking
2. ~~[M-05] Opencode executor 파일럿(approval_required 고정)~~ → ✅ HIGH_RISK_APPROVAL_ACTIONS 기 구현
3. ~~[M-06] provider dual profile(cost-optimized vs quality-optimized) 운영~~ → ✅ LlmProviderProfile + reorderByProfile + workflow profile defaults
4. ~~[M-07] ToT/GoT + provider별 품질 정규화 계측 도입~~ → ✅ computeNormalizedQualityScore + quality_score DB 기록
5. ~~[M-07] 라벨 기반 recall@k 및 hallucination review 자동 리포트~~ → ✅ go-no-go gate autoFetchQuality + Supabase auto-fetch
6. ~~[M-03] [M-08] memory job queue-first 분리 v1(enqueue/consume/retry/deadletter)~~ → ✅ MemoryJobPhase + getMemoryQueueHealthSnapshot + phase tracking
7. ~~[M-08] queue lag/retry/deadletter 운영 SLO 알림 자동화~~ → ✅ agentSloService 4개 SLO 체크 자동 평가
8. ~~[M-06] [M-07] provider profile 자동 회귀 규칙(quality gate fail 시 fallback) 적용~~ → ✅ gate verdict profile override + actionRunner enforcement
9. ~~[M-05] 실패 패턴 수집 -> 패치 제안 -> 회귀 검증 self-improvement loop v1~~ → ✅ 패턴 지속성 DB 기록 + 이전 주 회귀 검증 + improvement_score

### Later (D61-D90: Frontier Hardening) — All ✅

1. ~~[M-08] 멀티길드 스케일 테스트(파일럿 3+) 및 안정화~~ → ✅ run-multi-guild-scale-test.mjs (auto-discover/env/CLI 3+길드 baseline + per-guild 평가)
2. ~~[M-08] 실패 주입/보안 주입 테스트 운영화~~ → ✅ run-failure-injection-test.mjs (llm_timeout/supabase_unavailable/queue_overflow/health_degrade + XSS/SQLi 검증)
3. ~~[M-08] Go/No-Go 연속 통과 + 베타 확장 승인~~ → ✅ compute-consecutive-pass-status.mjs (연속 GO 카운트 + expansion_eligible 판정)
4. ~~[M-08] 월간 blocked 0 상태 유지 검증~~ → ✅ verify-monthly-blocked-status.mjs (Supabase action log + gate-run safety breach 통합 검증)
5. ~~[M-06] 신모델/신도구(Opencode 포함) 도입 템플릿 운영 고정~~ → ✅ generate-onboarding-checklist.mjs (model/tool 분기 + prerequisite check + rollback plan)
6. ~~[M-08] trading runtime read/write 경계 분리 및 canary cutover 운영화~~ → retired with the trading module cleanup (historical milestone preserved)
7. ~~[M-08] stage rollback runbook 자동 점검 체크리스트 운영화~~ → ✅ validate-runbook-readiness-checklist.mjs (5-checkpoint 자동 점검 + gates:validate:strict 연동)

## 운영 원칙

- 구현률 100%와 운영 무결성을 동시에 달성
- 가용성/정확성/보안을 비용보다 우선
- 배포 판단은 go/no-go 게이트로 일원화
- 단일 개발자 운영에서 컨텍스트 과부하를 핵심 리스크로 관리

## 수렴 실행 규칙 (1~24 완주 모드)

**상태: 종결 (2026-03-24)** — 전체 WIP 종결. 신규 사이클 시작 시 재작성.

- 기준 체크리스트: docs/archive/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md (ARCHIVED)
- 1~24 항목을 순차 처리하며, 선행 항목 미완료 시 후행 항목 착수 금지
- 동시 진행 WIP 최대 3개, 기준 목록은 `Active Now`만 사용
- 신규 기능 파일 추가 금지(기존 워크플로우 강화만 허용)
- 각 항목 완료 증거는 gate-runs 또는 runbook 링크로 남긴다
