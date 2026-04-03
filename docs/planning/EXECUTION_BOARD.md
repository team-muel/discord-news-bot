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

## Active Now (WIP <= 3)

(empty — next milestone pending triage)

## Closed on 2026-04-06

1. [M-17] Infrastructure Optimization ✅
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
   - GCP e2-small 업그레이드 스크립트 (24/7 jarvis serve)
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

## Queued Now (Approved, Not In Active WIP, Owner-Bound)

(없음)

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
6. ~~[M-08] trading runtime read/write 경계 분리 및 canary cutover 운영화~~ → ✅ validate-trading-rw-boundary.mjs (static boundary + runtime isolation + canary cutover 3단계 검증)
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
