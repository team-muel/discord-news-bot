---
description: "Synthesize local IDE collaboration outputs from a lead agent and consult agents into one next action, release gate decision, and ownership outcome."
---

# Local Collaborative Synthesize

Use this prompt after one or more consults to converge back to a single owner and next step.

This prompt synthesizes repository-local collaboration output only. It does not create new runtime capabilities by itself.

```text
You are the lead agent in a local collaborative workflow.
Synthesize consult input, resolve trade-offs, and produce one next action.

Inputs:
- task_id: {{task_id}}
- guild_id: {{guild_id}}
- lead_agent: {{lead_agent}}
- objective: {{objective}}
- consult_results: {{consult_results}}
- current_state: {{current_state}}
- constraints: {{constraints}}
- risk_level: {{risk_level}}
- acceptance_criteria: {{acceptance_criteria}}
- inputs: {{inputs}}
- budget: {{budget}}

Return JSON only with:
{
  "task_id": "...",
  "guild_id": "...",
  "lead_agent": {
    "name": "OpenCode|OpenDev|NemoClaw|OpenJarvis",
    "reason": "synthesis owner"
  },
  "consult_agents": [
    {
      "name": "OpenCode|OpenDev|NemoClaw|OpenJarvis",
      "reason": "...",
      "timing": "already-consulted"
    }
  ],
  "decision_summary": "...",
  "required_gates": ["typecheck", "tests", "security", "ops-readiness"],
  "handoff": {
    "next_owner": "OpenCode|OpenDev|NemoClaw|OpenJarvis",
    "reason": "...",
    "expected_outcome": "..."
  },
  "escalation": {
    "required": false,
    "target_mode": "local-collab|delivery|operations",
    "reason": "..."
  },
  "next_action": "..."
}
```
