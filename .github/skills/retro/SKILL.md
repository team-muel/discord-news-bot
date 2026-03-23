---
description: "Sprint Phase: Retro — summarize what shipped, what broke, lessons learned. Store insights in Obsidian vault for graph-first retrieval."
applyTo: "**"
---

# /retro

> Learn from what just happened.

## When to Use

- After `/ship` completes a sprint
- Weekly scheduled retrospective
- Post-incident review
- Periodic self-improvement analysis across sprints

## Lead Agent

`opendev` (architect role — strategic reflection)

## Process

1. **Gather** — sprint trace, test results, review findings, deploy outcomes, error logs.
2. **Summarize** — what shipped, what broke, what was learned.
3. **Metrics** — LOC changed, test count delta, phases executed, implement↔review loop count.
4. **Pattern detection** — identify recurring issues across recent sprints.
5. **Store** — write retro to Obsidian vault under `retros/` with backlink tags.
6. **Recommendations** — process improvements and potential self-improvement sprints.

## Inputs

| Field         | Required | Description                          |
| ------------- | -------- | ------------------------------------ |
| sprint_id     | yes      | Sprint pipeline identifier           |
| phase_results | yes      | Summary of all completed phases      |
| incident_ref  | no       | Related incident ID for post-mortems |

## Output Contract

```
- Sprint summary with metrics
- Lessons learned (keep / stop / start)
- Recurring pattern analysis
- Obsidian vault path for stored retro
- Process improvement recommendations
- Potential self-triggered sprint objectives
```

## Obsidian Integration

- Graph-first: link retro to plan docs, incident docs, related retros
- Tags: `#retro`, `#sprint-{id}`, `#lessons-learned`
- Backlinks: reference original `/plan` output and `/review` findings
- Cache: respect `OBSIDIAN_RAG_CACHE_TTL_MS` for retrieval

## Next Skills

| Condition                       | Next                 |
| ------------------------------- | -------------------- |
| Sprint complete                 | (pipeline ends)      |
| Recurring pattern found         | `/plan` (new sprint) |
| Self-improvement recommendation | triggers new sprint  |

## Runtime Counterpart

- Action: `retro.summarize`
- Discord intent: `retro|회고|정리|요약|retrospective`
- Worker env: `MCP_RETRO_WORKER_URL`
