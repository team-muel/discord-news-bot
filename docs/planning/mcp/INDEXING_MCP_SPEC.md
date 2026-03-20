# Indexing MCP Spec

목표:

- 중앙 소스코드 인덱싱 서버를 MCP 표준 도구 계층으로 노출한다.
- 모델과 에이전트는 저장소 원문을 직접 대량 조회하지 않고, 인덱스와 범위 조회 도구를 우선 사용한다.
- 보안 후보군 파이프라인은 JSONL 기반 내부 포맷을 유지하고, 필요 시에만 SARIF로 변환한다.

## 1) 책임 범위

in-scope:

- 저장소 스냅샷 수집
- 커밋 단위 인덱싱
- 심볼/범위/참조 조회
- 문서/의존 그래프 보조 인덱스 조회
- 보안 후보군 JSONL 조회
- 감사 로그와 commit 기준 응답 보장

out-of-scope:

- 취약점 최종 판정
- 자동 수정 생성
- 승인/배포 게이트 판정

## 2) 하드 게이트

1. 모든 응답은 `repoId`, `branch`, `commitSha`를 포함해야 한다.
2. 기본 동작은 read-only다.
3. repo 경계를 넘는 조회를 허용하지 않는다.
4. stale index는 경고 또는 fail-closed 정책으로 처리한다.
5. startup/auth/scheduler 안정성, graph-first retrieval, Discord deliverable sanitization, workflow idempotency를 저해하지 않는다.

## 3) 최소 도구 세트 (MVP)

### 3.1 `code.index.symbol_search`

- 목적: 이름 또는 패턴으로 심볼 후보를 찾는다.
- 입력:
  - `repoId: string`
  - `branch?: string`
  - `commitSha?: string`
  - `query: string`
  - `kind?: string`
  - `limit?: number`
- 출력:
  - 심볼 id
  - 이름
  - 종류
  - 파일 경로
  - 시작/종료 라인
  - export 여부
  - score

### 3.2 `code.index.symbol_define`

- 목적: 특정 심볼의 정의 위치와 선언 범위를 반환한다.
- 입력:
  - `repoId: string`
  - `symbolId?: string`
  - `name?: string`
  - `filePathHint?: string`
- 출력:
  - 정의 위치
  - 선언 블록
  - 시그니처
  - import/export 요약

### 3.3 `code.index.symbol_references`

- 목적: 특정 심볼의 참조 위치를 반환한다.
- 입력:
  - `repoId: string`
  - `symbolId: string`
  - `limit?: number`
- 출력:
  - 참조 파일
  - 참조 위치
  - 참조 종류(import/call/read/write)
  - confidence

### 3.4 `code.index.file_outline`

- 목적: 파일의 top-level 구조를 반환한다.
- 입력:
  - `repoId: string`
  - `filePath: string`
- 출력:
  - top-level symbol tree
  - import/export 목록
  - 함수/클래스/메서드 범위

### 3.5 `code.index.scope_read`

- 목적: 특정 함수/클래스/라인 기준 범위를 반환한다.
- 입력:
  - `repoId: string`
  - `filePath: string`
  - `symbolId?: string`
  - `line?: number`
  - `contextLines?: number`
- 출력:
  - 파일 경로
  - 시작/종료 라인
  - 범위 텍스트

### 3.6 `code.index.context_bundle`

- 목적: 특정 목표를 이해하는 데 필요한 최소 코드/문서 묶음을 반환한다.
- 입력:
  - `repoId: string`
  - `goal: string`
  - `maxItems?: number`
  - `changedPaths?: string[]`
- 출력:
  - 관련 심볼
  - 관련 범위
  - 관련 문서
  - 추천 읽기 순서

### 3.7 `security.candidates_list`

- 목적: 특정 커밋 기준 보안 후보군 JSONL 레코드를 조회한다.
- 입력:
  - `repoId: string`
  - `branch?: string`
  - `commitSha?: string`
  - `candidateKind?: string`
  - `limit?: number`
- 출력:
  - candidate JSONL 레코드 목록
  - merged review unit 여부
  - 집계 메타데이터

## 4) 내부 데이터 포맷

### 4.1 Raw Candidate JSONL

필수 필드:

- `id`
- `commit_sha`
- `file_path`
- `start_line`
- `end_line`
- `code_snippet`
- `rule_id`
- `fingerprint`
- `candidate_kind`

### 4.2 Merged Review Unit JSONL

필수 필드:

- `id`
- `commit_sha`
- `file_path`
- `start_line`
- `end_line`
- `code_snippet`
- `raw_candidate_ids`
- `merged_count`
- `candidate_kind`

권장 필드:

- `symbol_name`
- `rule_ids`
- `source_kind`
- `sink_kind`

## 5) Discovery / Analysis 파이프라인 규칙

1. Discovery는 취약점 확정기가 아니라 분석 예산 배분기다.
2. Discovery는 no-browse 우선을 유지하고, borderline 사례에만 제한된 browse를 허용한다.
3. Analysis만 정밀 판정을 수행한다.
4. candidate 단계는 JSONL, confirmed finding 단계는 SARIF를 사용한다.

## 6) 운영/감사 메타데이터

모든 도구 응답은 아래를 포함해야 한다.

- `repoId`
- `branch`
- `commitSha`
- `indexedAt`
- `indexVersion`

보안/컴플라이언스 요구:

- 요청자/에이전트 id 로그
- 조회한 파일 범위 로그
- repo allowlist
- 민감 경로/파일 제외 정책

구현 메모:

- 현재 워크스페이스 MCP 구현은 응답 본문에 `metadata` 객체를 추가하는 additive 방식으로 위 메타데이터를 보장한다.
- `INDEXING_MCP_STRICT=true` 또는 `INDEXING_MCP_STALE_POLICY=fail`이면 branch/commit 불일치나 stale index를 fail-closed로 처리한다.
- `security.candidates_list`는 기본 raw 뷰 외에 `view=merged`를 지원하며, 별도 merged JSONL이 없으면 raw candidate를 읽어 merged review unit을 런타임 생성한다.

## 7) 구현 우선순위

1. `code.index.symbol_search`
2. `code.index.scope_read`
3. `security.candidates_list`
4. `code.index.file_outline`
5. `code.index.symbol_define`
6. `code.index.symbol_references`
7. `code.index.context_bundle`

## 8) 검증 기준

1. 동일 커밋에서 동일 결과를 재현할 수 있어야 한다.
2. 응답에는 항상 commit 기준이 포함되어야 한다.
3. stale index일 때 경고 또는 차단이 동작해야 한다.
4. candidate JSONL 계약과 SARIF 변환 계약이 fixture로 검증되어야 한다.