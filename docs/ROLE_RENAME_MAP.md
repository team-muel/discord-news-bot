# Internal Role Rename And External Runtime Boundary

## Canonical Source Of Truth

This document is the naming migration and compatibility policy.
For the combined name-collision and implemented-runtime matrix, use `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md` first.

## Why This Exists

This repository historically used internal labels such as `openjarvis`, `nemoclaw`, `opendev`, `opencode`, and `local-orchestrator`.
Those labels are repository-local collaboration and runtime labels only.
They are not proof that similarly named external frameworks are installed, embedded, or automatically integrated.

To remove repeated confusion, the repository is standardizing on neutral internal names based on function.

## Legacy To New Mapping

| Legacy internal name | New internal name | Meaning |
| --- | --- | --- |
| `opencode` | `implement` | implementation, edits, tests, execution |
| `opendev` | `architect` | architecture, sequencing, ADR planning |
| `nemoclaw` | `review` | review, regression, security, risk |
| `openjarvis` | `operate` | operations, workflows, unattended automation |
| `local-orchestrator` | `coordinate` | routing and multi-role coordination |

## External Runtime Names Are Separate

The following names refer to external tools, runtimes, or model families, and must not be interpreted as internal role activation:

- OpenJarvis
- NVIDIA OpenShell
- NVIDIA NemoClaw
- NVIDIA Nemotron
- Ollama

## Naming Rule Going Forward

Internal labels must:

- avoid overlap with major external OSS, products, and model families
- describe function rather than brand
- remain consistent across docs, actions, workers, workflows, and environment variables

## Compatibility Policy

Phase A:

- docs and prompts prefer new names
- runtime accepts both legacy and new labels

Phase B:

- scripts/workflows/env prefer new names
- legacy labels remain as deprecated aliases

Phase C:

- remove legacy aliases only after docs, scripts, workflows, and env transitions are complete

## Runtime Scope Reminder

Role labels are not proof of external runtime integration.
Concrete runtime integration should be verified via configured providers, workers, actions, and status endpoints.

Primary runtime/source-of-truth document:

- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`
