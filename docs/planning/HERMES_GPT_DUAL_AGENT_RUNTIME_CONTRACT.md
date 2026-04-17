# Hermes GPT Dual-Agent Runtime Contract

## Purpose

This document defines the ongoing collaboration contract between a bounded GPT-5.4 reasoning session and a locally persistent Hermes runtime.

Status note:
this contract describes the current continuity-safe packet model.
The future target state where Hermes becomes a first-class second assistant over a structured hot-state plane is documented in `GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`.

It exists after the minimum Hermes bootstrap is already working.
The main problem is no longer installation. The main problem is continuity: how the system keeps operating when the high-reasoning session ends, and how the next session resumes without drift.

## Scope

This contract covers three things:

1. the Obsidian handoff packet schema used across session boundaries
2. the autonomy boundary for local Hermes plus Ollama
3. the shared progress status format used while work is active

This is a local operator overlay.
It does not replace repository runtime truth, production control-plane ownership, or the broader OpenJarvis-centered service architecture already documented elsewhere.

## Runtime Assumptions

- user: final owner of intent, priorities, and acceptance
- GPT-5.4 xhigh: primary episodic reasoning brain for ambiguity, planning, synthesis, and high-stakes decisions
- Hermes: persistent local runtime for observation, execution, packet upkeep, and between-session continuity
- Ollama: cheap local support for summarization, preprocessing, classification, and bounded fallback
- Obsidian vault: semantic owner of durable meaning, evidence links, and resumable state

## Core Rule

Continuity must remain recoverable through explicit collaboration artifacts and the shared hot-state plane.

In the current compatibility loop, the visible session-boundary artifact is still the handoff or progress packet in Obsidian.
In the mature team-sharing model, Supabase owns mutable workflow state while Obsidian owns the durable semantic mirror and packet projection.

It must not depend on temporary model memory, implicit chat history, or a single still-open autopilot session.

## Packet And Team Sharing Rule

The team should not treat packets as a third independent state owner.

- ACP, VS Code chat launch, and local bridge actions are transport surfaces only.
- Supabase workflow sessions and workflow events are the canonical mutable source when a structured runtime lane exists.
- Obsidian packets are the durable session-boundary projection and semantic recall surface for humans and later agents.
- Local Hermes or OpenJarvis runs may create or update packets, but team-visible mutable state should still land in Supabase first when the structured field already exists.
- Team sharing should therefore happen through shared Obsidian mirrors plus operator-visible runtime summaries, not through private local packet files alone.

## Single User Ingress Rule For Compatibility Mode

This section describes the current compatibility rule, not the final target state.

In the final target state Hermes is still a real second assistant.
What remains incompatible with that target is forcing the user to manually replay the same intent into two disconnected runtimes.

While the packet-centered compatibility loop remains active, the user should have one normal operational conversation surface.

That surface is the bounded GPT-5.4 reasoning session in the IDE.

Hermes is not yet the primary direct request surface in this compatibility contract.
Hermes is the persistent local runtime that carries bounded continuity work between GPT sessions until the shared hot-state plane and mature dual-agent flow are fully in place.

The steady-state workflow must therefore be:

1. the user gives all requests to GPT
2. GPT defines the active objective, updates packets, and sets the safe autonomy boundary
3. Hermes continues only the bounded local continuity work it is allowed to do
4. the next user request returns to GPT, not to Hermes directly

Direct Hermes interaction may still exist for bootstrap, validation, and the broader target-state dual-agent model.
What is not acceptable is making the user manually relay the same intent twice just to preserve continuity in the compatibility loop.

If the loop requires the user to routinely forward prompts into Hermes, the collaboration boundary is underdesigned.

## Bounded Parallel Worker Rule

Single ingress remains the user-facing compatibility contract.
That does not forbid bounded parallel GPT workers behind the coordinator.

The allowed swarm shape is:

- one coordinator GPT turn owns the active workstream objective
- Hermes owns continuity, queueing, launch, and restart boundaries
- up to three bounded GPT worker turns may run in parallel when each one has a distinct shard, artifact budget, and recall condition
- OpenClaw remains a local personal asset agent only and does not own shared routing, swarm scheduling, or semantic state

Parallelism must fail closed under these guardrails:

- one wave objective per coordinator
- one bounded shard per worker
- one artifact budget per worker
- separate worktree roots for code-writing workers when available
- explicit wave and shard metadata carried through reentry acknowledgment closeout

If those guards are missing, the system should fall back to the simpler single-worker compatibility loop instead of pretending unrestricted parallelism is safe.

## Economic Rule

The system must optimize for reasoning value per token and per context window.

It must not create a structure where Hermes sends large undifferentiated context to GPT and forces GPT into low-value conservative output just because the prompt budget is already exhausted.

If the system starts proposing tiny documentation-only work such as creating a fresh retro note when the real need is a higher-value decision or implementation step, that is a design failure in the collaboration boundary rather than an acceptable normal outcome.

## Decision Learning Rule

Non-trivial GPT decisions are not only for the current session.

They are learning assets for Hermes when they are distilled into reusable operational form.

The goal is not to preserve raw transcript volume.
The goal is to preserve:

- why a path was chosen
- what evidence pattern mattered
- what alternatives were rejected
- which triggers should cause Hermes to recall GPT again
- what Hermes should now be able to do alone next time

This means GPT output should be compressed into decision distillates that Hermes can reuse, not stored as expensive opaque chat residue.

## Delegation Rule

Hermes should be treated as GPT's delegated hands, proxy, and local operator collaborator.

That means the efficiency target is not symmetric reasoning.
The efficiency target is asymmetric collaboration:

- GPT spends tokens on ambiguity, tradeoffs, coding decisions, acceptance, and goal shaping.
- Hermes spends runtime on observation, dynamic research, environment probing, bounded crawling, tool execution, continuity, and evidence gathering.

If Hermes can cheaply gather the missing fact, fetch the missing page, probe the missing route, or prepare the missing artifact without crossing a policy boundary, GPT should not spend a full high-cost reasoning turn rediscovering it.

Hermes is therefore not just a continuation shim.
Hermes is the active delegate that expands what GPT can accomplish per bounded session.

## Runtime Profile Family Rule

The compatibility loop should not treat every Hermes relaunch as one broad delegated lane.

The active runtime profile now carries bounded intent so Hermes can reopen in the right posture instead of rediscovering what kind of turn it is.

- `default`: general continuity-safe launch when no narrower role is justified
- `auto`: infer the role from the queued objective plus current hot-state signals
- `delegated-operator`: broad multi-surface hands layer when the turn mixes research, tooling, and bounded execution
- `scout`: research, probing, mapping, upstream verification, and repo archaeology
- `executor`: bounded implementation, patching, and validation work
- `distiller`: closeout, changelog, wiki, playbook, and decision-compression work
- `guardian`: queue health, stale reentry, supervisor continuity, rollback, and recovery work

Profile continuity matters across three boundaries:

- queued GPT chat launch
- reentry acknowledgment closeout
- queue-aware supervisor restart

If the profile is lost at one of those boundaries, Hermes reopens with the wrong operating contract and wastes the next turn reacquiring posture instead of progressing the objective.

Session-start preparation is intentionally state-dependent.
If the supervisor is already alive, a healthy session-start result may omit remediation instead of forcing a redundant restart just to satisfy a smoke check.

## Bootstrap Minimization Rule

Session-open quality should come from a small high-signal bundle, not from rereading a large compatibility archive every time.

The preferred session-open bundle is:

- current objective
- latest workflow status and latest bounded result
- latest route guidance for API-first vs MCP vs Hermes fallback
- latest decision distillate
- active autonomy queue and recall triggers
- operator personalization fields that materially affect execution or presentation
- durable evidence links into Obsidian, repo docs, and runtime artifacts

If the system needs many large documents at every new session to feel safe, then the hot-state plane is still underdesigned.

Advisor-style subordinate consultation is therefore conditional after bootstrap, not a default first-line optimization.
The first economic fix is to shrink session-open state into one compact bundle and reuse existing route guidance.
Only after that should the system consider a capped guidance-only advisor hop for repeated hard reasoning checkpoints, while deterministic API-first paths stay advisor-free by default and policy-sensitive edges still escalate through explicit GPT recall.

## Obsidian Logging Rule

Architecture or autonomy changes must leave behind a durable Obsidian-visible artifact.

At minimum, a material change should produce one or more of the following:

- decision note
- requirement note
- development slice
- retro note
- updated active handoff or progress packet

Obsidian is not the raw event stream.
It is the durable semantic owner for why the system changed, what it now does, and what future sessions should inherit.

## Personalization Rule

Operator-specific preferences should be promoted into explicit reusable inputs instead of remaining buried in transient chat history.

Those inputs may live in Obsidian, shared hot-state, or both, but they should be available to both GPT and Hermes at session open.

High-value personalization fields include:

- preferred operator-facing surfaces such as visible terminals or editor openings
- logging expectations for Obsidian and development archaeology
- routing posture such as local-first, remote-optional, or explicit escalation-only
- output and sanitization preferences that affect Discord, docs, or vault surfaces

## Capability-Demand Rule

When Hermes discovers that the current goal is blocked by a missing capability, missing source, missing adapter, missing automation, or repeated context reacquisition cost, Hermes should leave behind a compact capability-demand artifact instead of silently failing or forcing GPT to rediscover the same gap later.

The artifact may live in the active packet, progress snapshot, or a dedicated Obsidian-visible note, but it should always preserve at least:

- the bounded objective that was being attempted
- the missing capability or missing source
- the failed or insufficient route that was tried first
- the cheapest likely enablement path such as script, adapter, MCP tool, n8n flow, data sync, or operator action
- the proposed owner for the next fix: GPT, Hermes, operator, n8n, shared MCP, or remote worker
- evidence refs that justify the claim
- the recall condition for when GPT must reason again instead of Hermes continuing alone

When the demand ledger becomes durable and team-relevant, it should also be materialized into a shared Obsidian-visible mirror through the repository backfill path so repeated autonomy gaps do not stay trapped only inside the hot-state event plane.

This artifact is not a complaint log.
It is the demand ledger for improving the system for its primary customer.

If the same capability-demand repeats, the default response should be structural improvement rather than another round of narrative workaround.
Repeated demands should converge into one of the following:

- deterministic script or local adapter
- shared MCP tool or higher-level contract
- n8n workflow or automation router branch
- durable Obsidian canonical note or requirement note
- operator-visible runbook or environment fix

## Role Split

| Actor | Owns | Must Not Own |
| --- | --- | --- |
| User | final priorities, approval boundaries, definition of success | repetitive low-level continuity work that can be delegated safely, or manual prompt bridging between GPT and Hermes as a normal operating step |
| GPT-5.4 | ambiguous intent resolution, tradeoff judgment, planning, acceptance criteria, high-risk synthesis | pretending to be always-on after the session ends |
| Hermes | persistent observation, low-risk execution, local tooling, packet upkeep, recall preparation, and local learning between GPT sessions | redefining user priorities, silently closing major ambiguity, or forcing the user to become a manual router between assistants |
| Ollama | cheap transforms, local classification, draft summaries, offline assistance | acting as the final authority for high-stakes ambiguous reasoning |

## Interaction Contract

In the current compatibility loop, the user normally talks to GPT first.
GPT delegates continuity-safe work to Hermes through explicit packets, pre-approved queues, and later automation bridges if available.

In the target-state dual-agent model, the user may also start with Hermes directly, provided both assistants are attached to the same structured workstream state and the system does not depend on manual replay.

The user should not have to decide which runtime should receive a given request.
That routing burden belongs to the system design, not to the operator.

Hermes may remain active when GPT is gone, but it should continue only within the last approved objective and autonomy boundary.
It should not accept fresh strategic intent from a separate user conversation as part of the normal loop.

## Collaboration Lifecycle

### 1. Between Sessions

Hermes remains active and does the following:

- keeps one active handoff packet per workstream current
- updates a short progress snapshot as state changes
- gathers evidence, logs, repo state, and vault references
- queues only pre-approved safe local actions
- prepares recall packets when ambiguity or risk crosses the boundary

### 2. Session Open

The next GPT session should start from the handoff packet first, not from raw vault archaeology.

Hermes should present:

- the current objective
- the verified current state
- what changed since the last session
- the compressed decision distillates that still matter
- open loops and pending decisions
- the safe autonomous queue it did not finish or did not have authority to close

The user should resume by talking to GPT directly.
The session-open burden is on Hermes to prepare a good handoff packet, not on the user to manually reconstruct prior context or replay prompts into multiple runtimes.

When a current hot-state summary already provides the active route guidance, decision distillate, personalization, and latest bounded result, GPT should consume that summary first and defer broad document rereads until a real ambiguity remains.

### 3. Active Collaboration

While a GPT session is live:

- GPT defines or refines intent, priorities, acceptance criteria, and risk posture
- Hermes executes bounded work, collects evidence, and updates the progress snapshot
- both sides write toward convergence in Obsidian instead of building hidden side state

### 4. Session Close

Before the reasoning session ends, the system should leave behind:

- one current handoff packet
- one short progress snapshot
- one compact route-guidance section that says whether Hermes should stay on the deterministic API path or switch to MCP or local fallback
- one explicit lifecycle rule that says whether a released cycle should yield to GPT or human, or whether Hermes may start the next bounded automation cycle on its own
- one compressed decision distillate section that Hermes can learn from
- an explicit list of unresolved decisions
- a safe autonomous queue for Hermes
- clear recall triggers for when Hermes must reopen a higher-reasoning session
- one capability-demand entry whenever the turn discovered a structural missing piece that should not be rediscovered from scratch next time

## Protocol Surface

The collaboration boundary should behave like a small explicit protocol, not like an informal conversation that depends on hidden chat state.

### Core Message Types

- `progress_update`
   High-frequency mutable status from Hermes while work is active.
- `handoff_update`
   Stable cross-session state replacing raw transcript replay.
- `validation_result`
   Evidence from a bounded command, tool, or adapter check.
- `recall_request`
   Compact escalation from Hermes to GPT when local autonomy should stop.
- `decision_response`
   GPT output that resolves ambiguity and must be distilled into future Hermes guidance.
- `autonomy_queue_item`
   A pre-approved low-risk next step Hermes may continue alone.
- `capability_demand`
   A compact statement that a missing tool, source, route, automation, or sync step blocked efficient progress and should become a reusable improvement target.
- `protocol_failure`
   A first-class record that the transport or tool surface itself drifted, returned noisy output, or violated the intended boundary.

### Envelope Fields

Every protocol message should be recoverable from the active handoff and progress packets, even if the transport itself is transient.

Recommended minimum envelope:

- `protocol_version`
- `workstream_id`
- `message_type`
- `sender`
- `packet_kind`
- `objective`
- `freshness`
- `payload_summary`
- `evidence_refs`
- `decision_distillates`
- `next_action`
- `recall_triggers`
- `context_budget_state`

### Suggested Sender Values

- `gpt`
- `hermes`
- `human`
- `tool:obsidian-cli`
- `tool:acp`

### Protocol Failure Classes

These failures should be recorded explicitly instead of being hidden inside vague notes.

- `DRIFTED_RESPONSE`
   The agent answered a different question than the one actually asked.
- `NOISY_TRANSPORT`
   The tool launched correctly but returned logs or wrapper noise instead of the expected payload.
- `WRITE_ESCALATION`
   A read-only ask unexpectedly attempted a write or file creation.
- `UNVERIFIED_STATE`
   Hermes collected an inference without enough checked evidence.
- `APPROVAL_REQUIRED`
   The next step crossed a real human or GPT approval boundary.

### Minimal Wire Shapes

`validation_result` should be the default message for narrow tool checks:

```yaml
protocol_version: 1
workstream_id: hermes-local-bootstrap
message_type: validation_result
sender: hermes
packet_kind: progress
objective: verify the local Obsidian continuity surface
freshness: checked-now
payload_summary: obsidian-cli launched through the WSL bridge but returned app logs instead of note body output
evidence_refs:
   - [[HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS]]
next_action: compare the same read-only ask through ACP
recall_triggers:
   - repeated drift on the ACP comparison
context_budget_state: delta-only; raw install logs omitted
```

`recall_request` should stay short and decision-shaped:

```yaml
protocol_version: 1
workstream_id: hermes-local-bootstrap
message_type: recall_request
sender: hermes
packet_kind: handoff
objective: stabilize the first local continuity loop
payload_summary: read-only validation succeeded at filesystem level but tool surfaces remain noisy
evidence_refs:
   - [[HERMES_LOCAL_BOOTSTRAP_HANDOFF_PACKET]]
decision_distillates:
   - validate read-only before wider autonomy
next_action: decide whether ACP or a narrower prompt template becomes the canonical first comparison path
recall_triggers:
   - tool output remains off-target after one bounded comparison
context_budget_state: only changed facts included
```

### Packet Mapping Rule

- This mapping rule describes the Obsidian packet projection layer. It does not change hot-state ownership when Supabase workflow state already exists.
- `progress_update` and `validation_result` belong in the active progress packet.
- `handoff_update`, `recall_request`, `decision_response`, and `protocol_failure` belong in the handoff packet when they remain relevant across session boundaries.
- If a message no longer matters after the immediate step, do not promote it beyond the active progress packet.

## Obsidian Handoff Packet Contract

### Note Class

Use a `workspace` note with `packet_kind: handoff`.

The handoff packet is the authoritative session-boundary note for one active workstream in the Obsidian projection layer.
When Supabase workflow state exists, the packet is a mirror and compatibility artifact, not a second mutable workflow ledger.
Keep the filename stable instead of creating a new packet every turn.

### Required Frontmatter

Use the normal workspace note contract plus:

```yaml
packet_kind: handoff
```

### Required Sections

1. `Session Objective`
   The user-visible outcome in one or two lines.
2. `User Intent Model`
   Requested outcome, explicit non-goals, current priority, and important constraints.
3. `Verified State`
   Facts that were actually checked, with timestamps or note references when possible.
4. `Completed Since Last Session`
   What Hermes or GPT already finished.
5. `Decision Distillate For Hermes`
   Reusable lessons from GPT decisions, compressed for future Hermes reuse.
6. `Open Loops`
   Work still in motion, including partial execution.
7. `Pending Decisions For GPT`
   Ambiguities, tradeoffs, or risk calls Hermes should not settle alone.
8. `Safe Autonomous Queue For Hermes`
   Low-risk tasks Hermes may continue between sessions.
9. `Evidence And References`
   Canonical notes, source notes, repo docs, logs, or command evidence.
10. `Recall Triggers`
   Concrete conditions that require a new high-reasoning session.
11. `Context Budget State`
   What was included, what was intentionally omitted, and which deeper evidence should stay on-demand.

### Quality Rules

- separate verified facts from hypotheses
- record freshness when environment-sensitive facts may drift
- do not store hidden chain-of-thought or free-form speculation dumps
- if confidence is low, state that directly
- if a fact is inferred rather than checked, mark it as inferred
- compress decisions into reusable heuristics, triggers, and rejection reasons instead of replaying the full reasoning transcript
- prefer delta summaries and evidence pointers over full note or log duplication

### Decision Distillate Shape

Each meaningful GPT decision should be distilled into a short reusable block with most of the value but little of the token cost.

Recommended fields:

- `situation`: what kind of problem this was
- `decision`: what was chosen
- `why`: the shortest defensible reason
- `rejects`: what Hermes should avoid repeating
- `reuse_when`: when Hermes may apply the same pattern again
- `recall_when`: when Hermes must escalate instead of reusing it blindly

Only promote this into a separate durable note when recurrence or strategic importance is high enough to justify a standalone artifact.
Otherwise keep it inside the handoff packet or merge it into an existing canonical note.

## Context Exchange Rules

### Progressive Disclosure

Hermes should send context to GPT in layers, not in one raw dump.

Preferred order:

1. active objective plus delta since last GPT session
2. handoff packet summary plus decision distillates
3. specific evidence references and only the minimal excerpts needed
4. raw logs, full notes, or large source bodies only on demand

### Default Compression Behavior

Hermes should compress by default before recall.

That means:

- summarize changed state instead of replaying unchanged state
- link to existing notes instead of copying note bodies
- ship only the exact file, command, or evidence slice that affects the pending decision
- batch low-value updates rather than escalating them one by one

### Anti-Bottleneck Rule

Hermes must not turn GPT into a bottleneck by escalating every uncertainty.

GPT must not turn Hermes into a bottleneck by emitting decisions that are too vague, too bulky, or too coupled to one transient session to be operationalized later.

The user must not become the transport layer between the two runtimes.

The handoff contract should therefore maximize:

- small high-signal packets
- reusable decision distillates
- explicit recall triggers
- minimal necessary evidence load

## Cost Guardrails

### Low-Value Escalation Ban

Hermes should not recall GPT for a task whose expected value is lower than the likely token and context cost unless the task crosses a true risk or approval boundary.

Preferred fallback order:

1. handle locally
2. batch with adjacent low-risk work
3. wait until a higher-value recall is justified
4. only then escalate to GPT

### No Forced Minimal-Change Trap

The system must not bias GPT toward cheap-looking but low-value outputs just because context was prepared badly.

If the real need is a substantive decision, implementation, or architecture call, Hermes should prepare a compact but sufficient packet so GPT can act on the real problem rather than defaulting to placeholder work.

Bad pattern examples:

- creating a standalone retro note for a narrow local state change when updating the active handoff packet would preserve enough learning
- sending whole note bodies when only one changed constraint matters
- escalating a local classification or summarization task that Hermes plus Ollama can close safely

Good pattern examples:

- updating one active handoff packet with a new decision distillate
- updating one progress snapshot with the latest delta and blocker
- escalating only the compressed ambiguity that actually needs GPT judgment

## Hermes Autonomy Boundary

### Allowed Without Recall

Hermes may continue autonomously for work that is low-risk, reversible, and already aligned with the last approved objective.

Typical examples:

- read/search/summarize vault and repo material
- maintain handoff and progress packets
- run read-only diagnostics and collect evidence
- prepare drafts, outlines, and candidate next steps
- execute previously approved low-risk repeatable tasks
- keep watch loops, reminders, and routine local housekeeping active

None of the above should require the user to open Hermes separately and resend the same request manually.

### Allowed Only With Prior Pre-Approval

Hermes may perform these only if the user or GPT already defined the boundary and rollback posture:

- bounded canonical-note updates backed by explicit evidence
- small local write actions with clear rollback
- staged code or docs edits prepared for later review
- routine command execution where the success condition is already specified

### Must Recall GPT-5.4

Hermes must reopen a higher-reasoning session when any of the following becomes true:

- the user intent is ambiguous, changed, or internally conflicting
- multiple viable directions exist and the tradeoff matters
- evidence conflicts or current state is unclear
- the task touches architecture, governance, policy, auth, scheduler, secrets, or destructive actions
- retries failed and the next step requires interpretation rather than collection
- low-confidence local inference is about to become a durable or user-visible decision
- time, cost, or scope needs reprioritization

### Must Escalate To The User Directly

Hermes or GPT should stop and ask the user when the task crosses a real approval boundary, such as:

- merge, deploy, rollback, or destructive deletion
- new secret handling or account access changes
- irreversible note cleanup or bulk canonical rewrites
- changed success criteria or priority inversion

## Recall Packet Minimum

When Hermes decides to recall GPT-5.4, the escalation payload should be short and structured.

It should contain:

- `problem`: what blocked continued autonomy
- `current_state`: verified facts only
- `options`: viable next directions if more than one exists
- `recommended_path`: Hermes's best bounded recommendation if confidence is acceptable
- `blocked_action`: what Hermes intentionally did not do alone
- `evidence_refs`: links to the handoff packet, progress snapshot, or supporting notes
- `decision_distillates`: only the prior rules or lessons still relevant to the blocked problem
- `context_budget_state`: what was included, what was deferred, and what can be fetched on demand

## Shared Progress Status Format

### Progress Packet Class

Use a `workspace` note with `packet_kind: progress`.

This note is the high-frequency mutable status surface. It should stay short and overwrite-friendly.

### Progress Packet Frontmatter

Use the normal workspace note contract plus:

```yaml
packet_kind: progress
```

### Progress Packet Sections

1. `Objective`
2. `Owner And Mode`
   Include current owner (`hermes`, `gpt`, or `human`) and current mode (`observing`, `executing`, `waiting`, `blocked`, `review-needed`).
3. `Delta Since Last GPT Session`
4. `Completed`
5. `In Flight`
6. `Blockers`
7. `Next Action`
8. `Escalation Status`
   Use `none`, `pending-gpt`, or `pending-human`.
9. `Context Budget State`
10. `Evidence And References`

### Formatting Rules

- keep it compact enough to scan in under a minute
- overwrite aggressively instead of appending diary-style noise
- link to handoff, source, digest, and canonical notes instead of duplicating their bodies
- keep no more than one active progress snapshot per workstream
- keep unchanged state out of the packet unless it is needed for the next decision
- prefer one updated packet over spawning a new low-value note

## Hermes Learning Capture

Hermes should learn from GPT decisions in compressed operational form.

The preferred capture order is:

1. update the handoff packet's `Decision Distillate For Hermes` section
2. if the rule already belongs to an existing canonical note, merge it there
3. only create a standalone digest or decision note when the learning is recurrent, strategic, or cross-workstream

The default is not "create another retro note."
The default is "update the smallest existing artifact that preserves the future value."

## Adoption Sequence

1. finish the minimum Hermes bootstrap and verify safe vault writes
2. establish the single-user-ingress rule so the user talks only to GPT in normal operation
3. introduce one stable handoff packet per active workstream
4. introduce one compact progress snapshot per active workstream
5. route all between-session Hermes continuity through those two notes
6. only then automate stronger recall triggers, broader safe queues, or programmatic GPT-to-Hermes bridges

## Risks And Mitigations

### Risk: Hermes guesses too much

Mitigation:

- keep recall triggers explicit
- require pending decisions to be listed in the handoff packet
- do not let local cheap-model output silently become canonical truth

### Risk: session resume drifts from reality

Mitigation:

- refresh environment-sensitive facts before resuming
- distinguish checked facts from inferred state
- keep evidence links near every major claim

### Risk: packet sprawl turns into note clutter

Mitigation:

- one active handoff packet and one active progress snapshot per workstream
- converge stable learning into digest, canonical, or decision notes
- archive or supersede old packets when the workstream closes

### Risk: GPT becomes cost-inefficient because Hermes overpacks context

Mitigation:

- escalate deltas, not archives
- keep context layers progressive and on-demand
- ban low-value escalations that Hermes can close safely
- treat a placeholder documentation action chosen only because the real packet was underprepared as a contract failure

### Risk: the user becomes the manual bridge between runtimes

Mitigation:

- keep this packet contract explicitly scoped as a compatibility rule instead of the target-state operating model
- do not force the user to duplicate the same request into both GPT and Hermes while the shared state plane is still incomplete
- make Hermes consume handoff packets, progress packets, and pre-approved queues instead of expecting restated user intent
- prefer future automation bridges over asking the user to relay the same instruction twice

## Relationship To Neighbor Documents

- `HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md` defines the minimum environment and first safe loop.
- `OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md` defines the minimum frontmatter contract these packets still must respect.
- `OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md` contains the concrete handoff and progress packet templates.
- `LOCAL_COLLAB_AGENT_WORKFLOW.md` governs IDE lead/consult routing, while this document governs cross-session continuity between bounded GPT reasoning and persistent Hermes execution.
- `docs/adr/ADR-005-context-compression-pipeline.md` remains the repository anchor for context compression intent; this document applies that intent specifically to bounded GPT reasoning plus persistent Hermes continuity.
