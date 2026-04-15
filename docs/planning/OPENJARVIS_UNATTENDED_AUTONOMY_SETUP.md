# OpenJarvis Unattended Autonomy Setup

목표:

- OpenJarvis가 사람 개입 없이 주기적으로 게이트 판정, 리포트 생성, 배포 트리거를 수행한다.

## 1) 실행 구성

실행 흐름:

1. `gates:weekly-report:all` 실행 (주간 지표/요약 생성)
2. `gates:validate:strict` 실행 (게이트 로그/체크리스트 검증 + Runtime Artifact VCS Policy 강제)
3. `rehearsal:stage-rollback:validate:strict` 실행 (복귀 준비도 검증)
4. 최신 게이트가 `go`이고 `autoDeploy=true`면 Render 배포 트리거

오케스트레이터:

- 스크립트: `scripts/run-openjarvis-unattended.mjs`
- 워크플로우: `.github/workflows/openjarvis-unattended.yml`

## 2) 필수 시크릿

GitHub Actions Secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (대체: `SUPABASE_KEY`)

자동 배포를 워크플로우에서 활성화하려면:

- 워크플로우 env에 `RENDER_SERVICE_ID`, `RENDER_API_KEY`를 추가한다.
- 현재 기본 템플릿은 진단 경고를 피하기 위해 Render env 주입을 비활성화한 상태다.

## 3) 무인 운영 모드

기본 스케줄:

- 6시간마다 자동 실행 (`cron: 17 */6 * * *`)

수동 트리거 입력:

- `dryRun`: 외부 반영 없는 검증 모드
- `autoDeploy`: 게이트가 `go`일 때 배포 허용
- `autoCommitReports`: 생성된 planning 리포트 자동 커밋
- `routeMode`: `auto | delivery | operations` (기본값 `auto`)

기본 라우팅:

- `OPENJARVIS_ROUTE_MODE=auto`
- `auto`는 scope/objective 힌트로 delivery/operations를 자동 선택

## 4) 실패 정책

- 어느 단계든 실패하면 `final_status=fail`
- strict 모드에서 실패 시 workflow 실패 처리
- 배포 실패도 실패로 판정
- 결과 요약은 `tmp/autonomy/openjarvis-unattended-last-run.json`에 저장
- 세션 타임라인은 `tmp/autonomy/workflow-sessions/*.json`에 저장
- 위 2개 경로는 런타임 산출물이며 기본 정책은 VCS 비추적이다.
- 예외는 incident evidence 또는 test fixture 용도로 최소 범위 커밋하는 경우만 허용한다.
- 예외 커밋에는 목적, 시간 범위, 보존 또는 제거 계획을 동일 변경셋에 기록한다.

## 5) 운영 명령

로컬 점검:

- `npm run openjarvis:autonomy:run:dry`
- `npm run openjarvis:goal:run:hidden -- --objective="<goal>" --dryRun=true`

실행:

- `npm run openjarvis:autonomy:run`
- `npm run openjarvis:goal:run -- --objective="<goal>" --dryRun=false --routeMode=auto`
- `npm run openjarvis:autopilot:start -- --objective="<goal>" --dryRun=false --routeMode=auto`
- `npm run openjarvis:autopilot:resume`
- `npm run openjarvis:autopilot:loop -- --objective="<goal>" --dryRun=false --routeMode=operations`
- `npm run openjarvis:autopilot:queue`
- `npm run openjarvis:autopilot:queue:hidden`
- `npm run openjarvis:autopilot:queue:chat`
- `npm run openjarvis:autopilot:gcp-recovery:overnight`
- `npm run openjarvis:autopilot:gcp-recovery:overnight:hidden`

Hermes runtime control:

- `npm run openjarvis:hermes:runtime:queue-objective -- --objective="<goal>"`
- `npm run openjarvis:hermes:runtime:chat-launch -- --objective="<goal>"`

상태 확인:

- `npm run openjarvis:goal:status`
- `npm run openjarvis:packets:sync`

운영 메모:

- goal wrapper는 기존 unattended engine을 재사용하되 `scope=interactive:goal`, `stage=interactive` 로 세션을 분리해 저장한다.
- Windows interactive launch 기본값은 visible PowerShell 이며, Hermes 가 실제 goal-cycle 을 시작할 때 새 창을 띄워 작업을 눈에 보이게 한다.
- visible PowerShell 은 이제 detached runner 의 monitor 창이다. 창을 닫아도 실제 runner 는 `tmp/autonomy/launches/*.log` 에 로그를 남기며 계속 진행되고, 최신 launch manifest 는 `tmp/autonomy/launches/latest-interactive-goal.json` 에 기록된다.
- interactive goal runner 는 실행 시작과 종료 시점에 active continuity handoff/progress packet 을 자동 갱신한다. shared adapter write 와 별도로 local vault mirror 도 유지해서 다음 GPT 세션이 로컬 packet state 로 복구할 수 있게 한다. 필요하면 `npm run openjarvis:packets:sync` 로 최신 세션 기준 수동 동기화도 가능하다.
- `openjarvis:autopilot:resume` 는 local continuity packet 을 읽고 one-shot resume 가능 여부를 판정한다. progress packet 이 resumable 상태면 같은 objective 로 즉시 새 cycle 을 붙이고, 아니면 왜 멈췄는지 `resume_state` 로 반환한다.
- `openjarvis:autopilot:loop` 는 bounded supervisor 로 동작한다. visible monitor 를 닫아도 숨겨진 loop runner 는 남아 있고, packet 이 `wait for the next GPT objective or human approval boundary` 상태가 아니고 escalation 이 없을 때만 다음 cycle 을 자동 launch 한다.
- `openjarvis:autopilot:queue` 는 Safe Autonomous Queue 와 `docs/planning/EXECUTION_BOARD.md` 의 `Queued Now` 를 읽어서 승인된 다음 objective 후보를 고른다. 우선순위는 packet safe queue, 그 다음 execution board queued item 이며, 같은 fingerprint 는 같은 supervisor run 안에서 재선택하지 않는다.
- `openjarvis:autopilot:queue:chat` 는 위 queue selection 에 더해 `autoLaunchQueuedChat=true` 를 켠 bounded handoff profile 이다. 승인된 다음 objective 를 continuity packet safe queue 에 다시 기록하고, native VS Code `code chat` surface 로 새 GPT turn 을 연 뒤 stop reason 을 `queued_chat_launched` 로 남기고 supervisor 를 종료한다.
- `openjarvis:hermes:runtime:queue-objective` 와 `openjarvis:hermes:runtime:chat-launch` 는 같은 runtime control service 를 직접 호출하는 low-level operator entrypoint 다. queue write 와 chat launch 를 분리해서 진단하거나 수동 재시도할 때 사용한다.
- `openjarvis:autopilot:gcp-recovery:overnight` 는 GCP capacity recovery 를 explicit operations route 로 고정하고, `maxCycles=0`, `maxIdleChecks=0` 를 unbounded sentinel 로 사용해서 capacity target, escalation, wait boundary, 또는 explicit failure 가 나올 때까지 overnight loop 를 유지한다. 현재 objective 가 닫힌 뒤에는 `autoSelectQueuedObjective=true` 로 승인된 다음 objective 를 이어서 선택할 수 있다.
- `openjarvis:goal:status` 는 현재 workflow 상태 외에 `resume_state`, `continuity_packets`, `supervisor`, 마지막 auto-open VS Code CLI bridge 결과도 보여준다.
- `openjarvis:goal:status` 와 compact session-open bundle 은 이제 `autonomous_goal_candidates` 를 함께 노출해서 GPT 와 Hermes 가 같은 next-objective shortlist 를 본다.
- visible resume/loop launch 에서는 필요하면 local progress packet 을 VS Code CLI allowlist bridge 로 열어서 editor control plane 이 실제로 호출되었는지 manifest 와 status 에 남긴다.
- headless 검증이나 CI 성격의 실행은 `openjarvis:goal:run:hidden` 또는 `--visibleTerminal=false` 를 사용한다.
- latest summary는 여전히 `tmp/autonomy/openjarvis-unattended-last-run.json` 에 기록되고, 상세 타임라인은 `tmp/autonomy/workflow-sessions/*.json` 에 남는다.
- live run 전에 prompt/instruction/skill 병목을 보고 싶다면 `npm run agent:context:audit` 로 항상-로드 instruction과 큰 skill/workflow 파일을 먼저 확인한다.
- operations route 나 explicit GCP recovery objective 에서는 unattended engine 이 `ops:gcp:report:weekly` 를 memory sync 앞에 추가해, remote always-on lane 상태를 먼저 기록한 뒤 나머지 gate and deploy flow 로 넘어간다.

## 6) 완전 무인 운영 권장값

- `autoCommitReports=true`
- `autoDeploy=true` (운영 안정화 후)
- `AUTONOMY_STRICT=true`

권장 단계:

1. 첫 1주: `dryRun=true`, `autoDeploy=false`
2. 둘째 주: `dryRun=false`, `autoDeploy=false`
3. 셋째 주 이후: `autoDeploy=true` 전환

## 7) 감사/추적 포인트

- 워크플로우 run id
- 최신 gate-run decision (`go|no-go|pending`)
- 배포 시도 횟수와 HTTP 상태코드
- planning 자동 커밋 해시
