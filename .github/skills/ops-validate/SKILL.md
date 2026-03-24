---
description: "Sprint Phase: Ops Gate — validate operational readiness, rollback safety, deployment reliability, and unattended automation before release."
applyTo: "**"
---

# /ops-validate

> Nothing ships without a rollback plan.

## When to Use

- Pre-release operational readiness check
- Working with scripts, CI, or workflow automation
- Updating runbooks, release gates, or on-call procedures
- Designing safe unattended execution strategies
- Post-incident recovery validation

## Lead Agent

`operate` (operate role)

## Process

1. **Classify** — determine if this is `discover|implement|verify|release|recover`.
2. **Blast radius** — identify affected scripts, workflows, environments, and users.
3. **Rollback plan** — define explicit rollback steps and abort conditions.
4. **Idempotency check** — verify scripts and workflows produce consistent results across repeated runs.
5. **Guardrails** — confirm failure thresholds, secrets isolation, and alert coverage.
6. **Dry-run** — execute dry-run path for changed automation when feasible.

## Inputs

| Field         | Required | Description                       |
| ------------- | -------- | --------------------------------- |
| change_plan   | yes      | What is being deployed or changed |
| rollback_path | no       | Pre-identified rollback steps     |
| environment   | no       | staging / production / both       |

## Output Contract

```
- Classification: discover|implement|verify|release|recover
- Blast radius assessment
- Guardrails and rollback path (executable steps)
- Validation results for staging and production
- Operational metrics to watch after rollout
- Recommended next skill: /ship or /implement
```

## Guardrails

- Never assume unattended jobs are safe without failure thresholds.
- Require explicit rollback rehearsal for risky automation changes.
- Verify deterministic behavior across repeated runs.
- Keep secrets out of logs and generated artifacts.

## Next Skills

| Condition             | Next                                 |
| --------------------- | ------------------------------------ |
| Ops validation passes | `/ship`                              |
| Ops issues found      | `/implement` (with fix requirements) |
| Incident/recovery     | stays in `/ops-validate` loop        |

## Runtime Counterpart

- Action: `operate.ops` (legacy: `openjarvis.ops`)
- Discord intent: `ops|deploy|release|rollback|운영|배포|롤백`
- Worker env: `MCP_OPERATE_WORKER_URL` (legacy: `MCP_OPENJARVIS_WORKER_URL`)
