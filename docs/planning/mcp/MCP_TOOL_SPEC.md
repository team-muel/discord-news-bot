# MCP Tool Spec (Muel v2)

This document defines the MCP tool contract for Muel's multi-server architecture.

> **Status: Live (2026-04-08)** — All servers operational. GCP unified surface is the canonical full-catalog access point. GitHub MCP added as cross-repo coordination layer.

## Scope

Protocol: JSON-RPC over stdio (MCP spec, line-delimited)  
Methods: `initialize`, `tools/list`, `tools/call`

## Server Inventory

| Server ID | Location | Transport | Tool Count | Primary Role |
| --------- | -------- | --------- | ---------- | ------------ |
| `github` | Remote / `.vscode/mcp.json` | HTTP (Copilot OAuth) | 40+ | Cross-repo GitHub operations |
| `muelIndexing` | Local / `.vscode/mcp.json` | stdio | 7 | Strict local overlay index for dirty workspace / uncommitted files |
| `muelUnified` | Local / `.vscode/mcp.json` | stdio | 40+ | Local hub (Obsidian, actions, ext adapters) |
| `gcpCompute` | GCP VM → SSH stdio | stdio (SSH) | 40+ (unified) | Remote shared MCP surface; public canonical ingress is `/mcp` |
| `supabase` | `MCP_UPSTREAM_SERVERS` | HTTP (upstream proxy) | DB | Data persistence |
| `deepwiki` | `MCP_UPSTREAM_SERVERS` | HTTP (upstream proxy) | — | External repo wiki |

Configuration file: `.vscode/mcp.json` (stdio + HTTP servers); `MCP_UPSTREAM_SERVERS` env var (runtime upstream servers)

## Routing Decision Table

Use this table to decide which MCP server to call for a given task category.

| Task Category | Primary Server | Fallback | Examples |
| ------------- | -------------- | -------- | -------- |
| **Cross-repo GitHub ops** | `github` | `autonomousGit.ts` (runtime) | PR CRUD, issue triage, repo search, branch mgmt, actions status |
| **Code analysis (shared repo state)** | `gcpCompute` | `muelIndexing` | Symbol search, references, scope read, context bundle |
| **Code analysis (dirty workspace / local-only diff)** | `muelIndexing` | `gcpCompute` | Uncommitted files, local experiments, branch-only edits |
| **Obsidian vault read** | `gcpCompute` | `muelUnified` | Search, RAG query, graph metadata, file read on the shared team vault |
| **Obsidian vault write** | `gcpCompute` | `muelUnified` | Note write, sync, daily append (prefer remote for CLI) |
| **Sprint pipeline** | `muelUnified` | — | action-execute-direct, action-catalog |
| **External tool ops** | `gcpCompute` | `muelUnified` | OpenClaw, NemoClaw, OpenJarvis, OpenShell |
| **n8n workflows** | `muelUnified` or `gcpCompute` | — | Trigger, status, delegate |
| **News/YouTube crawl** | `muelUnified` | crawler-worker | news.google.search, youtube.search |
| **DB queries** | `supabase` (upstream) | direct Supabase client | Schema queries, data reads |
| **LLM diagnostics** | `muelUnified` | — | diag.llm |

### Overlap Resolution Rules

- **GitHub PR/Issue/Branch**: Use `github` MCP for IDE agent work. Runtime server uses `autonomousGit.ts` (direct GitHub REST API). Do NOT mix — `github` MCP is IDE-only.
- **Code indexing**: `muelIndexing` tools also appear in `muelUnified`/`gcpCompute`. Use `gcpCompute` (or the canonical public `/mcp` ingress) for shared/team repo state. Use `muelIndexing` only for dirty workspace, uncommitted local files, or branch-only experiments.
- **Obsidian**: `gcpCompute` is the default for team-shared/operator-visible vault work and the canonical public ingress is `/mcp`. Use `muelUnified` only for explicit local-only vault overlay work.
- **GitKraken / GH PR Extension**: Remain as IDE UI helpers for visual PR review. For programmatic multi-step GitHub operations, prefer `github` MCP.

### Canonical Shared MCP Ingress

- Canonical full-catalog public base URL: `https://34.56.232.61.sslip.io/mcp`
- Compatibility alias retained for older Obsidian clients: `https://34.56.232.61.sslip.io/obsidian`
- Shared indexing clients should prefer `MCP_SHARED_MCP_URL` or `MCP_INDEXING_REMOTE_URL`

## Indexing Overlap Matrix

`muelIndexing`의 7개 도구는 shared unified surface에도 존재한다. 최적화 포인트는 중복 제거가 아니라 역할 고정이다.

| Tool | Shared/team default | Local overlay default | Usage rule |
| ---- | ------------------- | --------------------- | ---------- |
| `code.index.symbol_search` | `gcpCompute` | `muelIndexing` | shared branch 기준선은 원격, 미커밋 탐색만 로컬 |
| `code.index.symbol_define` | `gcpCompute` | `muelIndexing` | 정의 위치는 shared truth 우선 |
| `code.index.symbol_references` | `gcpCompute` | `muelIndexing` | 영향도 분석은 shared, local patch 확인만 overlay |
| `code.index.file_outline` | `gcpCompute` | `muelIndexing` | 구조 이해는 shared, 새 임시 파일은 local |
| `code.index.scope_read` | `gcpCompute` | `muelIndexing` | 범위 판독은 shared 기준으로 시작 |
| `code.index.context_bundle` | `gcpCompute` | `muelIndexing` | AI 컨텍스트 기본은 shared bundle, local diff는 보강용 |
| `security.candidates_list` | `gcpCompute` | `muelIndexing` | shared review는 원격, local-only branch 실험은 overlay |

운영 규칙:

1. shared/team 질문이면 `gcpCompute`만으로 답을 만들고, 필요할 때만 `muelIndexing`으로 local diff를 덧댄다.
2. `muelIndexing` 단독 결과를 shared truth처럼 취급하지 않는다.
3. 같은 질문에 두 서버가 모두 필요하면 순서는 항상 `gcpCompute` → `muelIndexing` 이다.

---

## GitHub MCP Server (github/github-mcp-server)

Entry: `.vscode/mcp.json` → `https://api.githubcopilot.com/mcp/` (remote HTTP, Copilot OAuth)  
Scope: IDE agent-mode only (not available in runtime server)

Default toolsets: `context`, `repos`, `issues`, `pull_requests`, `users`

### Key Tools (default toolsets)

| Tool | Purpose |
|------|---------|
| `create_or_update_file` | Create/update a file in any accessible repo |
| `push_files` | Multi-file commit in one push |
| `create_pull_request` | Create PR across any org repo |
| `merge_pull_request` | Merge PR (squash/rebase/merge) |
| `create_pull_request_review` | APPROVE / REQUEST_CHANGES / COMMENT |
| `get_pull_request_files` | List changed files in a PR |
| `get_pull_request_status` | CI/CD status checks |
| `create_issue` / `update_issue` | Issue CRUD |
| `add_issue_comment` | Comment on issues |
| `search_code` | Cross-repo code search |
| `search_issues` | Cross-repo issue/PR search |
| `create_branch` | Branch creation across repos |
| `list_commits` | Commit history |
| `get_file_contents` | Read file from any repo |

### Optional Toolsets (enable via `GITHUB_TOOLSETS` env var)

| Toolset | Purpose |
|---------|---------|
| `actions` | GitHub Actions workflow monitoring |
| `code_security` | Code scanning alerts |
| `dependabot` | Dependabot alerts and PRs |
| `discussions` | GitHub Discussions |
| `notifications` | Bell notifications |
| `orgs` | Organization management |
| `projects` | GitHub Projects boards |
| `secret_protection` | Secret scanning |

### Cross-Repo Use Cases for team-muel

| Use Case | Tools Used |
|----------|-----------|
| Search code across all team-muel repos | `search_code` with `org:team-muel` |
| Create issue in ai-gods-project from discord-news-bot context | `create_issue` with owner=team-muel, repo=ai-gods-project |
| PR from feat branch to main across repos | `create_pull_request` |
| Monitor CI status before ship phase | `get_pull_request_status` |
| Cross-repo code review | `get_pull_request_files` + `create_pull_request_review` |

---

## muelCore Tools — migrated to muelUnified

> The 6 tools below (`stock.quote`, `stock.chart`, `investment.analysis`, `action.catalog`, `action.execute.direct`, `diag.llm`) were previously exposed by the standalone `muelCore` stdio server.  
> They are now consolidated into `muelUnified` (`scripts/unified-mcp-stdio.ts`).  
> The `muelCore` entry has been removed from `.vscode/mcp.json`.

Entry: `src/mcp/toolAdapter.ts` (included via `src/mcp/unifiedToolAdapter.ts`)

### 1) `stock.quote`

- Purpose: 티커 심볼 시세 조회
- Input: `symbol: string` (required)
- Output: JSON text of quote fields

### 2) `stock.chart`

- Purpose: 티커 심볼 30일 차트 URL 생성
- Input: `symbol: string` (required)
- Output: chart URL string

### 3) `investment.analysis`

- Purpose: 텍스트 기반 투자 분석 생성
- Input: `query: string` (required)
- Output: analysis text

### 4) `action.catalog`

- Purpose: 현재 등록된 액션 카탈로그 조회
- Input: none
- Output: JSON array string of action names

### 5) `action.execute.direct`

- Purpose: 등록된 액션 직접 실행 (운영 점검/개발용)
- Input: `actionName: string` (required), `goal: string` (required), `args: object` (optional)
- Output: JSON text of action result
- **Restriction**: Disabled in production (`NODE_ENV=production`)

### 6) `diag.llm`

- Purpose: LLM provider 연결 진단 (generateText() 직접 호출로 연결 확인)
- Input: `prompt: string` (optional, default: `"say hi"`)
- Output: JSON with `{ configured, provider, latencyMs, text }` or error details

---

## muelIndexing Tools (7)

Entry: `scripts/indexing-mcp-stdio.ts` → `src/mcp/indexingServer.ts` → `src/mcp/indexingToolAdapter.ts`

Requires env: `INDEXING_MCP_REPO_ID`, `INDEXING_MCP_REPO_ROOT`

### 1) `code.index.symbol_search`

- Purpose: 저장소 인덱스에서 심볼 후보 검색
- Input: `repoId: string`, `query: string` (required), `branch`, `commitSha`, `kind`, `limit` (optional)

### 2) `code.index.symbol_define`

- Purpose: 특정 심볼 정의 및 선언 범위 반환
- Input: `repoId: string` (required), `symbolId`, `name`, `filePathHint` (optional)

### 3) `code.index.symbol_references`

- Purpose: 특정 심볼 참조 위치 반환
- Input: `repoId: string`, `symbolId: string` (required), `limit` (optional)

### 4) `code.index.file_outline`

- Purpose: 파일의 top-level 구조 반환
- Input: `repoId: string`, `filePath: string` (required)

### 5) `code.index.scope_read`

- Purpose: 특정 심볼 또는 라인 기준 범위 반환
- Input: `repoId: string`, `filePath: string` (required), `symbolId`, `line`, `contextLines` (optional)

### 6) `code.index.context_bundle`

- Purpose: 목표에 필요한 최소 코드/문서 묶음 반환 (AI 컨텍스트 최적화)
- Input: `repoId: string`, `goal: string` (required), `maxItems`, `changedPaths` (optional)

### 7) `security.candidates_list`

- Purpose: 특정 커밋 기준 보안 후보군 JSONL 레코드 조회
- Input: `repoId: string` (required), `branch`, `commitSha`, `candidateKind`, `view`, `limit` (optional)

---

## muelObsidian Tools (20+)

Entry: `src/mcp/obsidianToolAdapter.ts`  
Accessible via `muelUnified` server or `gcpCompute`

Key tools:
- `obsidian.search` — graph-first 검색
- `obsidian.read` — vault 파일 읽기
- `obsidian.write` — sanitization gate 통과 후 노트 작성
- `obsidian.rag_query` — hybrid retrieval (graph + pgvector)
- `obsidian.graph_metadata` — 링크 그래프 메타데이터
- `obsidian.outline` — 파일 outline 반환
- `obsidian.context_search` — 컨텍스트 기반 검색
- `obsidian.property_read` / `obsidian.property_set` — YAML frontmatter 조작
- `obsidian.files_list` — vault 파일 목록
- `obsidian.content_append` / `obsidian.daily_note_append` / `obsidian.daily_note_read`
- `obsidian.tasks_list` / `obsidian.task_toggle` — 할일 목록
- `obsidian.cache_stats` / `obsidian.sync_stats` / `obsidian.quality_audit` / `obsidian.vault_root`
- `obsidian.eval_code` — 고급: Obsidian CLI templater 코드 실행

---

## ext.* External Adapter Tools (via gcpCompute unified)

Entry: `src/mcp/unifiedToolAdapter.ts` → `src/services/tools/externalAdapterRegistry.ts`  
Naming convention: `ext.<adapterId>.<capability>`

| Adapter | ID | Capabilities |
|---------|-----|-------------|
| OpenShell | `openshell` | `shell.run`, `shell.script`, `shell.health` |
| NemoClaw | `nemoclaw` | `review.code`, `review.security`, `review.health` |
| OpenClaw | `openclaw` | `agent.chat`, `agent.skill.create`, `agent.session.relay`, `agent.health` |
| OpenJarvis | `openjarvis` | `ops.plan`, `ops.run`, `ops.check`, `ops.health` |
| n8n | `n8n` | `workflow.trigger`, `workflow.status`, `workflow.health` |
| DeepWiki | `deepwiki` | `wiki.query`, `wiki.health` |
| Obsidian | `obsidian` | `note.write`, `note.read`, `vault.search`, `vault.health` |
| Render | `render` | `deploy.trigger`, `deploy.status`, `service.health` |

Lite-mode adapters (available even when full capabilities are restricted):
- `openclaw`: `agent.chat`, `agent.health`
- `openjarvis`: `ops.run`, `ops.health`

---

## upstream.* Upstream Proxy Tools

Entry: `src/mcp/unifiedToolAdapter.ts` → `src/mcp/proxyAdapter.ts` → `src/mcp/proxyRegistry.ts`

Bootstrap: `MCP_UPSTREAM_SERVERS` JSON array (see `.env.example`)

### Naming Convention

| Upstream original tool | Internal name (dot-based) | MCP wire name (hyphen-based) |
|---|---|---|
| `query-database` | `upstream.supabase.query_database` | `upstream-supabase-query_database` |
| `wiki.query` | `upstream.deepwiki.wiki_query` | `upstream-deepwiki-wiki_query` |
| `list_files` | `upstream.custom.list_files` | `upstream-custom-list_files` |

Upstream tool name dots (`.`) and hyphens (`-`) are normalized to underscores (`_`) for the internal catalog so they round-trip through the existing dot↔hyphen wire transform without collision.

### Server Config Fields

```jsonc
{
  "id": "supabase",          // unique registry key
  "url": "https://mcp.supabase.com/mcp",  // base URL (no trailing slash)
  "namespace": "supabase",   // prefix used in tool names [a-z0-9_]
  "token": "sbp_xxx",        // optional Bearer auth token (masked in logs)
  "enabled": true            // default true; set false to temporarily disable
}
```

### Transport

1. Primary: JSON-RPC 2.0 `tools/list` / `tools/call` over `POST /mcp/rpc`
2. Fallback: REST `POST /tools/list` (for servers without `/mcp/rpc`)

### Failure Isolation

- Per-server independent timeout (8 s). A timed-out server contributes zero tools; other servers are unaffected.
- Tool catalog is cached per server for `MCP_UPSTREAM_TOOL_CACHE_TTL_MS` (default 5 min).
- `invalidateToolCache()` from `unifiedToolAdapter.ts` forces a full refresh.

---

## Worker Tools (Crawler Worker, legacy)

Handled by `scripts/crawler-worker.ts`:
- `youtube.search.first`
- `youtube.search.webhook`
- `youtube.monitor.latest`
- `news.google.search`
- `news.monitor.candidates`
- `community.search`
- `web.fetch`

---

## Safety Notes

- 정책형 실행(allowlist/approval)은 backend action runner path에서 강제합니다.
- `action.execute.direct`는 `NODE_ENV !== 'production'`일 때만 동작합니다.
- 모든 Obsidian 쓰기는 `sanitizeForObsidianWrite()` gate를 통과해야 합니다.
- `ext.*` 도구는 어댑터 `isAvailable()` 확인 후에만 실행됩니다.
- Path traversal 보호: `code.index.*` 도구의 `filePath` 인자에 `..` 및 절대 경로 차단.
- 향후 정식 MCP 릴리즈에서는 Content-Length framing, auth context, tenant scoping을 추가해야 합니다.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v5 | 2026-04-08 | Added `github` MCP server (remote HTTP, Copilot OAuth); added Routing Decision Table and Overlap Resolution Rules; documented cross-repo use cases for team-muel org |
| v4 | 2026-04-06 | Removed `muelCore` from `.vscode/mcp.json` (consolidated into `muelUnified`); moved `deepwiki`/`supabase` HTTP entries to `MCP_UPSTREAM_SERVERS` |
| v3 | 2026-04-06 | Added `upstream.*` proxy namespace; `proxyRegistry.ts` + `proxyAdapter.ts`; `MCP_UPSTREAM_SERVERS` env var |
| v2 | 2026-04-05 | Full multi-server inventory; added `diag.llm`, Obsidian tools, ext.* adapter table |
| v1 | 2026-03-18 | Initial spec (muelCore 5 tools only) |

