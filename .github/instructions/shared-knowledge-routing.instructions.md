---
description: "Shared knowledge routing — for plans, requirements, retros, intent, operator docs, or decision history, the agent must try gcpCompute/shared MCP Obsidian surfaces before local grep/read_file archaeology."
applyTo: "**"
---

# Shared Knowledge Routing

> Shared knowledge questions should start from the shared MCP/Obsidian surface, not from local markdown archaeology.

## Shared Server Assumption

- `gcpCompute` / shared MCP is a common team server and may act as part of the company internal knowledge and intranet surface, not merely a repo-local helper.
- When a question may depend on shared operator docs, internal notes, internal runbooks, or company context, first try the shared MCP surface before assuming the answer lives only inside this repository.

## Hard Rule

- For plans, requirements, retros, operator docs, roadmap intent, decision history, runtime context, internal runbooks, and company-internal knowledge questions, first attempt `gcpCompute` or the shared MCP Obsidian surface.
- Use local `grep_search`, `read_file`, and `file_search` only when the shared surface lacks the artifact, MCP is unavailable, or exact local text must be patched or verified.

## Sparse Vault Rule

- Sparse or incomplete Obsidian content is not a reason to fall back to grep-first behavior.
- If the shared surface is incomplete, compile the answer from other MCP-exposed internal surfaces, runtime surfaces, repo docs, and local code as a secondary layer.
- Treat repeated missing shared knowledge as a promotion opportunity: the agent should prefer creating or proposing a reusable knowledge artifact or MCP tool contract rather than repeatedly rediscovering the same facts.

## Tool-First Rule

- Prefer high-level MCP tools and structured runtime surfaces over raw file search when both can answer the task.
- If only low-level primitives exist and the same multi-step archaeology pattern repeats, propose or document a higher-level MCP contract instead of normalizing the manual workflow.
- Avoid shifting burden to the user to hand-tune the agent when a reusable tool or shared knowledge artifact can encode the behavior.
