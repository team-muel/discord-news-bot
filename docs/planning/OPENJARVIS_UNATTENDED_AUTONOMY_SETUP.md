# OpenJarvis Unattended Autonomy Setup

목표:

- OpenJarvis가 사람 개입 없이 주기적으로 게이트 판정, 리포트 생성, 배포 트리거를 수행한다.

## 1) 실행 구성

실행 흐름:

1. `gates:weekly-report:all` 실행 (주간 지표/요약 생성)
2. `gates:validate:strict` 실행 (게이트 로그/체크리스트 검증)
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

## 4) 실패 정책

- 어느 단계든 실패하면 `final_status=fail`
- strict 모드에서 실패 시 workflow 실패 처리
- 배포 실패도 실패로 판정
- 결과 요약은 `tmp/autonomy/openjarvis-unattended-last-run.json`에 저장

## 5) 운영 명령

로컬 점검:

- `npm run openjarvis:autonomy:run:dry`

실행:

- `npm run openjarvis:autonomy:run`

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
