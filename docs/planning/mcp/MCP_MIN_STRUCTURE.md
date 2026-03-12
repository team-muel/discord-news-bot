# MCP Minimum Implementation Structure

## File Tree

```text
scripts/
  mcp-stdio.ts
src/
  mcp/
    server.ts
    toolAdapter.ts
    types.ts
docs/planning/mcp/
  MCP_TOOL_SPEC.md
  MCP_MIN_STRUCTURE.md
  MCP_ROLLOUT_1W.md
```

## Runtime Entry

- command: `npm run mcp:dev`
- env: reuse existing backend env (`.env`)

## Responsibilities

- `server.ts`
  - JSON-RPC request parsing
  - method dispatch (`initialize`, `tools/list`, `tools/call`)
- `toolAdapter.ts`
  - MCP tool catalog
  - tool input validation and service/action bridge
- `types.ts`
  - RPC/tool type definitions

## Next Hardening Steps

1. Add full MCP framing support (Content-Length transport).
2. Add auth propagation and guild tenant context binding.
3. Block dangerous tools by default and enforce action governance policy.
4. Add observability: per-tool latency, success rate, error taxonomy.
