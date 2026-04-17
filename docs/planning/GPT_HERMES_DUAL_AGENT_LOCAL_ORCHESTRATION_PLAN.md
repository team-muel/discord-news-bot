# GPT Hermes Dual-Agent Local Orchestration Plan

## Objective

Define the target operating model where GPT and Hermes are both real assistants rather than a primary session plus a hidden sidecar.

GPT remains the strongest reasoning surface for ambiguity, tradeoffs, and acceptance decisions.
Hermes becomes the persistent local operator agent that continues work between GPT sessions, uses the local IDE and toolchain directly, learns from repeated execution, and can escalate back to GPT when the boundary is crossed.

## First Required Premises

1. GPT-5.4 xhigh is a bounded commercial reasoning surface. When one Autopilot session ends, GPT does not stay alive to continue autonomous work on its own.
2. Hermes runs on the local machine and can persist across those session boundaries. That persistence is the concrete mechanism that overcomes GPT's post-session limit.
3. Because Hermes closes that gap, Hermes must be designed as a true second assistant for the user, not a hidden continuation shim.
4. Local self-hosted n8n is a valid orchestration layer for this design because it can manage waits, retries, schedules, and webhook glue without taking semantic ownership away from Obsidian or workstream ownership away from the shared hot-state plane.

The practical success condition is not only continuity.
It is a local-plus-remote control loop where:

1. Hermes owns machine-local execution, observation, and bounded autonomy
2. the always-on GCP lane carries most heavy or always-on bounded execution work
3. GPT can re-enter any workstream from shared structured state instead of reconstructing context from raw chat or markdown archaeology

For remote-capable work, remote leverage can still be measured separately, but it is not the active goal metric for the local-first Hermes bootstrap unless the operator explicitly asks for remote recovery.
For machine-local work, Hermes is the canonical local actor instead of a compatibility sidecar.

## Why This Plan Exists

The current single-ingress packet model solved one real problem: safe continuity after a GPT session ends.

It does not fully satisfy the stronger goal now on the table:

- Hermes should become a true second assistant, not only a hidden continuation shim
- the local IDE and dev environment should be relieved by a persistent local agent, not only by better packet discipline
- self-hosted n8n on the local machine is part of the practical orchestration path, not merely an abstract future allowance
- Obsidian should remain valuable, but it should not be forced into the hot-path transport role if a better state plane exists

The design problem is therefore no longer "how do we keep packet continuity alive?"
It is "how do we give GPT and Hermes one shared workstream state plane while keeping Obsidian as the semantic owner instead of the runtime bus?"

## Non-Goals

- do not replace GPT with Hermes for high-ambiguity reasoning
- do not turn n8n into the semantic owner of the system
- do not demote Obsidian into an irrelevant note dump
- do not require local n8n to exist on day 1 before any progress is possible
- do not make the user manually reconstruct state when switching between GPT and Hermes

## Design Stance

### Two Assistants, One Shared State Plane

The user may start from GPT or from Hermes.

That is acceptable only if both assistants attach to the same structured workstream state.
The system must not depend on the user to manually replay intent, paste prior prompts, or decide which runtime owns the latest truth.

### Hot Path Versus Cold Path

The target architecture separates operational state from durable semantic knowledge.

- hot path: workstreams, tasks, waits, approvals, retries, local execution, remote execution, and recall events
- cold path: decisions, durable knowledge, operator context, retros, and architecture distillates

Hot path should live in structured runtime state.
Cold path should converge into Obsidian.

### Packet Stance

Packets remain useful, but only as generated briefings, compatibility summaries, and session-open aides.

They should not remain the primary transport that Hermes must poll every cycle to know what to do next.

## Ownership Model

| Surface | Owns | Must Not Own |
| --- | --- | --- |
| GPT | ambiguity resolution, planning, cross-domain tradeoffs, policy decisions, final acceptance | pretending to persist after session end |
| Hermes | persistent local execution, IDE control, local shells, git, bounded autonomy, local observation, escalation preparation | silent resolution of major ambiguity or policy changes |
| n8n | orchestration, schedules, waits, retries, webhooks, human approval steps, fan-out glue | semantic ownership, high-stakes reasoning |
| Supabase | canonical hot-state plane for workstreams, tasks, events, approvals, subscriptions, and locks | operator-facing semantic source of truth |
| Obsidian | semantic owner for durable notes, decisions, operator context, development archaeology, and distilled learning | mandatory hot-path trigger bus |
| GCP lane | always-on heavy execution, role workers, shared MCP, OpenJarvis serve, remote inference | semantic owner of the workstream |
| OpenJarvis and Ollama | local or remote reasoning acceleration, evaluation, memory projection, and learning-loop support | replacing Obsidian or Supabase ownership |

## Canonical Runtime Shape

### Hermes

Hermes should run as a persistent local daemon or agent runtime, not only as a prompt-driven helper.

Its job is to:

- subscribe to shared workstream state
- execute local IDE, shell, git, and local-model actions
- dispatch heavy or always-on work to the GCP lane when appropriate
- emit structured task events and artifact references
- raise recall requests when the autonomy boundary is crossed
- accumulate local operational learning without forcing every detail into Obsidian immediately

### GPT

GPT remains the best interface for:

- initial objective shaping
- ambiguous troubleshooting
- cross-domain tradeoffs
- quality and safety review
- resolution of repeated Hermes escalations

GPT should resume from structured workstream summaries and promoted semantic distillates, not from raw packet archaeology.

### n8n

n8n is optional in the bootstrap phase and preferred in the mature local loop.

Its role is to manage:

- cron and schedule triggers
- wait and resume boundaries
- webhook ingestion
- retry policies
- human approval steps
- file or event based automation glue

Inside that role, the preferred automation pattern is API-first and agent-fallback:

- n8n starts from webhook, schedule, or event triggers
- the first path should stay deterministic: API lookups, FAQ matching, Supabase reads, or other cheap structured checks
- IF or Switch nodes act as the explicit decision point
- only the failed, incomplete, or ambiguous path escalates into shared MCP or Hermes fallback reasoning

This keeps n8n in the orchestration position rather than forcing it to become the main reasoning engine.

If n8n is not available yet, Hermes may talk directly to the shared workstream state plane.
Later n8n should wrap that flow, not replace the ownership model.

## Shared Workstream State Plane

The target state should use structured workstream objects instead of packet-only coordination.

This plane must not become a mixed bucket for both the personal GPT plus Hermes operator loop and arbitrary public Muel user traffic.

Shared infrastructure is acceptable.
Shared row families without an explicit lane boundary are not.

At minimum, the hot-state layer needs a runtime lane or equivalent namespace boundary so:

- the personal operator lane can remain GPT plus Hermes centric
- public Muel user traffic can stay guild scoped and tenant isolated
- escalation from the public lane into the operator lane is explicit rather than accidental

Minimal objects:

1. `workstream`
   one objective with owner, mode, state, priority, and current boundary
2. `task`
   one bounded executable unit assigned to Hermes, GPT, n8n, or a remote worker
3. `task_event`
   append-only event log for progress, evidence, warnings, failures, and completion
4. `recall_request`
   structured request for GPT re-entry with compact reason, evidence refs, and blocked action
5. `artifact_ref`
   link to repo files, logs, vault notes, URLs, or remote job identifiers
6. `decision_distillate`
   short durable conclusion later promotable into Obsidian

Supabase is the natural owner for this hot-state layer because it already fits subscriptions, structured rows, approvals, and automation wiring.

## Operating Flow

### 1. Objective Creation Or Refinement

GPT or the user creates or refines a `workstream`.
That state is written into the hot-state plane, not only into a markdown packet.

### 2. Local Consumption

Hermes subscribes to relevant workstreams and claims tasks it is allowed to execute.
This is the point where the local IDE and shell burden actually shifts away from the human.

### 3. Orchestration

If n8n is present, it owns waits, timers, scheduled resumes, webhook triggers, and approval routing.
If n8n is absent, Hermes continues directly against the workstream state plane.

When n8n is present, the routing rule should be explicit:

- API path first
- MCP-wrapped or Hermes fallback second
- GPT recall only when policy, ambiguity, or risk crosses the fallback boundary

### 4. Remote Dispatch

When the task exceeds local scope or belongs on the always-on lane, Hermes or n8n dispatches to GCP-backed workers, shared MCP surfaces, or OpenJarvis remote services.

### 4a. One Working Example Already Exists

The reverse-engineered YouTube community post path is already the shape of the target contract.

- trigger: monitor tick or webhook asks for the latest community post
- API-first path: deterministic scrape via n8n or local worker because no stable official API exists for this slice
- router decision: if the scrape succeeds, continue the publish or ingest path without invoking expensive reasoning
- fallback path: if the page shape drifts, escalate into Hermes repair work, shared MCP lookup, or GPT recall depending on risk and ambiguity

This means the next architecture step is not inventing the first example. It is formalizing and reusing the example we already have.

### 5. Recall

If ambiguity, risk, or policy scope increases, Hermes raises a `recall_request` rather than continuing blindly.

### 6. Distillation

When a result becomes durable and reusable, the system promotes it into Obsidian as a decision, runbook update, architecture delta, or development slice.

## Bootstrap Session Synthesizer

The smallest safe implementation slice for this target state is now a structured session synthesizer on top of the existing queue-aware control plane.

`npm run local:control-plane:future` should not become a second runtime owner.
Its job is to read the current control-plane state and emit one structured session synthesis that says:

- which bounded session kind is next: stabilize, monitor, queue-seed, bounded-turn, bounded-wave, or closeout
- which queue mode is merely observed and which mode is actually planned for the next launch
- which objective is the next launch target
- which surface owns coordination, which surface owns the bounded GPT handoff, and which execution lane should carry the actual work
- which child turns should exist when a bounded wave is justified

Current lane selection is intentionally fail-closed:

- default to `hermes-local-operator`
- raise `local-workstation-executor` only when the objective explicitly signals GUI, browser, screenshot, or desktop work
- raise `remote-heavy-execution` only when the objective explicitly signals deploy, remote, benchmark, worker, or cloud-heavy scope

This keeps the session-orchestration loop additive.
Copilot still does not own mutable state, and OpenJarvis still owns queue selection plus the reentry boundary.
The synthesizer only makes the next bounded handoff legible enough that Hermes, Multica, and future automation can reopen the right session without ad hoc lane selection.

## Obsidian In The Target State

Obsidian remains mandatory, but its role becomes cleaner.

Use Obsidian for:

- decision distillates
- operator runbooks
- architecture changes
- semantic knowledge objects
- durable session briefings
- retros and development archaeology

Do not require Obsidian for:

- every hot-path wake-up signal
- every Hermes queue decision
- every wait and resume boundary
- every local execution heartbeat

Packets become generated views over the real workstream state, not the only state Hermes can trust.

## Observability Layering

OpenJarvis is useful here, but it is not the whole observability plane.

Use OpenJarvis for:

- local telemetry stats
- eval and benchmark loops
- optimization experiments
- memory-projection inspection
- scheduler visibility

Do not force OpenJarvis to own everything:

- Supabase should still own canonical route events, recall boundaries, and artifact refs
- n8n should still own router-node execution history and wait or retry visibility
- Obsidian should still own durable semantic distillates and operator-readable change history

The target is layered observability, not one tool pretending to be the whole control tower.

## Hermes Local Learning Stance

Hermes should be allowed to learn locally from repeated work, but that learning must be layered.

- immediate local learning: queue history, step outcomes, tool preferences, recent failures, repeated file targets
- promoted semantic learning: distilled decisions, stable procedures, and operator-relevant lessons written to Obsidian

This keeps local learning fast without polluting Obsidian with every transient observation.

## Recall Boundary

Hermes must recall GPT when any of the following becomes true:

- the objective or priority changes materially
- evidence conflicts and no bounded deterministic resolution exists
- a destructive or policy-sensitive action is next
- architecture, security, or trust-boundary tradeoffs appear
- repeated automation failure suggests the current plan is wrong
- required remote or local surfaces are degraded in a way that changes the plan, not only the step

## Migration Order

### Phase 1

Keep the current packet-based continuity loop as the compatibility fallback.
Do not expand packet polling as the final architecture.

### Phase 2

Introduce the structured workstream state plane and generate session summaries from it.

### Phase 3

Run Hermes as a persistent local consumer of that state plane.

### Phase 4

Add self-hosted n8n for schedules, waits, retries, approvals, and webhook glue.

### Phase 5

Promote only stable semantic outputs into Obsidian and reduce packets to generated briefing artifacts.

## Definition Of Done For This Direction

This direction is real only when all of the following are true:

- Hermes can continue meaningful local work without an active GPT session
- GPT resumes from shared structured state and distilled evidence rather than raw packet replay
- Obsidian remains the semantic owner without acting as the hot-path transport bus
- self-hosted n8n is optional for bootstrap and beneficial for maturity, not a prerequisite for truth ownership
- heavy or always-on bounded execution uses the GCP lane consistently enough to move toward the 80 to 90 plus leverage goal
- the user can treat Hermes as a real second assistant without also becoming the manual message bus between assistants

## Relationship To Neighbor Documents

- `HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md` remains the current continuity-safe packet contract
- `GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md` remains the transitional bounded-sidecar operating plan for the existing loop
- this document defines the target state where Hermes becomes a first-class second assistant over a shared hot-state plane and Obsidian keeps semantic ownership
