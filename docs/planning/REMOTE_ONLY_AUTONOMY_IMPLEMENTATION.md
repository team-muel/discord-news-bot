# Remote-Only Autonomy Implementation (Local Dependency = 0)

목표:

- 로컬 PC가 꺼져 있어도 OpenJarvis 기반 자가 진화 루프가 24/7 지속된다.
- 상태/증거/판정/리포트는 Supabase + GitHub Actions + Render 경로에서만 생성/보존된다.

범위:

- in-scope: OpenJarvis unattended loop, weekly reports, go/no-go gates, remote deploy trigger, MCP worker delegation
- out-of-scope (초기): 로컬 파일시스템 기반 Obsidian write 경로

## 1) Remote-Only 불변 조건

1. OpenJarvis 실행 주체는 GitHub Actions 또는 원격 워커만 허용한다.
2. 필수 상태 저장은 Supabase 테이블로만 처리한다.
3. 고위험 실행은 approval_required + evidence bundle이 없으면 차단한다.
4. 로컬 파일시스템(local-fs) adapter를 운영 경로에서 제거한다.

## 2) 필수 환경 변수 (원격 루프 기준)

공통:

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (또는 SUPABASE_KEY)
- AUTONOMY_STRICT=true
- OPENJARVIS_REQUIRE_OPENCODE_WORKER=true
- MCP_OPENCODE_WORKER_URL=<remote worker base url>
- MCP_OPENCODE_TOOL_NAME=opencode.run

자동 배포 사용 시:

- AUTONOMY_AUTO_DEPLOY=true
- RENDER_SERVICE_ID=<render service id>
- RENDER_API_KEY=<render api key>

권장 안전값:

- ACTION_MCP_DELEGATION_ENABLED=true
- ACTION_MCP_STRICT_ROUTING=true
- ACTION_POLICY_FAIL_OPEN_ON_ERROR=false
- AGENT_READINESS_FAIL_OPEN=false

## 3) Obsidian Remote-Only 프로파일

원칙:

- read/search/graph는 headless-cli 우선
- write는 script-cli 또는 DB 경로만 사용
- local-fs는 adapter order에서 제거

권장값:

- OBSIDIAN_HEADLESS_ENABLED=true
- OBSIDIAN_HEADLESS_COMMAND=ob
- OBSIDIAN_ADAPTER_STRICT=true
- OBSIDIAN_ADAPTER_ORDER=headless-cli,script-cli
- OBSIDIAN_ADAPTER_ORDER_READ_LORE=headless-cli,script-cli
- OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT=headless-cli
- OBSIDIAN_ADAPTER_ORDER_READ_FILE=headless-cli
- OBSIDIAN_ADAPTER_ORDER_GRAPH_METADATA=headless-cli
- OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE=script-cli

주의:

- headless write capability가 불충분하면 write는 DB 적재 후 비동기 동기화로 처리한다.

## 4) 실행 순서 (D1-D7)

1. Supabase 마이그레이션 적용

- docs/planning/MIGRATION_AGENT_WEEKLY_REPORTS.sql

2. GitHub Actions unattended 루프 활성화

- .github/workflows/openjarvis-unattended.yml

3. OpenJarvis 원격 worker 강제

- OPENJARVIS_REQUIRE_OPENCODE_WORKER=true
- MCP_OPENCODE_WORKER_URL 설정

4. strict gate 강제

- AUTONOMY_STRICT=true
- gates:validate:strict 통과

5. remote-only adapter profile 적용

- local-fs 제거
- adapter strict 활성화

## 5) 운영 검증 (매일)

1. 최신 unattended summary 확인

- tmp/autonomy/openjarvis-unattended-last-run.json artifact

2. gate 판정 확인

- go/no-go 결과와 rollback_required 확인

3. workflow 상태 테이블 확인

- workflow_sessions
- workflow_steps
- workflow_events

4. weekly report 적재 확인

- agent_weekly_reports

## 6) 완료 기준 (Remote-Only Stage A)

1. 7일 연속 unattended run 성공 (strict=true)
2. no-go 발생 시 rollback evidence 100% 기록
3. local-fs adapter 선택 로그 0건
4. OpenJarvis 경유 실행 중 worker 미연결 fail-open 0건
5. weekly report 5종이 supabase sink로 누락 없이 기록

## 7) 실패 시 우선 조치

1. worker URL 누락/불능

- MCP_OPENCODE_WORKER_URL health 확인 후 rerun

2. gate strict 실패

- validate-go-no-go-runs 출력의 checklist 누락 우선 복구

3. 배포 트리거 실패

- RENDER_SERVICE_ID/RENDER_API_KEY 점검

4. adapter capability mismatch

- write 경로를 DB 중심으로 임시 우회하고 script-cli 복구

## 8) 변경 동기화 규칙

아래 문서는 항상 같은 PR에서 같이 갱신한다.

1. docs/planning/EXECUTION_BOARD.md
2. docs/planning/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md
3. docs/RUNBOOK_MUEL_PLATFORM.md
4. docs/CHANGELOG-ARCH.md
