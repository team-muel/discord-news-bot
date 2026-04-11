---
description: "MCP-first routing rules — aggressively prefer MCP and MCP-mediated Obsidian shared surfaces over grep/read_file archaeology when equivalent tools exist."
applyTo: "**"
---

# MCP Tool Routing

> One task → one server → one tool path. No fragmentation.

## Default Stance

- Default to MCP-first when a task can be satisfied by an MCP server already available in the workspace.
- Treat `gcpCompute` / shared MCP as a team-shared and company-internal surface when the task may depend on internal knowledge, internal runbooks, operator notes, or intranet-adjacent context.
- Default to MCP-mediated Obsidian-first for shared knowledge: operator docs, plans, requirements, retros, and shared memory should start from `gcpCompute`/shared MCP Obsidian tools.
- Use local file archaeology (`grep_search`, `read_file`, `file_search`) only after checking the routing table, or when exact local text, local-only files, or dirty workspace overlays matter.
- For understanding intent, history, or operational state, do not start with grep across markdown files if the shared Obsidian/MCP surface can answer first.

## IDE Agent Routing

When working in VS Code agent mode, use this decision tree:

### GitHub Operations (PR, Issue, Branch, cross-repo)

- **Use**: `github` MCP server (remote HTTP)
- **NOT**: GitKraken CLI tools (use only for visual UI)
- **NOT**: github-pull-request extension tools (use only for active PR context)
- **Examples**: `create_pull_request`, `search_code`, `create_issue`, `push_files`
- **Cross-repo**: Always specify `owner` + `repo` to target any team-muel repo

### Code Analysis (symbols, references, structure)

- **Use**: `gcpCompute` shared MCP surface for team/shared repository state
- **Use**: `muelIndexing` only for dirty workspace or uncommitted local files
- **Sequence**: if both shared state and local diff matter, query `gcpCompute` first, then compare with `muelIndexing`
- **Default behavior**: start from MCP code-index/context tools before local grep or repeated file reads
- **NOT**: `muelUnified` code-index tools when the shared surface is reachable
- **NOT**: local-only `muelIndexing` as the default for shared/team context
- **Examples**: `code-index-symbol_search`, `code-index-context_bundle`

### Obsidian Vault (read/write/search)

- **Shared/team vault (default)**: `gcpCompute` → `obsidian-*` tools
- **Local-only vault overlay**: `muelUnified` → `obsidian-*` tools only when intentionally targeting a machine-specific local vault
- **Read/write preference**: `gcpCompute` for operator docs, plans, requirements, retros, and any shared memory surface
- **Meaning of Obsidian-first**: prefer MCP-backed shared Obsidian retrieval, not raw local vault/file reads
- **NOT**: start with local markdown grep when the shared Obsidian/MCP surface is the authoritative source
- **Fallback**: local markdown reads only for exact workspace text verification, local-only overlays, or MCP outages
- **Examples**: `obsidian-search`, `obsidian-rag`, `obsidian-write`

### Sprint Pipeline (plan/implement/review/qa/ship)

- **Use**: `muelUnified` → `action-execute-direct`
- **Action catalog**: `muelUnified` → `action-catalog`

### External Tools (OpenClaw, NemoClaw, OpenJarvis, n8n)

- **Use**: `muelUnified` or `gcpCompute` → `ext-*` prefixed tools
- **n8n workflows**: `ext-n8n-workflow-*`

### Database Queries

- **Use**: Supabase upstream proxy via `muelUnified`
- **Direct**: `db.supabase.read` action

## Runtime Server Routing

For runtime (bot server) code, the MCP routing is:

| Domain                    | Code Path                                       | Env Var                |
| ------------------------- | ----------------------------------------------- | ---------------------- |
| GitHub (PR/branch/commit) | `src/services/sprint/autonomousGit.ts`          | `SPRINT_GITHUB_TOKEN`  |
| Action execution          | `src/services/skills/actions/registry.ts`       | —                      |
| MCP worker delegation     | `src/services/mcpSkillRouter.ts`                | `MCP_*_WORKER_URL`     |
| Upstream MCP proxy        | `src/mcp/proxyAdapter.ts`                       | `MCP_UPSTREAM_SERVERS` |
| External adapters         | `src/services/tools/externalAdapterRegistry.ts` | `*_ENABLED`, `*_URL`   |

## Anti-Patterns

1. **Don't call GitHub REST directly** when `github` MCP is available in IDE context
2. **Don't default to local-only `muelIndexing`** when the task is about shared/team repository state
3. **Don't start with grep/read_file archaeology** when `gcpCompute` or `muelUnified` can answer the task directly
4. **Don't search for tools** across multiple servers — check the routing table first
5. **Don't create new action files** for operations already covered by MCP tools
