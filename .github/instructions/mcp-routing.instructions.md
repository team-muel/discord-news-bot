---
description: "MCP tool routing rules — which server and tool to use for each task type. Prevents fragmented tool calls."
applyTo: "src/**"
---

# MCP Tool Routing

> One task → one server → one tool path. No fragmentation.

## IDE Agent Routing

When working in VS Code agent mode, use this decision tree:

### GitHub Operations (PR, Issue, Branch, cross-repo)
- **Use**: `github` MCP server (remote HTTP)
- **NOT**: GitKraken CLI tools (use only for visual UI)
- **NOT**: github-pull-request extension tools (use only for active PR context)
- **Examples**: `create_pull_request`, `search_code`, `create_issue`, `push_files`
- **Cross-repo**: Always specify `owner` + `repo` to target any team-muel repo

### Code Analysis (symbols, references, structure)
- **Use**: `muelIndexing` MCP server
- **NOT**: `muelUnified` code-index tools (duplicates)
- **NOT**: `gcpCompute` code-index tools (remote copy)
- **Examples**: `code-index-symbol_search`, `code-index-context_bundle`

### Obsidian Vault (read/write/search)
- **Local vault**: `muelUnified` → `obsidian-*` tools
- **GCP vault**: `gcpCompute` → `obsidian-*` tools
- **Write preference**: `gcpCompute` (has native-cli adapter)
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

| Domain | Code Path | Env Var |
|--------|-----------|---------|
| GitHub (PR/branch/commit) | `src/services/sprint/autonomousGit.ts` | `SPRINT_GITHUB_TOKEN` |
| Action execution | `src/services/skills/actions/registry.ts` | — |
| MCP worker delegation | `src/services/mcpSkillRouter.ts` | `MCP_*_WORKER_URL` |
| Upstream MCP proxy | `src/mcp/proxyAdapter.ts` | `MCP_UPSTREAM_SERVERS` |
| External adapters | `src/services/tools/externalAdapterRegistry.ts` | `*_ENABLED`, `*_URL` |

## Anti-Patterns

1. **Don't call GitHub REST directly** when `github` MCP is available in IDE context
2. **Don't use `gcpCompute` code-index** when `muelIndexing` has the same data locally
3. **Don't search for tools** across multiple servers — check the routing table first
4. **Don't create new action files** for operations already covered by MCP tools
