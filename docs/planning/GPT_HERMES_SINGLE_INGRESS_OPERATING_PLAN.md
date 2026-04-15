# GPT Hermes Single-Ingress Operating Plan

## Objective

Preserve the current continuity-safe single-ingress compatibility mode without confusing it for the actual target state.

The target state is now explicit: GPT and Hermes are both real assistants, GPT-5.4 remains the strongest episodic reasoning surface, and Hermes is the persistent local agent that continues work after a GPT Autopilot session ends.

## Status Note

This document remains the current compatibility and transition plan for the bounded single-ingress packet path already reflected in the repository.

It is no longer the target-state definition for GPT and Hermes collaboration.
That target now lives in `GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`, where Hermes is treated as a true second assistant, local self-hosted n8n is an approved orchestration layer, and the shared hot-state plane replaces packet-only coordination.

## Validated Proof

The closed-loop restart claim is no longer theoretical in this repository.

- a bounded live goal-cycle demo completed two launches for the same objective with `resume_from_packets=false`
- the first unattended workflow session reached `released`
- Hermes then started the second bounded cycle from the released session state without reopening a GPT session
- the supervisor recorded that second launch as `packet-resume`, then stopped cleanly at `max_cycles_reached`

The architectural consequence is now fixed:
Hermes is not only a continuity observer that can keep a loop warm.
Hermes can also restart the next bounded automation cycle after a session has already completed, when the cycle is explicitly marked as restartable automation.

```mermaid
timeline
   title Hermes Auto-Restart After Released Session
   2026-04-12 14:58:04Z : Supervisor started
   2026-04-12 14:58:05Z : Cycle 1 started
   2026-04-12 14:58:56Z : Cycle 1 released
   2026-04-12 14:59:05Z : Cycle 2 started automatically
   2026-04-12 14:59:31Z : Cycle 2 released
   2026-04-12 14:59:36Z : Supervisor recorded packet-resume launch
   2026-04-12 14:59:37Z : Loop stopped at max_cycles_reached
```

## Foundational Premises

1. GPT-5.4 xhigh is an episodic high-reasoning assistant. When one Autopilot session ends, GPT does not keep acting autonomously in the background.
2. Hermes can keep running on the local machine across those session boundaries and can therefore overcome that limitation by carrying continuity, observation, execution, and local learning forward.
3. Because of that asymmetry, this document is only a compatibility bridge. It must not be read as an argument that Hermes should remain a hidden shim instead of a real second assistant.

## Non-Goals

- do not use this compatibility document to demote Hermes back into a mere hidden continuation shim
- do not require the user to manually relay prompts into Hermes as part of daily operation
- do not pretend a finished GPT session can keep reasoning autonomously after it ends

## Current State

- GPT remains the strongest reasoning surface for ambiguity, planning, and acceptance decisions.
- Hermes runs locally and can persist between GPT sessions.
- Hermes is now intended to mature into a true second assistant; this document only describes the currently safer compatibility loop while that target is being built.
- ACP transport was validated, but ACP remains a poor steady-state control surface because it promotes Hermes into a separate interactive chat lane.
- The dual-agent contract now explicitly requires a single user ingress and forbids normal manual prompt bridging.
- Handoff and progress packets already exist for the active local bootstrap workstream.
- The current continuity loop still carries an older GCP leverage diagnostic, but that diagnostic is not the active goal of the local-first Hermes rollout unless the operator explicitly asks for remote recovery work.

Discord should be treated here as a compatibility ingress, not the architectural owner of the workstream. The hot-state plane, local delegation surfaces, and recall boundaries should remain channel-agnostic enough that a future Chat SDK style multi-platform ingress can replace Discord without changing Supabase ownership, Obsidian semantic ownership, local n8n delegation, or Hermes/OpenJarvis routing.

## Concrete Example Already In Flight

One useful example is already real inside this repository: the reverse-engineered YouTube community post flow.

- the deterministic first path exists today through the `youtube-community-scrape` delegation slice
- it works precisely because the repository does not wait for an official API before using a bounded structured scrape path
- when that path fails because page shape or parser assumptions drift, the next step is not to pretend the API path still worked; it is to hand the failure to Hermes, shared MCP, or GPT according to the actual boundary

That makes this flow the first concrete handoff candidate for the broader API-first and agent-fallback contract.

## Compatibility Mode Definition

While this compatibility mode remains active, the operating model is:

1. the user gives every request to GPT
2. GPT decides intent, boundaries, and next safe autonomous work
3. GPT writes or updates handoff and progress packets
4. Hermes reads those packets and continues only approved local work
5. the next user interaction returns to GPT, which resumes from packet state

## Recommended Team Adoption Pattern

The repository should recommend this gradual acceleration method as the team-default methodology.

- Start from shared Obsidian and shared runtime surfaces first so teammates without Hermes, OpenJarvis, or ACP can still participate.
- When a richer local stack exists, use it as a bounded accelerator: open the next IDE session, attach compact packet context, perform bounded work, close out into the shared surfaces.
- ACP packet handoff is acceptable as a local bootstrap path, but the team-shared steady-state should prefer compact bundle plus explicit bounded chat-launch or runtime-summary reuse.
- The team should share the resulting method through repo docs and shared Obsidian mirrors, not by assuming everyone runs the same local bridge stack.
- Packet context is therefore a reusable collaboration briefing, while Supabase remains the mutable workflow ledger and Obsidian remains the durable semantic owner.

The practical success condition is not only continuity.
It is a measurable local operating lane where Hermes can continue approved work after GPT sessions end, local self-hosted n8n can hold waits, retries, and webhook glue, and remote surfaces remain optional dispatch or diagnostic lanes rather than the default goal metric.

## Efficient Operating Contract

The current efficiency rule is a 2 plus 1 operating split.

- GPT owns two standing tasks in each bounded turn.
- Hermes owns one standing task between bounded GPT turns.
- Everything else should be treated as an implementation detail, not as a new operating role.

### GPT Standing Task 1: Read The Smallest Useful Bundle And Identify The Route

At the start of a bounded turn, GPT should not reopen broad planning docs by default.

Start from the smallest useful runtime surface first:

- compact session-open bundle
- `hermes_runtime` readiness block
- active continuity packet only when the bundle still needs supporting detail

The startup job is to identify five things quickly and explicitly:

1. the single bounded objective for this turn
2. the cheapest valid route for that objective
3. the current blocker or ambiguity boundary
4. the next artifact or command that materially changes state
5. whether Hermes can continue after the turn without another GPT decision

The route order should stay efficiency-first:

1. deterministic API, DB, script, or n8n path
2. shared MCP or repo-native structured tool path
3. Hermes local operator fallback
4. deeper GPT reasoning only when ambiguity, policy, or tradeoff requires it

### GPT Standing Task 2: Distill The Turn And Queue The Next Bounded Work

At the end of a bounded turn, GPT should leave behind a compact restart surface rather than a long narrative.

The closeout contract is:

- one short decision distillate
- explicit done, not-done, and next-action state
- artifact refs that Hermes or the next GPT turn can reopen directly
- the next 1 to 3 approved bounded objectives, not a broad backlog dump
- the recall condition that tells Hermes when to stop and ask GPT again

Durable meaning should be promoted into Obsidian.
Hot mutable execution state should stay in Supabase or the live workflow session.
GPT should not use packets or notes as a substitute for explicit state when a structured runtime field already exists.

### Hermes Standing Task: Continue, Observe, Personalize, And Recall

Hermes owns the between-session continuity lane.

That means Hermes should:

- keep the local supervisor, queue, and runtime visibility warm
- use local tools, OpenJarvis, Ollama or Gemma, Obsidian, Supabase, and n8n as bounded supporting surfaces
- perform cheap retries, polls, routing probes, note projection, and local execution without reopening a high-cost GPT turn
- preserve operator personalization and continuity across GPT session boundaries
- recall GPT immediately when the task widens scope, crosses policy, or needs real tradeoff reasoning

Hermes is therefore the continuity operator, not the semantic owner.
Obsidian stays the durable semantic surface.
Supabase stays the hot mutable state plane.
GPT stays the strongest reasoning surface.

## Efficient Habits

### Start Habit

- begin from the session-open bundle before any broad repo or vault archaeology
- name the bounded objective in one sentence before opening additional tools
- prefer an existing route, adapter, script, or MCP tool before inventing a new path

### Execution Habit

- keep one active objective per bounded GPT turn
- prefer API-first and agent-fallback instead of reasoning-first
- use Hermes for waits, retries, queue maintenance, local note projection, and lightweight operator glue
- keep expensive reasoning for ambiguity, acceptance, and cross-domain tradeoffs

### Closeout Habit

- leave one compact distillate, one bounded next action, and clear recall conditions
- keep the safe autonomous queue short and ordered by the latest approved objective first
- write only the durable semantic delta into Obsidian, not a full replay of the turn

## Efficient Operations

### Per GPT Turn

1. read bundle and identify the route
2. execute the smallest state-changing step
3. distill the result and queue the next bounded step

### Per Hermes Continuity Cycle

1. observe runtime readiness and queue state
2. continue only the approved bounded local work
3. reopen GPT through the bounded VS Code chat handoff when a fresh reasoning turn is actually needed

### Weekly Hygiene

1. reduce repeated startup archaeology by improving the session-open bundle instead of adding more broad docs
2. move repeated fallback decisions into deterministic scripts, n8n flows, adapters, or MCP tools
3. promote stable lessons into Obsidian or operator docs so Hermes and GPT both reacquire less context next time

## Control Surface Stance

### GPT

- primary reasoning surface
- primary request ingress for this compatibility mode
- owner of ambiguity resolution and cycle closure

### Hermes

- persistent local sidecar
- owner of bounded continuity, observation, and low-risk execution
- not yet the primary direct request surface in this compatibility loop, even though the target state promotes Hermes into a real second assistant

### ACP

- debug and transport-validation surface only
- not the preferred steady-state control bridge

### VS Code CLI

- preferred candidate for the hidden control bridge
- better matched to editor control, file opening, command execution, and workspace steering than a second chat UI
- still not a substitute for a live GPT reasoning session
- it only counts as real leverage when the local continuity flow actually invokes the allowlisted bridge during resume or visibility handoff, not when the bridge merely exists on paper

### GCP Worker Lane

- always-on execution lane for role workers, OpenJarvis serve, shared MCP, and other canonical remote automation surfaces
- not the semantic owner of the workstream; semantic ownership still belongs to Obsidian and cycle closure still belongs to GPT
- real leverage means the active loop is actually wired to the canonical GCP surfaces from the operating baseline, not merely able to fall back to them later
- remote GCP leverage may still be observed as a diagnostic for remote-capable work, but it is not the active success metric for the local-first Hermes bootstrap unless the operator explicitly asks for that recovery path

### Local Docker Desktop Lane

- Docker Desktop is acceptable in this plan only as a local infrastructure sidecar surface, not as the primary execution substrate for Hermes or the local reasoning loop
- the preferred split on Windows keeps Hermes, repo checkout, Obsidian-facing file work, and high-I/O edit or test loops native or inside WSL on the Linux filesystem
- the preferred split on Windows keeps Ollama host-native or WSL-native so RAM and GPU remain dedicated to inference
- the preferred split on Windows uses Docker Desktop for low-risk local services such as LiteLLM proxy and n8n, where isolation, port publishing, logs, health, and restart policy are useful
- do not treat a repo bind mount on the Windows filesystem as a normal steady-state path for autonomous edit loops
- if a Linux-side loop is needed, store the working tree under the WSL filesystem rather than `/mnt/c/...`
- containers that need the local host model runtime should call it through `host.docker.internal`, not by guessing host IPs
- non-code state inside Docker Desktop should prefer named volumes or container-local storage over heavy host bind mounts

This keeps Docker Desktop in the place where it helps this repository and out of the places where Gemini's critique is directionally correct.

## Human-Visible Terminalization

- when Hermes starts or resumes interactive local work, it should also create a user-visible terminal surface such as PowerShell, WSL, or cmd
- hidden execution is acceptable for status probes, dry validation, and packet inspection, but not as the default operator-facing launch habit
- on Windows, the interactive Hermes goal-cycle path should prefer a visible PowerShell launch that keeps the session window open after completion so the user can inspect what happened

## Minimal CLI Allowlist v1

The allowlist is not a prompt template.
It is the smallest set of concrete control actions Hermes may invoke through the VS Code CLI layer.

The minimum unit is one bounded control capability, not one natural-language instruction.

### Allowed v1

1. open the agents window for debug only
   command shape: `code.cmd --agents`
2. open a file at a precise location in the current window
   command shape: `code.cmd -r -g <file:line[:character]>`
3. open a diff view for two explicit files
   command shape: `code.cmd -r -d <left> <right>`
4. reuse the existing window when opening the current workspace, folder, or file target
   command shape: `code.cmd -r <path>`
5. wait on a user-reviewed editor target when the workflow explicitly needs human closure
   command shape: `code.cmd -w <path>`
6. launch a fresh bounded VS Code chat turn for the next approved objective
   command shape: `code.cmd chat -m agent -r [-a <file>]... <prompt>`

### Not Allowed in v1

- no arbitrary free-form prompt injection outside the bounded `code chat` handoff constructed from an approved objective and packet context
- no extension install or removal
- no MCP server mutation through `--add-mcp`
- no settings mutation through CLI-side effects
- no arbitrary shell delegation hidden behind a vague `open VS Code and do X` request

### Policy Layer Above the Allowlist

The allowlist only defines what Hermes may control in VS Code.
It does not decide whether Hermes should act.

That higher decision still follows the packet contract:

- if the request is ambiguous, Hermes recalls GPT
- if the request is strange but still within the last approved objective, Hermes checks packet state and supporting Obsidian context first
- if the request would widen scope, mutate policy, or introduce destructive changes, Hermes does not proceed autonomously

## Next Concrete Step

The next implementation slice should not start from free-form prompting.
It should start from a wrapper that exposes only the v0 allowlist above and logs each invocation against the active workstream packet.

Now that released-session auto-restart is proven, the optimization target also changes.
The system no longer needs more evidence that Hermes can cross the session boundary.
The system needs a cheaper and more reliable session-open bundle so GPT and Hermes spend less time reacquiring context.

## Post-Proof Optimization Priorities

### 1. Session-Open Bootstrap Compression

Each new GPT session should start from a minimal hot-state bundle instead of a broad document reread.

The first implementation of that bundle now exists in two local surfaces:

- `node scripts/run-openjarvis-goal-cycle.mjs --sessionOpenBundle=true`
- `GET /agent/runtime/openjarvis/session-open-bundle`

It is also exposed as an MCP tool for compact agent bootstrap:

- `automation.session_open_bundle`

That bundle should contain only:

- current objective and route mode
- latest workflow session status and step summary
- latest decision distillate
- latest route guidance for API-first vs MCP vs Hermes fallback
- the current autonomy rule, including whether release yields or auto-restarts
- operator personalization signals that materially affect routing or output style

The bundle and the raw goal-cycle status now also expose a `hermes_runtime` readiness block.
That block exists to prevent one recurring confusion: proving post-session continuity is not the same thing as proving that Hermes is already operating as a true persistent local operator.

The readiness block should answer, at session open, at least these questions:

- can Hermes continue after the GPT session exits
- is a live supervisor actually holding the loop open right now
- is approved next-objective promotion enabled
- does the active route still include Hermes as a local operator surface
- is IDE handoff only theoretical, or has it been observed recently

In other words, the runtime should no longer force the operator to infer from scattered launch, packet, and supervisor signals whether Hermes is still acting like a helper, a continuity sidecar, or a near-persistent local operator.

That readiness block is no longer tied only to the compact bundle.
The same Hermes runtime snapshot is now available directly through:

- `GET /agent/runtime/openjarvis/hermes-runtime`
- `automation.hermes_runtime`

The block also now carries structured `remediation_actions` alongside the human-readable `next_actions` list.
That split matters: `next_actions` still explain the maturity gap in operator language, while `remediation_actions` expose only the bounded one-click fixes that can safely reuse the current control surfaces.

The first remediation set stays intentionally small and reuse-heavy:

- `start-supervisor-loop` via the existing continuous goal-cycle supervisor path
- `open-progress-packet` via the existing Hermes VS Code bridge when a live progress packet exists
- `open-execution-board` via the same bridge when the next approved bounded objective still needs to be queued

Those remediations are exposed through:

- `POST /agent/runtime/openjarvis/hermes-runtime/remediate`
- `automation.hermes_runtime.remediate`

For visible local interaction, the same runtime state can now be reflected into an Obsidian chat/inbox note instead of a Discord-local control surface:

- `POST /agent/runtime/openjarvis/hermes-runtime/chat-note`
- `automation.hermes_runtime.chat_note`

For explicit GPT reactivation from the local IDE, Hermes no longer needs a full GUI-agent or Computer-Use layer as the default path. The narrow bridge can now queue the next bounded objective into the continuity packet and launch a fresh VS Code chat session through the native `code chat` CLI surface:

- `POST /agent/runtime/openjarvis/hermes-runtime/queue-objective`
- `automation.hermes_runtime.queue_objective`
- `POST /agent/runtime/openjarvis/hermes-runtime/chat-launch`
- `automation.hermes_runtime.chat_launch`
- Hermes VS Code bridge allowlist action: `chat`

That keeps the “bring GPT back” step explicit and bounded: Hermes may prepare the next approved objective, attach the continuity packet files as context, and start a fresh local chat session without pretending that an invisible persistent GPT process already exists.

The same bounded handoff can now be driven directly by the queue-aware supervisor loop when `autoLaunchQueuedChat=true`. The operator-facing entrypoint is `npm run openjarvis:autopilot:queue:chat`, which combines queued-objective promotion with the native VS Code chat launch path. When that handoff succeeds, the loop stops at `queued_chat_launched` instead of pretending the newly opened GPT turn has already completed.

For lower-level control or troubleshooting, Hermes also exposes the same bounded runtime actions through the thin helper CLI surface:

- `npm run openjarvis:hermes:runtime:queue-objective`
- `npm run openjarvis:hermes:runtime:chat-launch`

This keeps the runtime contract additive: diagnostics remain readable, and the executable remediations stay explicit, bounded, and inspectable without forcing the operator to fetch the full session-open bundle first.

The same operating policy should now be available as structured plan output, not only prose. `automation.optimizer.plan` should return an `assetDelegationMatrix` that tells Hermes and GPT which surface owns each class of work by default:

- Supabase = hot mutable workflow ledger
- Obsidian = durable semantic owner
- n8n = deterministic ingress, wait, retry, and router layer
- shared MCP on gcpCompute = teammate-consumable wrapped capability layer
- Hermes local = machine-local hands, IDE control, packet steering, and bounded mutation
- OpenJarvis local = bounded local reasoning and telemetry support under Hermes
- Skills and activation packs = bootstrap and route-shaping aids, not state owners
- GPT recall = explicit acceptance boundary only

That matrix exists to stop the same failure mode from recurring: rereading architecture prose while the real bottleneck is asset selection. In unattended mode, Hermes should consult the compact bundle and this delegation matrix first, then follow the cheapest valid owner rather than widening into free-form planning archaeology.

Advisor-style subordinate reconsultation is not the default optimization target at this stage.
The current priority is still compact bootstrap and hot-state reuse.
Advisor-style escalation should stay conditional, capped, and guidance-only after the compact bundle already exists, and deterministic API-first routes should not pay that extra hop by default.

### 2. Obsidian As Durable Meaning, Not Raw Transcript Storage

Obsidian should keep the durable semantic objects:

- decision notes
- requirement notes
- development slices
- progress and handoff packets
- operator preference notes

Supabase and runtime status should carry the hot mutable state.
Hermes runtime chat and handoff notes should therefore project compact decision distillates, recall boundaries, and artifact refs out of the hot-state plane into an operator-visible Obsidian surface, without turning the note itself into a second mutable source of truth.
GPT should not need to reread large planning files when the hot-state plane can supply the current delta first.

### 3. API-First And Agent-Fallback As A Runtime Default

For every bounded automation objective, the route contract should be explicit before work starts:

- deterministic API path first
- MCP wrapping layer second when existing APIs need normalization or standard tool shape
- Hermes local operator fallback third for bounded local execution
- GPT recall only when ambiguity, policy, or acceptance decisions cross the boundary

That contract now has explicit local planning surfaces too:

- `automation.route.preview` for the raw route recommendation
- `automation.optimizer.plan` for Autopilot-oriented route, cost, observability, public-lane guardrails, and shared scale-out planning
- `automation.workflow.draft` for a reusable n8n draft or update plan built from the existing starter workflow bundle when a deterministic route should become a real workflow

If a route remains deterministic and low-ambiguity, the system should prefer finishing from the compact bundle and existing route guidance rather than inserting an advisor-style subordinate consultation.
Advisor-style escalation becomes appropriate only when the cheaper executor reaches a real hard reasoning checkpoint that is still below the GPT recall boundary.

### 4. Operator Personalization As A First-Class Input

The system should stop treating personalization as a hidden chat-memory side effect.
Operator preferences should be distilled into explicit reusable signals that Hermes and GPT can both read at session open.

Minimum operator profile inputs:

- preferred visibility surfaces such as visible terminal launches
- Obsidian ownership rules and logging expectations
- routing preferences such as local-first vs remote escalation posture
- output safety and formatting expectations that affect downstream Discord or vault writes

### 5. Shared MCP And Skill Surface Reduction

The number of documents loaded at session start should fall over time.
That only happens if repeated cross-cutting decisions move into:

- shared MCP requirement or decision objects
- canonical service profiles
- smaller route-specific skill notes
- hot-state summaries rather than long compatibility prose

The active Autopilot workstream should also keep one stable handoff packet and one stable progress packet current in Obsidian, and those packets should be mirrored into the local vault path when available so the next GPT session can resume from packet state even if shared adapter auth is degraded.

Those packets and the visible goal-cycle status should prioritize local continuity truth: current objective, next safe action, wait boundary, escalation state, local n8n readiness, whether Hermes can resume without a live GPT session, and the current API-first versus MCP or Hermes fallback route guidance.

Remote leverage diagnostics may still be shown when explicitly requested, but they must not become the default loop target or silently keep the supervisor alive after a GPT boundary has been reached.

The launcher should expose both a one-shot packet resume mode and a bounded supervisor loop mode. The supervisor loop may remain alive after the visible monitor window closes, but it must refuse to auto-launch when the active progress packet says the system is waiting for the next GPT objective or another explicit escalation boundary.

When the active objective is explicitly marked for bounded automation continuation, released state is not automatically the final boundary. In that case Hermes may restart the next bounded cycle from the same objective without reopening a GPT session, and the packet plus status surfaces must show that restart rule explicitly instead of pretending the loop yielded to a human.

When explicit continuation is closed and the operator has enabled queue-driven autonomy, Hermes should not pretend that a new GPT prompt is the only valid next step. It may promote the next approved bounded objective from the Safe Autonomous Queue first and then from `docs/planning/EXECUTION_BOARD.md` `Queued Now`, but only while escalation remains `none` and the loop is not crossing a policy or approval boundary. That keeps autonomous next-goal selection explicit, operator-auditable, and still bounded by the same recall rules.

When the operator also enables `autoLaunchQueuedChat=true`, the queue-aware supervisor may use that selected next objective to seed a fresh VS Code chat turn through the same bounded bridge. That remains a relay step, not a claim that Hermes can observe or complete the new GPT reasoning session invisibly after launch.

## Next Cycle Plan

### Milestone 1

Close the ACP experiment as a successful transport validation, not as the final operating model.

Exit criteria:

- ACP is treated as optional debug tooling
- active packets no longer depend on ACP or a generic future prompt-injection bridge because native `code chat` already exists as the bounded reactivation surface

### Milestone 2

Define the minimal Hermes sidecar contract for between-session work.

Scope:

- allowed read-only and low-risk write actions
- packet update rules
- explicit recall triggers back to GPT

Exit criteria:

- Hermes can continue bounded work without new user prompting
- the next GPT session can resume entirely from packet state

### Milestone 4

Design a narrow VS Code CLI bridge for Hermes.

Scope:

- allowlisted commands only
- editor control, packet steering, and native `code chat` launch only
- no attempt to simulate a hidden persistent GPT session or broad desktop automation

Exit criteria:

- Hermes can trigger the small editor actions it actually needs
- Hermes can relaunch a fresh VS Code chat session with a queued bounded objective plus packet context
- the bridge does not create a second user-facing runtime burden

## Risks

### Risk: the personal Hermes sidecar lane and public Muel user lane collapse into one shared workflow bucket

Mitigation:

- shared n8n and shared Supabase are acceptable, but shared workstream rows without a lane boundary are not
- keep the current GPT plus Hermes continuity path in an explicit operator lane
- require public Muel traffic to remain guild-scoped and reach the operator lane only through explicit escalation or handoff rules

### Risk: the design still hides a second chat surface

Mitigation:

- keep this document explicitly labeled as a compatibility mode rather than the target state
- do not require the user to manually duplicate intent across GPT and Hermes just to keep continuity alive
- reject any daily workflow that asks the user to choose between GPT and Hermes

### Risk: Hermes exceeds the last approved objective

Mitigation:

- keep autonomy queue explicit
- force recall on ambiguity, architecture, policy, auth, destructive actions, or reprioritization

### Risk: VS Code CLI is overused as a fake reasoning bridge

Mitigation:

- treat CLI as control plane only
- keep reasoning and acceptance decisions inside GPT sessions

## Cycle Closure For The Current Slice

This cycle is closed when all of the following are true:

- the compatibility user-facing loop is still single-ingress through GPT, while the target-state authority has already moved to the dual-agent plan
- ACP is demoted to debug-only status
- the active handoff packet records the new operating decision
- the active progress packet points to the next cycle as CLI-bridge and sidecar rollout work
- packet state and status output expose whether Hermes can continue meaningful local work, whether local n8n is ready to orchestrate waits and webhooks, and whether the loop cleanly stops at the next GPT or human boundary unless an explicit override was requested
