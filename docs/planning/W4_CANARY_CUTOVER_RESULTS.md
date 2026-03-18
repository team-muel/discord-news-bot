# W4 Canary Cutover Results

## Scope

- checklist: W4-04, W4-05, W4-06
- stage: A
- execution mode: autonomous convergence
- executed_at: 2026-03-18T17:26:39.283Z

## W4-04 Canary Guild Selection + Baseline

- canary_guild_id: 1284113159191269386
- selection_rule: active source 수가 가장 높은 guild 자동 선택
- baseline_window: 최근 24시간
- baseline_metrics:
  - active_source_count: 4
  - llm_total: 0
  - llm_success_rate_pct: 0
  - llm_latency_p95_ms: 0
  - memory_jobs_total: 0
  - memory_jobs_failed: 0
  - memory_job_failure_rate: 0

## W4-05 24h Canary Observation Go/No-Go Decision

- decision: no-go
- failed_checks:
  - llm-sample-volume (llmTotal=0)
  - llm-p95-latency (llmLatencyP95Ms=0)
- interpretation:
  - 24시간 관측 구간에서 LLM 호출 표본이 없어 품질 게이트 판정 근거 부족.
  - Stage 승격 없이 현 Stage 유지 및 관측 연장 필요.

## W4-06 Rollback Rehearsal (<=10m)

- command: node scripts/rehearse-stage-rollback.mjs
- elapsed_ms: 441
- deadline_ms: 600000
- within_deadline: true
- idempotency_replay:
  - reconnect_status: 409
  - reconnect_replay_status: 409
  - replay_header: true
- result: pass

## Evidence

- scripts/run-trading-canary-readiness.mjs
- scripts/rehearse-stage-rollback.mjs
- docs/planning/gate-runs/2026-03-18_gate-20260318-172700.md
- docs/planning/gate-runs/2026-03-18_gate-20260318-172700.json

## Verification

- npm run trading:canary:readiness
- npm run -s lint
- npm run -s gates:validate
