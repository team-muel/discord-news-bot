# Opencode Publish Worker Minimum Spec

Boundary note:

- `opencode` in this document refers to the repository-local GitHub change-request and publish worker surface
- current name-collision interpretation and runtime-backed surface truth must be checked in `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`
- this document specifies the publish loop behavior, not proof of a generic upstream framework embedding

목표:

- 현재 구현된 change-request/publish-queue 컨트롤 플레인을 실제 GitHub PR 생성까지 닫힌 루프로 완성한다.
- `opencode.execute` 실행 결과가 "코드 수정 -> 검토/승인 -> publish"로 이어지는 자동 코드 개선 파이프라인을 제공한다.

비목표:

- 무제한 무승인 자동 배포
- 브랜치 보호 규칙 우회
- 파괴적 명령 실행 자동 허용

## 1) 현재 전제(이미 구현됨)

- Change request 테이블: `agent_opencode_change_requests`
- Publish queue 테이블: `agent_opencode_publish_queue`
- 운영 API:
  - create/list/decision change requests
  - enqueue/list publish jobs
  - readiness summary

참조:

- `docs/SUPABASE_SCHEMA.sql`
- `src/services/opencodeGitHubQueueService.ts`
- `src/routes/bot.ts`

## 2) Worker 책임 경계

Publish worker는 아래만 담당한다.

1. `queued` publish job polling
2. GitHub branch/commit/PR 실행
3. job/change-request 상태 업데이트
4. 실패시 재시도/종료 기준 적용

아래는 컨트롤 플레인이 담당한다.

- 승인 정책(runMode, approval_required)
- 길드 단위 권한/감사
- 운영 API 노출 및 관리자 액션

## 3) 상태 전이(최소)

Publish job 상태:

- `queued` -> `running` -> `succeeded`
- `queued|running` -> `failed`
- `queued|running` -> `canceled`

Change request 상태:

- `approved` -> `queued_for_publish`
- `queued_for_publish` -> `published`
- `queued_for_publish` -> `failed`

완료 시 기록:

- `agent_opencode_publish_queue.result`에 branch/commit/pr_url 저장
- `agent_opencode_change_requests.publish_url`에 PR URL 저장

## 4) GitHub Adapter 계약

입력(최소):

- `guild_id`
- `change_request_id`
- `target_base_branch` (default `main`)
- `proposed_branch` (없으면 worker가 생성)
- `files` / `diff_patch`
- `title` / `summary`

출력(최소):

- `branch`
- `commit_sha`
- `pr_number`
- `pr_url`
- `provider` (`github`)

실패 출력:

- `error_code` (예: `GITHUB_AUTH`, `PATCH_APPLY_FAILED`, `PR_CREATE_FAILED`)
- `error_message`
- `retryable` boolean

## 5) 실행 알고리즘(최소)

1. 한 번에 N개(기본 1~3) `queued` jobs를 락 기반으로 가져온다.
2. `running`으로 전이 + `started_at` 기록.
3. change request 조회 및 상태 검증(`approved|queued_for_publish`).
4. 브랜치 준비:
   - `proposed_branch` 있으면 사용
   - 없으면 `agent/<guild>/<changeRequestId>-<ts>` 생성
5. 변경 적용:
   - 우선 `diff_patch` 적용
   - 없으면 `files` 기준 템플릿/패치 전략 사용(초기에는 `diff_patch` 필수 권장)
6. 커밋/푸시 후 PR 생성.
7. 성공시:
   - job=`succeeded`, `ended_at` 기록
   - change request=`published`, `publish_url` 기록
8. 실패시:
   - 재시도 가능한 오류면 backoff 후 `queued` 복귀(시도 횟수 증가)
   - 비재시도/횟수 초과면 `failed`

## 6) 멱등성/중복 방지

필수 규칙:

- 동일 `change_request_id`에 대해 `running|succeeded` publish job이 있으면 신규 실행 차단
- PR 생성 전에 기존 오픈 PR 존재 여부 확인(동일 브랜치/제목 규칙)
- worker 재시작 시 `running` 오래된 작업(stale) 재조정

권장 키:

- idempotency key: `guild_id:change_request_id:provider`

## 7) 재시도 정책(초기값)

- `maxAttempts=3`
- backoff: 30s, 120s, 300s
- retryable:
  - GitHub 5xx
  - 일시적 네트워크 오류
  - rate limit reset이 짧은 경우
- non-retryable:
  - 권한 부족(403)
  - 잘못된 patch 형식
  - 대상 repo/branch 정책 위반

## 8) 환경변수(최소)

- `OPENCODE_PUBLISH_WORKER_ENABLED=true|false`
- `OPENCODE_PUBLISH_WORKER_INTERVAL_MS=5000`
- `OPENCODE_PUBLISH_WORKER_BATCH_SIZE=2`
- `OPENCODE_PUBLISH_MAX_ATTEMPTS=3`
- `OPENCODE_PUBLISH_STALE_RUNNING_MS=900000`
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_INSTALLATION_ID`
  - 또는 PAT 기반 대체: `GITHUB_TOKEN`
- `OPENCODE_TARGET_REPO_OWNER`
- `OPENCODE_TARGET_REPO_NAME`

## 9) 관측성(필수)

로그 필드:

- `job_id`, `change_request_id`, `guild_id`, `provider`, `attempt`, `duration_ms`, `status`

지표:

- publish success rate
- mean queue latency (`queued` -> `running`)
- mean publish duration (`running` -> terminal)
- retry rate and top error codes

운영 API로 즉시 확인 가능한 항목:

- `/api/bot/agent/opencode/publish-queue`
- `/api/bot/agent/opencode/readiness`

## 10) 롤아웃 계획

1. Shadow mode:
   - 실제 PR 생성 없이 validation only 실행
2. Canary guild:
   - 지정 길드 1~2개만 활성화
3. Gradual rollout:
   - 실패율/지연 지표 기준으로 확대
4. Default-on:
   - baseline 충족 시 일반 guild 확장

권장 기준:

- 7일 기준 success rate >= 95%
- retry-after-fail recover >= 80%
- 치명 오류(권한/오적용) 0건

## 11) 완료 정의(Definition of Done)

아래 E2E가 자동으로 재현되면 완료:

1. change request 생성
2. 승인(`approve`)
3. queue publish
4. worker가 PR 생성
5. change request=`published`, `publish_url` 설정
6. readiness에서 `succeeded` 누적 확인
