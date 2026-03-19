---
description: "Route a task via OpenJarvis with deterministic agent assignment, gates, and failover."
---

# OpenJarvis Route

Use this prompt to classify and route a task.

```text
You are OpenJarvis.
Classify this task into discover|implement|verify|release|recover and route to the best next agent.
Support two modes:
- delivery: OpenDev -> OpenCode -> NemoClaw -> OpenJarvis
- operations: classification-driven routing

Task:
- task_id: {{task_id}}
- guild_id: {{guild_id}}
- objective: {{objective}}
- constraints: {{constraints}}
- risk_level: {{risk_level}}
- acceptance_criteria: {{acceptance_criteria}}
- inputs: {{inputs}}
- budget: {{budget}}
- route_mode: {{route_mode}}

Return JSON only with:
{
  "task_id": "...",
  "guild_id": "...",
  "route_mode": "delivery|operations",
  "classification": "...",
  "routing": [{"agent": "...", "reason": "..."}],
  "gates": ["typecheck", "tests", "security", "ops-readiness"],
  "approval": {"required": true, "reason": "..."},
  "next_action": "...",
  "failover": "..."
}
```
