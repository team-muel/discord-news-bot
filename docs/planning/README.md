# Planning Docs Index

## Daily Operating Set

매일 열어야 하는 문서는 아래 4개로 제한한다.

1. `UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md` — 방향, 우선순위, milestone ID
2. `EXECUTION_BOARD.md` — 현재 활성 항목만 관리
3. `SPRINT_BACKLOG_MEMORY_AGENT.md` — 작업 단위와 완료 기준
4. `../RUNBOOK_MUEL_PLATFORM.md` — 운영 절차와 실행 순서

이 4개 외 문서는 참고/평가/결과/템플릿 문서로 취급한다.

## Canonical Navigation Order

1. `UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md` — direction, priorities, milestone IDs
2. `EXECUTION_BOARD.md` — current state (`Now`, `Next`, `Later`)
3. `SPRINT_BACKLOG_MEMORY_AGENT.md` — task-sized implementation units
4. `../RUNBOOK_MUEL_PLATFORM.md` — operator procedure and execution
5. `PLATFORM_CONTROL_TOWER.md` — tie-breaker for document ownership and canonical scope

주의:

- `PLATFORM_CONTROL_TOWER.md`는 매일 읽는 실행 문서가 아니라 문서 충돌 시에만 여는 조정 레이어다.
- `AGENT_ARCH_EVAL_FRAMEWORK.md`, `AGENT_EVAL_QUERY_PLAYBOOK.md`는 평가 부록이며 우선순위 결정 문서가 아니다.
- `gate-runs/*`, `*_RESULTS.md`, `*_CHECKLIST.md`는 증거/판정 보조 문서다.

## Document Ownership Matrix

- `../RUNTIME_NAME_AND_SURFACE_MATRIX.md`: 이름 충돌 해석과 실제 런타임 surface availability의 정본
- `../ARCHITECTURE_INDEX.md`: 현재 코드와 런타임 경계의 정본
- `../OPERATIONS_24_7.md`: 운영 절차, 배포, 상태 확인의 정본
- `LOCAL_COLLAB_AGENT_WORKFLOW.md`: 로컬 IDE 협업 규칙과 handoff 계약의 정본
- `LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`: 향후 로컬 외부 도구 통합 설계의 정본
- `EXTERNAL_TOOL_INTEGRATION_PLAN.md`: NVIDIA OpenShell/NemoClaw/OpenClaw/Nemotron 실제 외부 도구 통합 계획
- `.github/agents/*`, `.github/prompts/*`, `.github/instructions/*`: IDE 커스터마이징 입력면

읽기 순서 규칙:

1. 현재 시스템이 실제로 어떻게 동작하는지 확인할 때는 먼저 `../ARCHITECTURE_INDEX.md`를 읽는다.
2. 이름이 실제 구현을 뜻하는지 헷갈리면 `../RUNTIME_NAME_AND_SURFACE_MATRIX.md`를 바로 확인한다.
3. 운영/배포/장애 대응은 `../OPERATIONS_24_7.md`를 우선한다.
4. IDE 협업 규칙 수정은 `LOCAL_COLLAB_AGENT_WORKFLOW.md`와 `.github` 커스터마이징 파일을 함께 본다.
5. 아직 구현되지 않은 로컬 외부 도구 통합은 `LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`에서 별도 설계로 다룬다.

## 문서 목록

- UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md
- ROADMAP_STATUS_2026-03-19.md
- OPENCODE_EXECUTOR_MIN_SPEC.md
- OPENCODE_NEMOCLAW_OPENDEV_EXECUTION_PLAN.md
- OPENCODE_NEMOCLAW_OPENDEV_OPENJARVIS_PROMPT_TEMPLATES.md
- LOCAL_COLLAB_AGENT_WORKFLOW.md
- LOCAL_TOOL_ADAPTER_ARCHITECTURE.md
- EXTERNAL_TOOL_INTEGRATION_PLAN.md
- OPENCODE_PUBLISH_WORKER_MIN_SPEC.md
- OPENJARVIS_ROUTING_RULES_DRAFT.md
- MULTI_AGENT_OPERATING_STANDARD_V1.md
- OPENJARVIS_TEST_DEPLOY_GATE_CHECKLIST.md
- OPENJARVIS_UNATTENDED_AUTONOMY_SETUP.md
- LOCAL_FIRST_HYBRID_AUTONOMY.md
- GCP_OPENCODE_WORKER_VM_DEPLOY.md
- GCP_REMOTE_INFERENCE_NODE.md
- gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md
- gate-runs/MONTHLY_GCP_WORKER_COST_HEALTH.md
- REMOTE_ONLY_AUTONOMY_IMPLEMENTATION.md
- PLATFORM_CONTROL_TOWER.md
- FRONTIER_2026_PROGRAM.md
- LONG_TERM_MEMORY_AGENT_ROADMAP.md
- SPRINT_BACKLOG_MEMORY_AGENT.md
- EXECUTION_BOARD.md
- BETA_GO_NO_GO_CHECKLIST.md
- GO_NO_GO_GATE_TEMPLATE.md
- PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md
- AUTONOMY_CONTRACT_SCHEMAS.json
- CORE_COMMAND_INTERFACE_V1.md
- DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md
- gate-runs/README.md
- gate-runs/WEEKLY_SUMMARY.md
- AGENT_ARCH_EVAL_FRAMEWORK.md
- AGENT_EVAL_QUERY_PLAYBOOK.md
- MULTI_AGENT_NODE_EXTRACTION_TARGET_STATE.md
- FINOPS_PLAYBOOK.md
- MEMORY_SCHEMA_MIGRATION_PLAN.md
- MEMORY_API_CONTRACT.md
- MEMORY_RETRIEVAL_SCORING.md
- MEMORY_ADMIN_COMMANDS.md
- MEMORY_QUEUE_POLICY_V1.md
- MEMORY_DEADLETTER_SOP_V1.md
- CONTROL_PLANE_POLICY_TABLE.md
- W3_CONTROL_PLANE_STABILIZATION_RESULTS.md
- TRADING_ISOLATION_READINESS_V1.md
- W4_CANARY_CUTOVER_RESULTS.md

## ADR 목록

- ../adr/ADR-001-memory-domain-model.md
- ../adr/ADR-002-memory-retrieval-policy.md
- ../adr/ADR-003-admin-correction-loop.md
- ../adr/ADR-004-citation-first-response.md
- ../adr/ADR-005-context-compression-pipeline.md

## 사용 방법

1. 통합 로드맵에서 분기 목표와 milestone ID를 확인한다.
2. 실행 보드에서 milestone ID 기준으로 Now 항목만 진행한다.
3. 스프린트 백로그에서 작업 단위/완료 기준으로 이슈를 분해한다.
4. 운영 절차는 RUNBOOK 기준으로만 실행한다.
5. 아키텍처 변경은 ADR 먼저 기록한다.

## Reduction Rules

계획 과부하를 막기 위해 아래 규칙을 적용한다.

1. 새 계획 문서를 만들기 전에 기존 canonical 4문서 중 어느 문서에 흡수할지 먼저 판단한다.
2. 상태 추적은 `EXECUTION_BOARD.md`에만 남긴다.
3. 지표 정의와 SQL은 평가 부록에만 남기고 로드맵/보드에 중복 서술하지 않는다.
4. 결과 보고서는 `gate-runs/` 또는 결과 문서에 남기고 canonical 문서에는 링크만 둔다.
5. 활성 WIP는 항상 3개 이하로 유지한다.

## Triage Matrix

아래 문서는 현재 운영에서 이렇게 취급한다.

### Canonical

- `UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`
- `EXECUTION_BOARD.md`
- `SPRINT_BACKLOG_MEMORY_AGENT.md`
- `../RUNBOOK_MUEL_PLATFORM.md`

### Reference

- `PLATFORM_CONTROL_TOWER.md`
- `LOCAL_COLLAB_AGENT_WORKFLOW.md`
- `MULTI_AGENT_OPERATING_STANDARD_V1.md`
- `CORE_COMMAND_INTERFACE_V1.md`
- `DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`
- `OPENCODE_EXECUTOR_MIN_SPEC.md`
- `LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`
- `LOCAL_FIRST_HYBRID_AUTONOMY.md`
- `REMOTE_ONLY_AUTONOMY_IMPLEMENTATION.md`
- `MEMORY_API_CONTRACT.md`
- `MEMORY_QUEUE_POLICY_V1.md`
- `AGENT_ARCH_EVAL_FRAMEWORK.md`
- `BETA_GO_NO_GO_CHECKLIST.md`
- `FINOPS_PLAYBOOK.md`

### Historical Snapshot / Evidence

- `ROADMAP_STATUS_2026-03-19.md`
- `2026-03-18_followup-ops-closure.md`
- `2026-03-19_followup-ops-closure.md`
- `2026-03-22_session-handoff.md`
- `MULTI_AGENT_DRY_RUN_2026-03-19.md`
- `PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md`
- `W3_CONTROL_PLANE_STABILIZATION_RESULTS.md`
- `W4_CANARY_CUTOVER_RESULTS.md`
- `gate-runs/*`

### Legacy or Narrow-Scope Reference

- `LONG_TERM_MEMORY_AGENT_ROADMAP.md`
- `FRONTIER_2026_PROGRAM.md`
- `OPENCODE_NEMOCLAW_OPENDEV_EXECUTION_PLAN.md`
- `OPENCODE_NEMOCLAW_OPENDEV_OPENJARVIS_PROMPT_TEMPLATES.md`
- `OPENJARVIS_ROUTING_RULES_DRAFT.md`

## Reference Families

아래 문서군은 active plan이 아니라 설계/계약 참고 묶음으로 유지한다.

### Collaboration and Routing Reference

- `LOCAL_COLLAB_AGENT_WORKFLOW.md`
- `MULTI_AGENT_OPERATING_STANDARD_V1.md`
- `OPENJARVIS_ROUTING_RULES_DRAFT.md`
- `.github/instructions/multi-agent-routing.instructions.md`

### Interface and Contract Reference

- `CORE_COMMAND_INTERFACE_V1.md`
- `DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`
- `AUTONOMY_CONTRACT_SCHEMAS.json`
- `MEMORY_API_CONTRACT.md`
- `MEMORY_QUEUE_POLICY_V1.md`

### Runtime Topology and Tooling Reference

- `LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`
- `LOCAL_FIRST_HYBRID_AUTONOMY.md`
- `REMOTE_ONLY_AUTONOMY_IMPLEMENTATION.md`
- `OPENCODE_EXECUTOR_MIN_SPEC.md`

## Archive / Shrink Rules

아래 규칙으로 문서 과증식을 막는다.

1. dated closure, dry-run, checklist snapshot 문서는 새 상태를 덧쓰지 말고 historical evidence로만 유지한다.
2. `*_followup-ops-closure.md`, `MULTI_AGENT_DRY_RUN_*.md`, `*_RESULTS.md`는 다음 수정 시 `gate-runs/` 또는 별도 archive 위치로 이동하고, 현재 위치에는 5~10줄 요약만 남긴다.
3. legacy execution plan, prompt template, draft routing 문서는 새 실행 상태를 쓰지 않고 현재 canonical/reference 문서 링크만 유지한다.
4. interface/contract reference 문서는 계약 정본으로 유지하되 우선순위나 WIP 상태를 서술하지 않는다.
5. local runtime/tooling 설계 문서는 가능한 동작과 future target state를 분리해 쓰고, 실제 가용성은 `../RUNTIME_NAME_AND_SURFACE_MATRIX.md`와 코드 surface로만 판정한다.

## Immediate Archive Candidates

다음 문서는 현재 운영 판단을 직접 바꾸지 않으며, 다음 손댈 때 archive/shrink 대상으로 우선 처리한다.

- `2026-03-18_followup-ops-closure.md`
- `2026-03-19_followup-ops-closure.md`
- `MULTI_AGENT_DRY_RUN_2026-03-19.md`
- `PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md`
- `OPENCODE_NEMOCLAW_OPENDEV_EXECUTION_PLAN.md`
- `OPENCODE_NEMOCLAW_OPENDEV_OPENJARVIS_PROMPT_TEMPLATES.md`
- `OPENJARVIS_ROUTING_RULES_DRAFT.md`

정리 원칙:

1. Historical 문서는 재판단 근거로만 사용하고 현재 우선순위는 바꾸지 않는다.
2. Legacy or Narrow-Scope 문서는 domain 배경 설명으로만 사용하고 active plan으로 취급하지 않는다.
3. Canonical 문서와 충돌 시 Historical/Legacy 문서 내용을 업데이트하지 말고 링크만 남긴다.
4. Queued work는 `EXECUTION_BOARD.md`에서만 승격 여부를 결정하고, backlog owner는 `SPRINT_BACKLOG_MEMORY_AGENT.md`의 `A-001`~`A-003`로만 매핑한다.
