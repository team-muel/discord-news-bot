# Muel Super Agent Product Packaging

Status: Strategy/reference baseline (2026-04-18)

Role:

- Define how Muel should be packaged as a super agent at the product layer.
- Connect the higher-order Muel vision to the existing repository super-agent facade and service bundle substrate.
- Prevent the project from drifting into two bad interpretations:
  - a loose tool zoo with one mascot pasted on top
  - a vague AGI-style promise that ignores bounded service design

What this document is not:

- not a new execution engine design
- not a replacement for the current execution board
- not proof that the public super-agent UX is already implemented
- not the owner-only personalized orchestration contract

## Why This Exists

The repository already has a structured super-agent facade.

It also already has:

- named service bundles
- recommendation and session start routes
- operator-facing packaging under `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`

What was missing was the product-layer statement that says:

Muel itself should be presented as a super agent, and that public packaging should be one of the main user-facing expressions of the Muel vision.

## Relationship To Other Documents

- `MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md` explains why Muel exists and what long-term system it should grow into.
- `OWNER_PERSONALIZED_AGENT_ORCHESTRATION.md` explains the stronger owner-only orchestration tier that should sit beside, not inside, the public product promise.
- `MUEL_IDOL_SERVICE_SPINE.md` explains the short-term public identity and service spine around Muel.
- `UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md` explains the current repository execution roadmap.
- `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md` explains the current operator-facing service bundle packaging over `/api/bot/agent/super/services/*`.
- `docs/front-uiux-handoff/MUEL_SUPER_AGENT_PRODUCT_EXPERIENCE.md` is the companion product-experience handoff artifact derived from this strategy.

This document answers a narrower question than the higher-order vision doc:

how should the broader Muel system be packaged and understood as a super agent product.

## What Super Agent Means In This Repository

In this repository, super agent should mean:

- one public-facing Muel identity
- one primary interaction surface
- many bounded service families behind that surface
- explicit recommendation, routing, and next-step behavior
- visible trust, account, and state boundaries

It does not mean:

- an unrestricted AGI claim
- every tool being exposed directly to users
- raw internal agent-role labels being shown as the product
- a hidden operator control plane being passed off as a polished public experience

## Boundary Against The Owner Tier

This document is about the public-facing Muel super-agent tier.

It should not be misread as the whole owner experience.

For the primary owner user, the system should be stronger and more explicit about orchestration.

That owner tier may legitimately expose:

- compute-lane routing
- GUI-lane routing
- delegated worker status
- richer operational diagnostics
- explicit OpenJarvis, Hermes, and other tool-lane coordination

Public Muel should not expose that full control topology directly.

That boundary is what keeps the public product coherent instead of turning it into an operator console.

## Core Packaging Statement

Muel should be packaged as a super agent that helps users move across multiple kinds of work through one consistent public interface.

The user should experience:

- one agent
- one recognizable face
- one memory anchor
- one trust model
- several clearly framed jobs

The user should not experience:

- many unrelated commands with thin branding
- unclear capability boundaries
- internal orchestration jargon
- a capability list that reads like infrastructure leakage

## Product Promise

The product promise of the Muel super agent should be something close to this:

Muel is the one agent that helps you navigate conversation, support, relationship memory, content, and service tasks through a single public-facing experience.

That promise is intentionally broader than a chatbot and narrower than a universal assistant.

## Packaging Layers

### 1. Identity Layer

This is the Muel face.

It carries:

- name
- tone
- trust posture
- continuity of memory and relationship
- public-facing service identity

### 2. Service Layer

This is the visible job catalog.

At the product level, users should see service families such as:

- conversation and guidance
- support and diagnostics
- memory and relationship continuity
- content and campaign help
- trust and status explanation

These are product-facing families, not a literal mirror of internal bundle IDs.

### 3. Routing Layer

This is where the super-agent promise becomes real.

The system should:

- infer what job the user is trying to accomplish
- recommend the right bounded service lane
- make the next step explicit
- carry forward enough context to avoid restating everything every turn

### 4. Session And Artifact Layer

The super agent should not only answer.

It should return shaped outcomes such as:

- summary
- next action
- required login or permission state
- follow-up artifact
- visible boundary when escalation or approval is needed

### 5. Trust Layer

The product must make these boundaries legible:

- what Muel knows
- what Muel can do now
- when login is required
- when support certainty is limited
- when the system is recommending rather than executing

## Current Repository Substrate That Already Supports This

The current repo already has real super-agent substrate.

### Structured Facade

- `src/services/superAgentService.ts`
- `/api/bot/agent/super/capabilities`
- `/api/bot/agent/super/recommend`
- `/api/bot/agent/super/sessions`

### Service Bundle Packaging

- `/api/bot/agent/super/services`
- `/api/bot/agent/super/services/:serviceId`
- `/api/bot/agent/super/services/:serviceId/recommend`
- `/api/bot/agent/super/services/:serviceId/sessions`
- `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`

### Muel Public Identity Substrate

- `MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md`
- `MUEL_IDOL_SERVICE_SPINE.md`
- Discord, CRM, auth, and trust surfaces already mapped there

This means the super-agent packaging problem is not a blank slate.

It is mainly a product-layer consolidation and presentation problem.

## Product Design Consequence

The public product should not expose the raw structure exactly as operators see it.

Internal packaging today is:

- workflow copilot
- backlog router
- knowledge distiller
- local hands runner
- weekly reporter

Those are useful operator bundles.

But public-facing Muel packaging should translate internal bundle logic into user-facing jobs.

Example translation:

- internal routing and recommendation -> "Muel helps you find the right lane"
- internal support and runtime checks -> "Muel helps diagnose and guide"
- internal knowledge distillation -> "Muel helps remember, summarize, and carry context forward"
- internal action and task execution -> "Muel helps you move from question to next action"

## Public-Facing Super Agent Rules

1. One front door
   - users should feel they are entering one Muel system, not browsing disconnected admin panels

2. Capability cards, not tool lists
   - present what Muel helps with, not raw implementation surfaces

3. Recommendation before over-commitment
   - when the task is ambiguous, the system should recommend the best lane rather than pretending perfect certainty

4. Explicit next-step objects
   - every meaningful interaction should resolve to a next action, artifact, or clearly bounded fallback

5. Trust is visible
   - login state, support boundary, and uncertainty should be legible in the experience

6. Do not leak internal role jargon
   - labels like `Implement`, `Architect`, `Review`, `Operate`, or bundle IDs should stay internal unless intentionally translated

## Product Gaps Still Open

The packaging substrate exists, but the public product layer is not yet closed.

Key gaps:

- current super-agent routes are operator/admin-oriented, not yet a public-safe front door
- existing frontend handoff kit does not yet describe a Muel super-agent UX
- current API client does not yet expose a user-facing super-agent surface
- product copy and surface taxonomy for public Muel jobs are not yet formalized

These are not reasons to avoid the super-agent framing.

They are the reasons to write it down now.

## Sequencing Intent

The build order should be:

1. public-ready dense communication
2. Muel service spine consolidation
3. super-agent product packaging
4. account-linked and memory-aware journeys
5. idol and campaign surface expansion

The super-agent package is therefore not a side idea.

It is one of the main ways the Muel service spine becomes legible to users.

## Definition Of Done For This Document

This document is doing its job if future contributors can answer all of the following without reconstructing chat history:

- why Muel should be packaged as a super agent
- how that differs from the current operator-only service bundles
- what existing repo substrate already supports the packaging
- what UX artifact should exist next
- what must not be exposed directly to users
