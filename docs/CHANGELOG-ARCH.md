# Architecture Changelog

Use this log for architecture-significant changes only.

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
