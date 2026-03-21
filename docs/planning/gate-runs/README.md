# Gate Run Logs

이 디렉터리는 Progressive Autonomy Stage 판정 로그를 저장합니다.

생성 명령:

```bash
npm run gates:init-log -- --stage=A --scope=guild:123 --operator=auto
```

자동 판정 로그 생성(메트릭 입력 -> 게이트/최종판정 계산):

```bash
npm run gates:auto-judge -- --stage=A --scope=guild:123 --p95LatencyMs=420 --queueLagSec=30 --errorRatePct=0.8 --citationRate=0.78 --retrievalHitAtK=0.72 --hallucinationReviewFailRate=0.05 --sessionSuccessRate=0.91 --approvalRequiredCompliancePct=100 --unapprovedAutodeployCount=0 --policyViolationCount=0 --privacyBlockCount=0 --roadmapSynced=true --executionBoardSynced=true --backlogSynced=true --runbookSynced=true --changelogSynced=true
```

주간 스냅샷 기반 자동 판정(Go/No-Go + latency + rollback + memory queue 입력):

```bash
npm run gates:auto-judge:weekly
```

주간 스냅샷 기반 자동 판정 Dry-run(파일 생성 없이 의사결정만 검증):

```bash
npm run gates:auto-judge:weekly:pending:dry
```

- weekly auto-judge는 기본값으로 `--minQualitySamples=3`을 적용한다.
- quality sample이 최소치보다 적으면 quality gate를 `pending`으로 보정해 sparse/0값 기반 오판정을 줄인다.
- weekly auto-judge는 기본값으로 `--runAfterFallback=true`를 적용하며, quality fail일 때 `:post-fallback` scope 재판정을 1회 추가 실행한다.

자동 체크리스트/클로저 증거 문서 생성 포함(기본):

- weekly auto-judge는 no-go일 때 `docs/planning/YYYY-MM-DD_followup-ops-closure.md`를 자동 생성/보장하고
- 생성한 gate log의 post-decision checklist를 자동 완료 상태로 기록한다.
- weekly go/no-go summary의 quality gate 집계에서 fail이 감지되면 `qualityGateOverride=fail`을 자동 적용해 provider profile 회귀 액션(`provider_profile_fallback:quality-optimized`)을 최종 의사결정에 포함한다.
- weekly snapshot이 안정 구간(no-go=0, latency/success/deadletter 양호)으로 판정되면 `providerProfileHint=cost-optimized`를 자동 부여해 dual profile 운영(M-06)을 지속 적용한다.
- bot runtime은 no-request 구간에서도 `ACTION_NOT_IMPLEMENTED`/`DYNAMIC_WORKER_NOT_FOUND` 실패 로그를 스윕해 worker proposal queue를 자동 생성한다(M-03). 기본값은 30분 간격, 길드당 cooldown/중복 차단/품질가드가 적용된다.
- bot runtime은 `opencode.execute` 정책을 `approval_required`로 자동 보정해 Opencode executor pilot의 안전 게이트를 고정한다(M-05).

프로파일 규칙:

- `--thresholdProfile=stage_default` 사용 시 stage별 기본 임계치 자동 적용
- Stage A: `stage_a_relaxed`
- Stage B: `stage_b_strict`
- Stage C: `stage_c_hardening`

생성 결과:

- `YYYY-MM-DD_<runId>.md` (운영자 가독용)
- `YYYY-MM-DD_<runId>.json` (집계/자동화용 구조화 로그)

주간 집계:

```bash
npm run gates:weekly-report -- --days=7
```

Legacy pending no-go 보정 집계(예: Stage B 과거 런 제외):

```bash
npm run gates:weekly-report:normalized
```

- 기본 출력 파일: `docs/planning/gate-runs/WEEKLY_SUMMARY_NORMALIZED.md`
- raw 기준 요약은 계속 `docs/planning/gate-runs/WEEKLY_SUMMARY.md`에 기록된다.

Sink 지정(예: markdown + supabase):

```bash
npm run gates:weekly-report -- --days=7 --sinks=markdown,supabase
```

Dry-run(쓰기 없이 경로/쿼리 검증):

```bash
npm run gates:weekly-report:supabase:dry
```

통합 주간 리포트(Go/No-Go + LLM latency + hybrid + self-improvement + rollback + memory-queue):

```bash
npm run gates:weekly-report:all
```

- `gates:weekly-report:all` 마지막 단계에서 `gates:auto-judge:weekly:pending`를 자동 실행한다.

하이브리드 스냅샷(Go/No-Go + LLM 결합):

```bash
npm run gates:weekly-report:hybrid
```

Self-improvement 제안 리포트(실패 패턴 -> 패치 제안 -> 회귀 검증 명령):

```bash
npm run gates:weekly-report:self-improvement
```

- self-improvement 주간 리포트는 M-07 신호로 라벨 기반 `recall@k`(retrieval_eval_runs 요약)와 `hallucination review`(agent_answer_quality_reviews) 주간 델타를 함께 산출한다.
- self-improvement 주간 리포트는 M-05 신호로 opencode.execute 승인 정책 준수율(`ACTION_APPROVAL_REQUIRED` 비율)과 승인 큐(pending/approved/rejected/expired)를 함께 산출한다.
- 품질 테이블이 아직 없는 환경에서는 기본값으로 missing_table 상태를 기록하고 리포트 생성을 계속한다.

통합 Dry-run:

```bash
npm run gates:weekly-report:all:dry
```

- `gates:weekly-report:all:dry`는 마지막 단계에서 `gates:auto-judge:weekly:pending:dry`를 자동 실행해 전체 주간 체인의 의사결정 경로까지 함께 검증한다.

Stage rollback 리허설 증거 생성(R-017):

```bash
npm run rehearsal:stage-rollback:record -- --maxRecoveryMinutes=10
```

Stage rollback 리허설 Dry-run:

```bash
npm run rehearsal:stage-rollback:record:dry
```

Rollback 리허설 주간 집계:

```bash
npm run gates:weekly-report:rollback
```

Rollback readiness 체크리스트 검증:

```bash
npm run rehearsal:stage-rollback:validate
```

Rollback readiness 체크리스트 엄격 검증(CI):

```bash
npm run rehearsal:stage-rollback:validate:strict
```

Memory queue 주간 관측 리포트:

```bash
npm run memory:queue:report
```

- 위 명령은 기본값으로 queue lag/retry/deadletter 임계치를 평가해 SLO breach 시 incident/comms 초안 아티팩트를 자동 생성한다.
- 생성 경로: `docs/planning/gate-runs/memory-queue-alerts/` (`*_incident-draft.md`, `*_comms-draft.md` 포함)

로그 형식 검증:

```bash
npm run gates:validate
```

최근 런 체크리스트 강제 검증:

```bash
npm run gates:validate:strict
```

고정 fixture 회귀 검증:

```bash
npm run gates:fixtures:check
```

주간 집계 경로 검증(쓰기 없이 dry-run):

```bash
npm run gates:weekly-report:dry
```

스키마 계약:

- `docs/planning/GO_NO_GO_RUN_SCHEMA.json`
- `scripts/validate-go-no-go-runs.mjs`는 위 키셋 계약 + 의사결정 의미 규칙(no-go rollback 필수)을 함께 검증한다.

운영 규칙:

- 각 stage 판정마다 최소 1건의 로그를 생성한다.
- `overall=no-go`인 경우 rollback 유형과 기한을 반드시 채운다.
- incident/comms 문서와 증거 링크를 연결한다.
- Supabase sink 사용 시 `public.agent_weekly_reports`에 `report_kind=go_no_go_weekly`로 upsert한다.
- `go_no_go_weekly.baseline_summary`에는 gate verdict 집계(`gate_verdict_counts`)가 포함되며, weekly auto-judge의 quality 회귀 규칙 입력으로 사용한다.
- `go_no_go_weekly.baseline_summary.no_go_root_cause`에는 no-go 원인군(이중실패/단독실패/pending 기반/기타) 집계가 포함된다.
- `go_no_go_weekly.baseline_summary.required_action_completion`에는 no-go 후속조치 추정 완료율(체크리스트 기준)이 포함된다.
- `go_no_go_weekly.baseline_summary.quality_summary`에는 citation/retrieval/hallucination/session 주간 평균이 포함되며, weekly auto-judge의 quality gate 입력값으로 재사용된다.
- `go_no_go_weekly.baseline_summary.strategy_quality_normalization`에는 M-07 계측값(전략별 recall@k + hallucination fail rate 기반 정규화 점수, baseline 대비 delta)이 포함된다.
- 하이브리드 주간 스냅샷은 `report_kind=hybrid_weekly`로 upsert한다.
- self-improvement 리포트는 markdown 산출물로 생성되며, execution board의 M-05 루프 입력으로 사용한다.
- self-improvement 리포트의 Labeled Quality Signals 섹션은 M-07 운영 증거(라벨 기반 recall/hallucination)를 주간 자동 리포트로 제공한다.
- rollback 리허설 산출물은 `docs/planning/gate-runs/rollback-rehearsals/`에 md/json 페어로 저장하고, 주간 집계는 `report_kind=rollback_rehearsal_weekly`로 upsert할 수 있다.
- memory queue 주간 관측 리포트는 `report_kind=memory_queue_weekly`로 upsert할 수 있다.
- memory queue 리포트의 `baseline_summary.slo_alert` 필드는 queue SLO 알림 판정 결과를 포함하며, breach 시 후속 no-go 판단의 운영 증거로 사용한다.
- background worker proposal 자동 스윕은 Supabase `agent_action_logs` + worker approval store를 입력으로 사용하며, 최근 요청이 없는 길드에 한해 누락 액션을 제안 큐로 전환한다.
- CI는 `gates:validate` 실패 시 머지를 차단한다.
- CI는 `gates:validate:strict` 실패 시 최근 run의 post-decision 체크리스트 누락을 차단한다.
- CI는 `rehearsal:stage-rollback:validate:strict` 실패 시 rollback readiness 주간 체크리스트 신선도/임계치 위반을 차단한다.
- CI는 `gates:fixtures:check` 실패 시 no-go 규칙 회귀를 차단한다.
- CI는 `gates:weekly-report:dry` 실패 시 집계 경로 불일치를 차단한다.
