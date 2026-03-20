# IDE MCP Workspace Setup

목표:

- 이 저장소를 VS Code에서 열었을 때 워크스페이스 단위 MCP 서버를 바로 인식하게 한다.
- 에이전트가 코드 탐색은 `muelIndexing`, 일반 MCP 도구는 `muelCore`를 우선 사용하도록 운영 기준을 명확히 한다.

## 등록된 워크스페이스 MCP 서버

설정 파일:

- [.vscode/mcp.json](.vscode/mcp.json)

서버 목록:

1. `muelCore`
   - command: `npm run mcp:dev`
   - 역할: 기존 Muel MCP 도구

2. `muelIndexing`
   - command: `npm run mcp:indexing:dev`
   - 역할: 심볼 검색, 범위 읽기, 아웃라인, 컨텍스트 번들, 보안 후보 JSONL 조회

## VS Code에서 활성화하는 절차

1. 이 저장소를 VS Code로 연다.
2. Command Palette에서 `MCP: List Servers`를 실행한다.
3. `muelCore`, `muelIndexing` 서버를 각각 Enable 또는 Start 한다.
4. 신뢰 프롬프트가 뜨면 설정을 검토하고 승인한다.
5. 도구 목록이 오래된 경우 `MCP: Reset Cached Tools`를 실행한다.

## 권장 사용 방식

1. 코드 탐색, 영향 범위 파악, 리뷰 트리아지는 `muelIndexing` 우선
2. 일반 MCP 액션, 외부 연동, 기존 도구 실행은 `muelCore` 사용
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
