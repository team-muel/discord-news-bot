# Owner Personalized Agent Orchestration

Status: Strategy/reference baseline (2026-04-18)

Role:

- Define how the system should treat the primary owner user differently from an unspecified public user.
- Explain why the public-facing Muel super-agent product and the owner-only orchestration experience must not be collapsed into one layer.
- Connect Muel strategy documents with the existing GPT/Hermes dual-agent, personal operating-system, and local-plus-remote execution substrate.

What this document is not:

- not a public product handoff
- not a claim that every owner-only lane is already fully implemented
- not permission to bypass approval, policy, or architecture boundaries

## Why This Exists

The repository already had two kinds of material:

- public-facing Muel strategy and product packaging
- owner/operator runtime, continuity, and orchestration documents

What was still missing was one canonical statement that says:

the primary owner user should receive a much stronger, much more personalized agent experience than the public Muel product surface.

In practical terms, that means the owner-facing experience should be closer to a Claude-Coworks-like orchestration assistant than to a bounded public chatbot.

That does not mean copying another product literally.

It means this repository should treat the owner experience as:

- proactive
- personalized
- multi-agent
- tool-orchestrating
- delegation-capable
- local-plus-remote

## Relationship To Other Documents

- `MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md` explains the overall vision and why the system exists.
- `MUEL_SUPER_AGENT_PRODUCT_PACKAGING.md` explains how Muel should be packaged for public-facing users.
- `MUEL_IDOL_SERVICE_SPINE.md` explains the short-term Muel identity and service-spine sequencing.
- `GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md` explains the target dual-assistant operating model for GPT and Hermes.
- `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md` explains the current operator-facing service bundle packaging.

This document answers a narrower question than the vision doc and a different question than the public packaging doc:

what kind of personalized orchestration experience the primary owner user should receive from this system.

## Core Claim

The system should intentionally provide two different experience tiers.

### 1. Public Muel Tier

For unspecified public users, Muel should be:

- one bounded super agent
- one public-facing identity
- one trust-visible product surface
- several clearly framed service families

### 2. Owner Personalized Tier

For the primary owner user, the system should be much stronger.

It should behave like a personalized operating partner that can actively coordinate:

- GPT for high-ambiguity reasoning and acceptance decisions
- Hermes for persistent local execution and continuity
- OpenJarvis for orchestration, telemetry, memory projection, and learning support
- OpenClaw when a delegated specialist or alternate interactive lane is useful
- Compute Agent lanes for remote-heavy or always-on execution
- GUI Agent lanes for browser, desktop, screenshot, and human-visible evidence work
- local or remote automation glue such as n8n when waits, retries, schedules, or webhooks are the cheapest route

The point is not that the public gets a weak product.

The point is that the owner needs a creation and operations cockpit, not only a public product demo.

## What This Means In Practice

When the owner asks for something, the system should not behave like a single isolated chat endpoint.

It should instead try to provide:

- one request surface from the user's point of view
- internal routing across the best available agent or tool lane
- proactive delegation of bounded subtasks
- preservation of the user's preferences, recurring goals, and active context
- visible artifact and status return rather than hidden background churn

The owner should not have to manually decide, turn by turn, whether to use Hermes, OpenJarvis, OpenClaw, a workstation lane, or a remote compute lane.

That routing burden belongs to the system.

## Required Experience Properties

### 1. Personalization Is Mandatory

The owner lane must adapt to the user's known preferences and operating habits.

That includes:

- preferred ingress and collaboration surfaces
- local-first execution bias when it is viable
- visible terminal or evidence expectations when interactive work matters
- durable strategic direction already captured in Obsidian, repo docs, and memory

The system should remember enough to reduce repeated instruction overhead without pretending to know things it has not verified.

### 2. Delegation Must Be Active, Not Decorative

The owner-facing system should be willing to outsource or delegate bounded work.

That can mean:

- delegating to a subagent
- dispatching to a remote worker
- using Hermes as the local hands layer
- using a GUI lane for browser or desktop manipulation
- using a compute lane for long-running or heavy tasks
- using OpenJarvis or OpenClaw as supporting agent surfaces when they are the best fit

The owner should receive a compact explanation of:

- what lane was chosen
- what artifact is expected back
- what recall condition will stop automatic continuation

### 3. Compute Agent Must Be First-Class

Compute Agent is not an optional flourish.

It is the lane for:

- remote-heavy execution
- long-running tasks
- deployment-adjacent work
- workerized or always-on tasks
- tasks whose cost or duration should not stay on the workstation hot path

In current repository terms, this maps to the remote-heavy execution and GCP worker surfaces rather than to a separate semantic owner.

### 4. GUI Agent Must Be First-Class

GUI Agent is also not a flourish.

It is the lane for:

- browser flows
- desktop interaction
- screenshot or visual proof gathering
- UI verification
- human-visible step completion when a pure API or CLI path is insufficient

In current repository terms, this maps to the workstation executor lane rather than to a new product surface.

### 5. Continuity Must Survive Session Boundaries

The owner experience should not reset every time a high-reasoning GPT session ends.

That is why Hermes, queue-aware continuity, shared hot-state, and Obsidian distillation matter.

The system should preserve:

- current objective
- active lane
- evidence refs
- next bounded objective
- recall reason when automatic work must stop

### 6. Trust Boundaries Still Apply

The owner lane can be stronger than the public product while still remaining bounded.

The system must still surface when:

- approval is required
- policy boundary is crossed
- ambiguity is too high for autonomous continuation
- a lane is degraded or unavailable

Owner personalization is not an excuse for silent overreach.

## Surface Role Map For The Owner Lane

### GPT

- strongest episodic reasoning surface
- ambiguity resolution
- tradeoff decisions
- acceptance decisions

### Hermes

- persistent local operator
- editor, shell, git, and workstation continuity
- between-session execution and recall preparation

### OpenJarvis

- orchestration support
- telemetry, memory projection, evaluation, and learning-loop support
- route acceleration when the OpenJarvis lane is the cheapest valid operator surface

### OpenClaw

- optional alternate interactive or delegated specialist lane
- useful when a separate agent surface or channel bridge is the best fit
- not the semantic owner and not the default public ingress owner by itself

### Compute Agent

- remote-heavy execution lane
- long-running, always-on, or workerized tasks
- remote-capable bounded jobs

### GUI Agent

- browser and desktop execution lane
- screenshot and UI-proof lane
- visual or interactive tasks that should not be forced into pure shell automation

### n8n And Similar Glue

- waits
- schedules
- retries
- webhook glue
- deterministic routing before agent fallback

## Separation From Public Muel Packaging

The public super-agent and the owner-oriented orchestration layer should support each other without collapsing into each other.

Public Muel should expose:

- one trust-visible product face
- bounded service families
- user-safe recommendation and next-step behavior

Owner orchestration may expose:

- internal lane choice
- compute and workstation routing
- delegated worker status
- richer operational diagnostics
- explicit control-plane boundaries

Public users should not see the full owner control topology.

The owner should.

## Current Repository Substrate That Already Supports This

This is not a blank-slate wish list.

The repo already contains major pieces of the owner lane:

- `GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`
- queue-aware future session synthesis in `scripts/local-ai-stack-control.mjs`
- owner-facing bundle packaging in `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`
- local-plus-remote profiles such as `config/env/local-first-hybrid.profile.env` and `config/env/local-nemoclaw-max-delegation.profile.env`
- super-agent and role-routing substrate in `src/services/superAgentService.ts` and `src/services/skills/actions/agentCollabOrchestrator.ts`
- automation surface mapping in `src/services/automation/apiFirstAgentFallbackService.ts`

What was missing was the explicit owner-experience statement that ties them together.

## Strategic Consequence

This repository is therefore carrying two strategic responsibilities at once.

1. Build Muel into a public-facing super-agent product that is credible to unspecified users.
2. Build the owner lane into a personalized orchestration cockpit that can actively coordinate tools, agents, compute, GUI work, and delegated execution on behalf of the primary user.

These are different jobs.

They should share substrate where possible, but they should not be described as if they were the same UX promise.

## Near-Term Implications

If future contributors translate this document correctly, they should bias toward these slices:

1. unify owner requests behind one orchestration entry contract
2. make compute-lane and GUI-lane routing legible in owner-visible artifacts
3. preserve user-specific memory and preference signals in routing
4. keep delegated work visible through summaries, evidence refs, and recall boundaries
5. avoid pushing owner-only control-plane detail into the public Muel surface

## Definition Of Done For This Document

This document is doing its job if future contributors can answer all of the following without reconstructing chat history:

- why the owner experience must be stronger than the public Muel product
- what “personalized orchestration” actually means in this repository
- how Compute Agent and GUI Agent fit the owner lane
- how OpenJarvis, Hermes, and OpenClaw should be used without collapsing ownership boundaries
- why public Muel packaging and owner-only orchestration must stay related but distinct
