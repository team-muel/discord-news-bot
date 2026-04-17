# Multica Control Plane Playbook

Status: Canonical repo source (2026-04-18)

## Purpose

Define how Multica should be used in this repository as the visible control plane for local coding agents.

This document exists to answer four questions clearly:

1. What Multica owns in the operating model.
2. What Multica must not own.
3. Which local agent should be assigned to which kind of work.
4. What the first repeatable issue topology should look like.

This playbook is for the local-agent-machine only.
It must not be used as the first proof surface for service-machine truth or team-shared onboarding.

## Control-Plane Boundary

Multica is the coordination layer.

It should own:

- visible issue routing
- agent assignment
- work decomposition into bounded lanes
- operator-facing progress and backlog state
- human approval checkpoints for risky work

It must not own:

- semantic source of truth for decisions or retros
- canonical runtime truth
- hot execution state already owned by the repo runtime or Supabase
- durable architecture meaning that belongs in shared Obsidian

Operational ownership split:

| Surface | Primary role |
| --- | --- |
| Multica | work coordination, assignment, visible progress |
| Repository code and runtime docs | runtime truth, contracts, execution behavior |
| Supabase and sprint runtime state | hot state, phase state, workflow events |
| n8n and explicit workflow routers | deterministic orchestration, waits, retries, branch logic |
| GitHub | artifact publication, code review, CI evidence, merge or settlement history |
| Shared Obsidian | durable semantic ownership, decisions, operator memory |

Use [docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md](docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md) when a role label could be confused with a separately installed external runtime.

Broader plane alignment:

- This playbook is the local coordination slice of the broader multi-plane operating model.
- Keep coordination in Multica, workflow state in Supabase plus n8n, durable meaning in shared Obsidian, and shipped artifacts in GitHub.
- Use [docs/adr/ADR-008-multi-plane-operating-model.md](docs/adr/ADR-008-multi-plane-operating-model.md) when the broader plane split matters beyond local issue choreography.

## Local, Service, Shared Usage Map

| Plane ID | Multica relation | Canonical proof surface | Use this plane for | Do not infer from it |
| --- | --- | --- | --- | --- |
| `local-agent-machine` | Multica is the visible control plane | this playbook, `npm run local:control-plane:doctor`, local runtime health | bounded local execution, local validation, workstation routing, child-lane ownership | deployed runtime health, shared publication, or team-wide prerequisites |
| `service-machine` | evidence target only | `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `config/runtime/operating-baseline.json`, operator-visible runtime endpoints | proving callability, worker ownership, deployed route truth | success or failure of a local Multica lane |
| `team-shared-plane` | promotion destination only | `docs/TEAM_SHARED_OBSIDIAN_START_HERE.md`, shared Obsidian through shared MCP | onboarding, durable meaning, local-stack-free recovery, shared operator memory | private issue notes, personal manifests, or workstation-only glue |

## Operator Verification Branch

1. If the operator question is "what is deployed and callable", leave Multica and verify the service machine first.
2. If the operator question is "how does a teammate recover this without a local stack", use the team-shared plane first.
3. If the operator question is "which local agent should run this bounded lane", use this playbook and stay on the local-agent-machine.
4. Never use Multica issue state, local shell success, or local wrapper health as proof that the service machine or the team-shared plane is healthy.

## Agent Role Cards

These role cards map the currently installed Multica workspace agents to the strongest use cases in this repository.

| Multica agent | Best at | Should own | Should not own |
| --- | --- | --- | --- |
| `Hermes Local` | local execution and bounded implementation | code edits, shell work, test runs, local incident triage, repo mutation | final acceptance, major ambiguity resolution, semantic ownership |
| `Claude Local` | planning and defensive review | plan shaping, review, architecture framing, completeness checks, risk summaries | long-running local shell loops, repeated IDE mutation, hidden sidecar execution |
| `OpenClaw Local` | parallel exploration and alternate paths | reproduction attempts, alternate solution search, comparison runs, exploratory diagnosis | final plan ownership, canonical review sign-off, durable operator truth |

Default operating stance:

- `Claude Local` is the primary planning and review lane.
- `Hermes Local` is the primary implementation and local-ops lane.
- `OpenClaw Local` is the parallel exploration lane used when a second path is worth the cost.

## Local Runtime Baseline

Multica is the visible control plane for the local operator stack.

That means local model backends stay behind the agent runtimes instead of becoming a second coordination surface.

- retire the LM Studio-style `http://127.0.0.1:1234/v1` path from the canonical Multica workflow
- keep `Hermes Local` pointed at a live local Ollama OpenAI-compatible endpoint such as `http://127.0.0.1:11434/v1`
- verify the selected local model is actually loaded before trusting unattended lane execution
- if lane health regresses, repair the runtime behind Multica instead of bypassing Multica with a temporary sidecar path

Current local baseline for this repository:

- `Hermes Local` -> local Ollama endpoint + verified model
- `Hermes Local` ACP lane -> keep the local disabled-tool surface narrow for bounded validation work on this workstation (`todo`, `session_search`, irrelevant vision/image tools, and edit tools such as `patch`/`write_file`) so the lane does not drift into local planning, empty image-analysis calls, or unsolicited repo mutations; when the Multica daemon prompt only carries an issue ID, prefetch the issue title and description into the ACP prompt before the model turn so bounded validation issues do not burn their first turn on `multica issue get ...` and blank after the tool roundtrip
- `Claude Local` -> planning/review surface
- `OpenClaw Local` -> alternate-path lane only after direct health checks pass and fresh-session isolation is verified for the current workstation runtime
- `OpenClaw Local` JSON lane -> normalize daemon-provided local checks onto a repo-specific isolated agent workspace instead of trusting raw `--session-id` reuse against the default main workspace on this workstation; removing the daemon `--session-id` alone is not sufficient when local embedded `--agent discord-news-bot` still collapses onto the stale `agent:discord-news-bot:main` session key
- `OpenClaw Local` repo lane -> keep a Windows `multica` shim available on PATH for local embedded runs, or the agent can reach the repository workspace but still fail on the first `multica issue get ...` command
- `OpenClaw Local` bounded validation gate -> do not route fixed-format validation issues to this lane until a truly fresh per-task session key exists on this workstation; otherwise the lane can return stale generic readiness chat or stall without emitting messages

## Issue Execution Contract

For Multica child issues in this repository, the issue body or triggering comment is the task.

- use `multica issue get ...` only to read the task envelope, not to produce a summary as the final answer
- if the daemon prompt only includes an issue ID, enrich the local runtime prompt with the issue title and description before model execution instead of expecting the first LLM turn to fetch and parse issue JSON
- do not bounce the task back to the operator with generic prompts such as asking how to proceed
- if the issue requests a fixed reply shape, return that shape directly in the issue response
- validation-only lanes should report runtime evidence and the blocker directly, even when no repo files change
- if session reuse or session lookup fails, surface that as the concrete remaining risk instead of switching into generic assistant chat
- if `OpenClaw Local` cannot prove fresh-session isolation on the current workstation runtime, treat that lane as unavailable for bounded validation work instead of accepting generic readiness replies as useful output
- do not convert the issue into a local todo or planning artifact unless the issue explicitly asks for planning output
- do not loop on session-inspection tools for bounded validation checks; report the first reproducible session or gateway blocker directly
- if a local lane only stays on-task after wrapper-level tool filtering or session normalization, preserve that control in the local runtime wrapper instead of trying to solve it with prompt wording alone
- label evidence by plane when a child issue closes: local-agent-machine, service-machine, or team-shared-plane

## Default Issue Topology

For one meaningful objective, create one parent issue plus up to three child issues.

Parent issue:

- one objective
- one acceptance boundary
- one operator-visible summary of risk, evidence, and next action

Child lane pattern:

1. `Plan and Review` lane -> assign to `Claude Local`
2. `Implement and Observe` lane -> assign to `Hermes Local`
3. `Explore Alternate Path` lane -> assign to `OpenClaw Local` only when comparison value is real

This keeps one visible objective while preventing the chat surface from collapsing plan, implementation, and review into one undifferentiated session.

## Recommended First-Use Lanes

### 1. Bugfix Lane

Use when a bounded defect should move quickly with visible review gates.

- `Claude Local`: restate bug, scope blast radius, define acceptance checks
- `Hermes Local`: patch, run targeted tests, gather evidence
- `Claude Local`: review findings and release safety readout

### 2. Incident Lane

Use when something is broken or drifting in production or operations.

- `Hermes Local`: collect logs, runtime status, local diagnostics
- `Claude Local`: produce cause tree, mitigation options, rollback framing
- `OpenClaw Local`: investigate alternate failure hypotheses when diagnosis stalls

### 3. Documentation Drift Lane

Use when code, runtime behavior, and docs are out of sync.

- `Claude Local`: identify which docs are stale and what changed semantically
- `Hermes Local`: update repo-visible canonical documents
- shared Obsidian: receive promoted decision or playbook artifact if the change is durable

## Issue Template

Use this structure for the parent Multica issue description.

```md
## Objective
<one bounded objective>

## Why now
<why this matters>

## Acceptance
- <observable success condition>
- <observable success condition>

## Lane split
- Claude Local: plan and review
- Hermes Local: implement and observe
- OpenClaw Local: optional alternate path

## Evidence required
- plane=local-agent-machine: changed files, local test result, or workstation-only runtime evidence
- plane=service-machine: operator endpoint check, deploy/runtime health, or callable worker evidence
- plane=team-shared-plane: shared Obsidian or shared MCP publication, canonical doc update, or shared recovery note

## Promotion rule
- if the result changes runtime meaning, update repo docs and promote durable meaning to shared Obsidian
```

## Operator Rules

- Keep one parent issue equal to one bounded objective.
- Prefer child issues over one giant description when multiple agents are involved.
- Do not treat Multica issue state as semantic truth; it is coordination state.
- Do not treat local-plane evidence as service-machine proof.
- Do not treat service-machine proof as shared-plane publication; shared onboarding still requires the backfilled shared surface.
- Keep final meaning in repo docs plus shared Obsidian.
- When only one agent is needed, do not force three-lane choreography.
- When a lane becomes ambiguous or policy-sensitive, route back to a human-facing reasoning surface before continuing.

## First Practical Rollout

For the next real repository task, use this exact flow:

1. Create one parent issue in Multica with the objective and acceptance criteria.
2. Create a `Plan and Review` child assigned to `Claude Local`.
3. Create an `Implement and Observe` child assigned to `Hermes Local`.
4. Add an `Explore Alternate Path` child assigned to `OpenClaw Local` only if a second path is worth paying for.
5. Attach the canonical repo doc or changed-file evidence to the relevant issue.
6. Promote any durable lesson into shared Obsidian instead of leaving it only in issue text.

## Four-Surface Leverage Recovery

When this repository is under-leveraging Multica, Hermes, VS Code IDE Copilot, or OpenJarvis, the recovery sequence is:

1. Multica owns the parent objective and child-lane visibility. Keep one bounded objective per parent issue.
2. Hermes owns the local doctor, repair, and queue-aware execution lane. Start from `npm run local:control-plane:doctor`, then `npm run local:control-plane:up` if the lane is degraded.
3. OpenJarvis owns queue selection, runtime hot-state, and the next bounded objective. Use `npm run local:control-plane:future` to decide whether to stabilize, auto-queue, or launch.
4. VS Code IDE Copilot owns only the bounded GPT handoff. Launch it through `npm run openjarvis:autopilot:queue:chat` when the future plan says `launch-next-bounded-turn`, or `npm run openjarvis:autopilot:queue:swarm` when it says `launch-next-bounded-wave`, and close it with `npm run openjarvis:hermes:runtime:reentry-ack ...` immediately after the handoff settles.
5. If inspection is needed before mutation, use the matching `:dry` entrypoint rather than assuming the live command is safe-by-default.

`npm run local:control-plane:future` now emits a structured session synthesis in addition to the human-readable cadence plan.
Use that synthesis to mirror the next Multica child-lane shape instead of inventing fresh choreography per issue:

- `sessionKind=bounded-turn` -> one parent objective plus one bounded GPT handoff child
- `sessionKind=bounded-wave` -> one parent objective plus scout, executor, and optional distiller child lanes
- `executionLane.primaryAssetId=local-workstation-executor` -> keep the GUI or browser work explicit instead of pretending the repo-only lane can cover it
- `executionLane.primaryAssetId=remote-heavy-execution` -> keep the heavy remote slice explicit instead of hiding it behind a local Copilot chat

This sequence exists to prevent the four recurring failure modes that make the stack look underused even when the code paths exist:

- Multica becomes notes-only coordination instead of a bounded objective board.
- Hermes stays at diagnostics and never reaches the local execution lane.
- VS Code Copilot is treated as a generic manual chat instead of a bounded reentry surface.
- OpenJarvis keeps status and packets alive but never promotes the next objective into an actual live turn.

## Done Definition

This operating model is established when all of the following are true:

1. The next repo task can be opened as a bounded Multica parent issue.
2. `Claude Local`, `Hermes Local`, and `OpenClaw Local` have explicit role cards in the workspace.
3. The operator can tell whether a question belongs to the local-agent-machine, service-machine, or team-shared-plane before opening a child lane.
4. The canonical repo doc is registered for shared knowledge backfill.
5. Durable lessons from Multica execution are promoted out of issue text into shared Obsidian when they matter beyond the current task.
