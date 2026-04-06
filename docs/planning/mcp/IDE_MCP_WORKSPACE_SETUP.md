# IDE MCP Workspace Setup

목표:

- 이 저장소를 VS Code에서 열었을 때 워크스페이스 단위 MCP 서버를 바로 인식하게 한다.
- 에이전트가 코드 탐색은 `muelIndexing`, 일반 MCP 도구는 `muelUnified`를 우선 사용하도록 운영 기준을 명확히 한다.

## 등록된 워크스페이스 MCP 서버

설정 파일:

- [.vscode/mcp.json](.vscode/mcp.json)

### stdio 서버 (로컬 프로세스)

| 서버 ID | command | 역할 |
|---------|---------|------|
| `muelIndexing` | `npm run mcp:indexing:dev` | 심볼 검색, 범위 읽기, 아웃라인, 컨텍스트 번들, 보안 후보 조회 |
| `muelUnified` | `npm run mcp:unified:dev` | 통합 진입점 — general + indexing + Obsidian + ext.* + upstream.* |
| `gcpCompute` | SSH stdio | GCP VM 원격 통합 서버 |

### HTTP upstream 서버 (MCP_UPSTREAM_SERVERS)

HTTP 외부 MCP 서버는 `.vscode/mcp.json`에 직접 등록하지 않고 `MCP_UPSTREAM_SERVERS` 환경 변수로 구성한다.
`muelUnified`가 시작될 때 자동으로 `upstream.<namespace>.*` 툴로 노출된다.

| 서버 | namespace | 구성 방법 |
|------|-----------|-----------|
| Supabase MCP | `supabase` | `.env`의 `MCP_UPSTREAM_SERVERS` JSON 배열 |
| DeepWiki MCP | `deepwiki` | `.env`의 `MCP_UPSTREAM_SERVERS` JSON 배열 |

예시 (`.env`):
```
MCP_UPSTREAM_SERVERS=[{"id":"supabase","url":"https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF","namespace":"supabase","token":"sbp_xxx"},{"id":"deepwiki","url":"https://mcp.deepwiki.com/mcp","namespace":"deepwiki"}]
```

## VS Code에서 활성화하는 절차

1. 이 저장소를 VS Code로 연다.
2. Command Palette에서 `MCP: List Servers`를 실행한다.
3. `muelUnified`, `muelIndexing` 서버를 각각 Enable 또는 Start 한다.
4. 신뢰 프롬프트가 뜨면 설정을 검토하고 승인한다.
5. 도구 목록이 오래된 경우 `MCP: Reset Cached Tools`를 실행한다.

## 권장 사용 방식

1. 코드 탐색, 영향 범위 파악, 리뷰 트리아지는 `muelIndexing` 우선
2. 일반 MCP 액션, 외부 연동, Obsidian 쓰기, upstream 도구는 `muelUnified` 사용
3. 무차별 grep/read를 먼저 하지 말고, 인덱스 결과로 범위를 먼저 줄인다.

## 에이전트별 권장 MCP 사용

### OpenCode

- 우선 도구:
  - `code.index.symbol_search`
  - `code.index.scope_read`
  - `code.index.file_outline`
  - `code.index.context_bundle`

### NemoClaw

- 우선 도구:
  - `code.index.symbol_define`
  - `code.index.symbol_references`
  - `code.index.scope_read`
  - `security.candidates_list`

### OpenJarvis

- 우선 도구:
  - `code.index.context_bundle`
  - `code.index.file_outline`
  - `code.index.scope_read`

### OpenDev

- 우선 도구:
  - `code.index.context_bundle`
  - `code.index.file_outline`
  - `code.index.symbol_search`

## 운영 메모

- Windows에서는 MCP sandboxing을 기대하지 않는다.
- `muelIndexing`은 `.env`를 로드하며, 워크스페이스 루트를 인덱싱 루트로 사용한다.
- `muelUnified`는 시작 시 `MCP_UPSTREAM_SERVERS`를 파싱하여 upstream 서버를 자동 등록한다.
- 인덱스가 부족하거나 stale일 수 있으므로, 에이전트는 필요한 경우 raw read로 확인한다.
- 응답에는 `metadata.repoId`, `metadata.branch`, `metadata.commitSha`, `metadata.indexedAt`, `metadata.indexVersion`, `metadata.freshness`가 포함된다.
- stricter 운영이 필요하면 `.env`에 `INDEXING_MCP_STRICT=true` 또는 `INDEXING_MCP_STALE_POLICY=fail`을 설정한다.
- `security.candidates_list`는 `view=raw|merged`를 지원한다. merged 파일이 없으면 raw JSONL로부터 review unit을 즉시 합성한다.

## 트러블슈팅

1. 서버가 보이지 않으면:
   - `MCP: Open Workspace Folder MCP Configuration`로 [.vscode/mcp.json](.vscode/mcp.json) 확인

2. 도구가 안 보이면:
   - `MCP: Reset Cached Tools`
   - 서버 Restart

3. 신뢰 문제면:
   - `MCP: Reset Trust`
   - 다시 Start 후 승인

4. 로그 확인:
   - `MCP: List Servers` -> 서버 선택 -> Show Output

5. upstream 도구(`upstream.supabase.*`, `upstream.deepwiki.*`)가 보이지 않으면:
   - `.env`에 `MCP_UPSTREAM_SERVERS`가 올바른 JSON으로 설정되어 있는지 확인
   - `muelUnified`를 Restart하여 등록을 재시도

## 에이전트별 권장 MCP 사용

### OpenCode

- 우선 도구:
  - `code.index.symbol_search`
  - `code.index.scope_read`
  - `code.index.file_outline`
  - `code.index.context_bundle`

### NemoClaw

- 우선 도구:
  - `code.index.symbol_define`
  - `code.index.symbol_references`
  - `code.index.scope_read`
  - `security.candidates_list`

### OpenJarvis

- 우선 도구:
  - `code.index.context_bundle`
  - `code.index.file_outline`
  - `code.index.scope_read`

### OpenDev

- 우선 도구:
  - `code.index.context_bundle`
  - `code.index.file_outline`
  - `code.index.symbol_search`

## 운영 메모

- Windows에서는 MCP sandboxing을 기대하지 않는다.
- `muelIndexing`는 `.env`를 로드하며, 워크스페이스 루트를 인덱싱 루트로 사용한다.
- 인덱스가 부족하거나 stale일 수 있으므로, 에이전트는 필요한 경우 raw read로 확인한다.
- 응답에는 `metadata.repoId`, `metadata.branch`, `metadata.commitSha`, `metadata.indexedAt`, `metadata.indexVersion`, `metadata.freshness`가 포함된다.
- stricter 운영이 필요하면 `.env`에 `INDEXING_MCP_STRICT=true` 또는 `INDEXING_MCP_STALE_POLICY=fail`을 설정한다.
- `security.candidates_list`는 `view=raw|merged`를 지원한다. merged 파일이 없으면 raw JSONL로부터 review unit을 즉시 합성한다.

## 트러블슈팅

1. 서버가 보이지 않으면:
   - `MCP: Open Workspace Folder MCP Configuration`로 [.vscode/mcp.json](.vscode/mcp.json) 확인

2. 도구가 안 보이면:
   - `MCP: Reset Cached Tools`
   - 서버 Restart

3. 신뢰 문제면:
   - `MCP: Reset Trust`
   - 다시 Start 후 승인

4. 로그 확인:
   - `MCP: List Servers` -> 서버 선택 -> Show Output
