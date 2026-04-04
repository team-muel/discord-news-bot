---
description: "Autonomous sprint execution policy — governs when agent pipelines need human approval vs. auto-execution."
applyTo: "src/services/sprint/**"
---

# Autonomous Execution Policy

The production runtime can autonomously:

- Detect runtime errors and trigger bugfix sprints
- Classify CS tickets and trigger feature/fix sprints
- Run scheduled security audits and code improvement sprints
- Create branches, commit changes, and open PRs via GitHub API

## Autonomy Levels

Governed by guild-level policy (`SPRINT_AUTONOMY_LEVEL`):

| Level | plan | implement | review | qa | ship |
|---|---|---|---|---|---|
| `full-auto` | auto | auto | auto | auto | auto |
| `approve-ship` | auto | auto | auto | auto | **approval** |
| `approve-impl` | auto | **approval** | auto | auto | **approval** |
| `manual` | **approval** | **approval** | **approval** | **approval** | **approval** |

Default: `approve-ship` — safest balance of automation and human oversight.

## Trigger Types

- `manual`: user invokes via Discord command or API
- `error-detection`: runtime error pattern threshold exceeded
- `cs-ticket`: CS channel message classified as bug-report or feature-request
- `scheduled`: cron-based security audit or self-improvement
- `self-improvement`: retro pattern analysis triggers targeted fix sprint
