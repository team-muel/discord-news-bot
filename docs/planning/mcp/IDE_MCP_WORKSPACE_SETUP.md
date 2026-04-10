# IDE MCP Workspace Setup

목표:

- 이 저장소를 VS Code에서 열었을 때 워크스페이스 MCP 서버를 바로 인식하게 한다.
- shared/team context는 GCP shared MCP를 우선 사용하고, dirty workspace는 로컬 overlay로 분리한다.
- 팀원이 GCP shared MCP에 접속하고, 새 도구 변경을 publish하는 절차를 문서화한다.

## 등록된 워크스페이스 MCP 서버

설정 파일:

- `.vscode/mcp.json`

### stdio 서버

- `muelIndexing`: `npm run mcp:indexing:dev` — local overlay index for dirty workspace / uncommitted files only
- `muelUnified`: `npm run mcp:unified:dev` — local unified hub for actions, ext adapters, upstream tools, and local-only vault overlay work
- `gcpCompute`: SSH stdio — GCP VM shared unified MCP for team-shared repo state and shared tool surface

### HTTP upstream 서버

HTTP 외부 MCP 서버는 `.vscode/mcp.json`에 직접 등록하지 않고 `MCP_UPSTREAM_SERVERS` 환경 변수로 구성한다.
`muelUnified`가 시작될 때 자동으로 `upstream.<namespace>.*` 도구로 노출된다.

- Supabase MCP: namespace `supabase`, `.env`의 `MCP_UPSTREAM_SERVERS` JSON 배열로 등록
- DeepWiki MCP: namespace `deepwiki`, `.env`의 `MCP_UPSTREAM_SERVERS` JSON 배열로 등록

예시 `.env`:

```env
MCP_UPSTREAM_SERVERS=[{"id":"supabase","url":"https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF","namespace":"supabase","token":"sbp_xxx"},{"id":"deepwiki","url":"https://mcp.deepwiki.com/mcp","namespace":"deepwiki"}]
```

## 팀 온보딩 순서

1. `scripts/bootstrap-team.ps1`를 실행한다.
2. 생성된 SSH public key를 팀 리드에게 전달한다.
3. 팀 리드는 `scripts/register-team-ssh.ps1`로 키를 등록한다.
4. VS Code를 재시작하고 `MCP: List Servers`에서 `gcpCompute`를 Enable 또는 Start 한다.
5. shared MCP 쪽 도구를 바꿨다면 `scripts/publish-gcp-shared-mcp.ps1 -RestartServices`로 GCP VM에 반영한다.

## GCP shared MCP 운영 기준

- canonical public ingress: `https://34.56.232.61.sslip.io/mcp`
- compatibility alias: `https://34.56.232.61.sslip.io/obsidian`
- remote repo path: `/opt/muel/discord-news-bot`
- shared runtime override file: `config/env/unified-mcp.gcp.env`
- `gcpCompute`는 원격에서 `.env`를 먼저 로드하고, 그 다음 `config/env/unified-mcp.gcp.env` override를 로드한다.
- `unified-mcp-http.service`도 같은 순서로 env를 읽는다.

## 권장 사용 방식

1. 팀 공용 상태, 운영 기준, 공용 repo index, shared Obsidian read/write는 `gcpCompute` 우선
2. dirty workspace, 미커밋 변경, 로컬 실험은 `muelIndexing` 우선
3. 일반 MCP 액션, upstream 도구, 로컬 전용 vault 실험은 `muelUnified` 사용
4. raw grep/read 전에 index 도구로 범위를 먼저 줄인다.

## indexing overlap 기준

| 상황 | 기본 서버 | 이유 |
| ---- | --------- | ---- |
| 팀 공용 branch 상태, 커밋된 코드, 리뷰 기준선 | `gcpCompute` | 팀이 공유하는 동일 repo 상태를 본다 |
| 미커밋 변경, 로컬 임시 파일, branch-only 실험 | `muelIndexing` | 로컬 overlay를 즉시 반영한다 |
| shared truth와 local patch를 함께 봐야 하는 경우 | `gcpCompute` 후 `muelIndexing` | 먼저 shared 기준선을 잡고 local diff만 overlay로 비교한다 |

겹치는 인덱싱 도구는 `symbol_search`, `symbol_define`, `symbol_references`, `file_outline`, `scope_read`, `context_bundle`, `security.candidates_list`다. 이 7개는 모두 shared/team 기준이면 `gcpCompute`, local-only 변경이면 `muelIndexing`로 고정해서 생각하는 편이 덜 헷갈린다.

## shared MCP 변경 publish 원칙

1. 원격 repo가 dirty이면 publish를 중단한다. 강제로 덮어쓸 때만 `-Force`를 사용한다.
2. 기본 publish 세트는 shared MCP surface에 필요한 파일과 디렉터리만 sync한다.
3. 새 도구가 기본 세트 밖 파일을 건드리면 `-IncludePath`로 추가 경로를 넘긴다.
4. publish 후에는 `https://34.56.232.61.sslip.io/mcp/health`로 health를 확인한다.

## 운영 메모

- Windows에서는 MCP sandboxing을 기대하지 않는다.
- `muelIndexing`은 `.env`를 로드하며, 워크스페이스 루트를 인덱싱 루트로 사용하는 local overlay다. shared truth를 대체하는 기본 인덱서로 쓰지 않는다.
- `muelUnified`는 시작 시 `MCP_UPSTREAM_SERVERS`를 파싱하여 upstream 서버를 자동 등록한다.
- 응답에는 `metadata.repoId`, `metadata.branch`, `metadata.commitSha`, `metadata.indexedAt`, `metadata.indexVersion`, `metadata.freshness`가 포함된다.
- stricter 운영이 필요하면 `.env`에 `INDEXING_MCP_STRICT=true` 또는 `INDEXING_MCP_STALE_POLICY=fail`을 설정한다.
- `security.candidates_list`는 `view=raw|merged`를 지원한다. merged 파일이 없으면 raw JSONL로부터 review unit을 즉시 합성한다.

## 트러블슈팅

1. 서버가 보이지 않으면 `MCP: Open Workspace Folder MCP Configuration`으로 `.vscode/mcp.json`을 확인한다.
2. 도구가 안 보이면 `MCP: Reset Cached Tools` 후 서버를 Restart 한다.
3. 신뢰 문제면 `MCP: Reset Trust` 후 다시 Start 한다.
4. `gcpCompute`가 연결되지 않으면 `scripts/bootstrap-team.ps1` 출력에서 SSH access 상태와 shared MCP health 상태를 확인한다.
5. upstream 도구가 보이지 않으면 `.env`의 `MCP_UPSTREAM_SERVERS` JSON을 검증하고 `muelUnified`를 Restart 한다.
