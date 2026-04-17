# Muel Idol Service Spine

Status: Reference/strategy baseline (2026-04-18)

Role:

- This document inherits the higher-order product vision and design intent from `MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md`.
- Define the short-term operating model where Muel becomes the public-facing idol IP and service spine for near-term products.
- Keep the current repository grounded as an access, control, CRM, and automation substrate rather than pretending it is already a full entertainment company stack.
- Provide a bridge between the current Discord-first operating surfaces and the longer-term IP foundry direction.

Execution rule:

- This document is not an active execution board.
- Day-to-day priority remains in `EXECUTION_BOARD.md`.
- Runtime truth remains in `docs/ARCHITECTURE_INDEX.md`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, and operator-visible runtime endpoints.

## Objective

Make Muel the common public identity across near-term services so that:

1. every user-facing surface has one recognizable face, tone, and memory anchor
2. Discord, web, CRM, and support do not feel like unrelated tools
3. short-term service delivery compounds into long-term IP, narrative, goods, and brand assets
4. the same operating pattern can later expand beyond ACG into other domain businesses

This is a short-term spine, not the final company shape.

## Immediate Gate Before Further Implementation

The most immediate question is not whether Muel already qualifies as a virtual idol.

The immediate question is whether Muel can already act as a publicly presentable agent for unspecified users.

That means the next implementation wave should stay blocked until Muel can sustain dense, high-signal communication without reading like:

- a shallow bot shell
- a collection of unrelated utility commands
- a risky support surface that sounds confident without operational grounding

Short version:

before building the next visible layer, Muel must first become an agent that can be shown openly without embarrassment.

## What Dense Communication Means Here

Dense communication does not mean long answers.

It means Muel can reliably do the following in one interaction loop:

1. understand what the user is actually trying to get done
2. keep context across follow-up turns without collapsing into generic filler
3. respond with enough specificity that the user can immediately act
4. preserve tone and role boundaries across support, community, and trust contexts
5. avoid hallucinated confidence, vague sentiment, or pretty-but-empty copy

For this repository, dense communication is the first real product test.

If Muel cannot communicate densely, then:

- CRM depth will not compound
- support automation will feel unsafe
- community posting will feel synthetic
- account-linked services will not feel trustworthy
- future idol surfaces will only magnify the weakness

## Phase 0 Objective

Before Phase 1 canon lock expands outward, Phase 0 must prove that Muel already works as a serious public-facing agent.

Phase 0 objective:

- make Muel trustworthy enough in live conversation that a new user can immediately understand, rely on, and continue interacting with the agent without special prompting discipline

This is the gateway to every later layer in this document.

## Phase 0 Non-Goals

- shipping a flashy virtual-idol demo before conversation quality is stable
- optimizing for style, lore, or visual presence ahead of operational communication quality
- expanding the surface area of commands faster than the underlying interaction quality improves
- treating a successful single curated demo as proof of public readiness

## Non-Goals

- claiming that the current repository already contains a complete virtual idol production stack
- treating Discord bot copy as the final character canon
- replacing the canonical roadmap or current execution-board priorities in the same change window
- forcing every future business line to present as entertainment-first even when Muel remains the umbrella face
- collapsing internal operator control lanes into the same persona contract as the public-facing idol layer

## Why Muel First

Short-term idol centralization solves a real systems problem, not just a branding preference.

- one face reduces channel fragmentation across Discord, web, CS, CRM, and community content
- one persona creates a reusable narrative shell for support, announcements, campaigns, and later merchandise
- one memory anchor lets relationship data, user notes, quality signals, and campaign history accumulate around the same identity
- one public character lowers the cost of turning operational output into reusable IP assets

In practical terms, Muel should evolve in this order:

1. bot name
2. community mascot
3. service persona
4. virtual idol surface
5. narrative and merchandise anchor
6. portfolio gateway into a broader IP foundry

## Current Leverage Already Present In This Repository

The repository already provides several pieces of the service spine.

### 1. Persona And Identity Surfaces

- Discord ingress already centers requests around `Muel` naming and transport seams.
- Persona and personalization surfaces exist through user profile and runtime personalization flows.
- The repo can already distinguish public-facing response behavior from internal control surfaces.

Current concrete anchors:

- `src/discord/runtime/commandRouter.ts`
- `src/discord/commands/persona.ts`
- `src/services/agent/agentPersonalizationService.ts`
- `src/services/userPersonaService.ts`

### 2. Community And CRM Substrate

- Activity, reactions, and command usage are already tracked.
- CRM read surfaces and leaderboard views already exist.
- Relationship and persona notes already give Muel a basis for fan memory and differentiated follow-up.

Current concrete anchors:

- `src/services/discord-support/userCrmService.ts`
- `src/routes/bot-agent/crmRoutes.ts`
- `src/services/communityGraphService.ts`

### 3. Account And Identity Substrate

- Discord login and callback flows already exist.
- Session persistence already provides the seed for account-linked offerings and service entitlements.

Current concrete anchors:

- `src/routes/auth.ts`
- `src/services/discord-support/discordLoginSessionStore.ts`
- `src/app.ts`

### 4. Content And Publishing Substrate

- Automation and subscription flows already exist for news, YouTube videos, and YouTube posts.
- The repo already has an API-first then agent-fallback pattern for downstream publishing and handoff.

Current concrete anchors:

- `src/services/automationBot.ts`
- `src/discord/commands/subscribe.ts`
- `src/services/automation/apiFirstAgentFallbackService.ts`

### 5. Quality, Trust, And Operations Substrate

- Health, readiness, unattended-health, scheduler-policy, and go/no-go surfaces already exist.
- This allows Muel to become not only a mascot, but also the visible face of service trust.

Current concrete anchors:

- `src/routes/health.ts`
- `src/contracts/bot.ts`
- `docs/RUNBOOK_MUEL_PLATFORM.md`
- `docs/planning/BETA_GO_NO_GO_CHECKLIST.md`

## Service Spine Model

Short-term, Muel should be treated as one public IP with multiple operating modes.

### Public Modes

1. Community mascot
   - greeting, lightweight interaction, event presence, community rituals

2. Idol and performer
   - streams, clips, scripted appearances, campaigns, seasonal events

3. Support and concierge
   - onboarding, account help, diagnostics, service navigation, FAQ-style guidance

4. Community editor and publisher
   - posts, recaps, updates, announcements, release notes, campaign copy

5. CRM anchor
   - remembered users, segments, leaderboards, reactivation prompts, member journeys

6. Trust and quality face
   - status explanation, transparency updates, incident or service-quality messaging

### Internal Modes

1. Canon keeper
   - maintain the character bible, voice rules, and brand boundaries

2. Campaign operator
   - manage schedules, assets, review queues, and approval gates

3. Data and quality observer
   - monitor CRM, response quality, support load, and community health

These modes must share one identity but not one tone.

## Ownership Model

This service spine only works if ownership stays explicit.

### Obsidian

Owns:

- Muel character bible
- canon, lore, tone rules, narrative arcs, campaign intent
- long-lived brand and IP decisions

Must not own:

- fast-changing campaign execution state
- CRM counters
- ephemeral support sessions

### Supabase And Workflow State

Owns:

- CRM activity
- account-link state
- campaign hot state
- content task status
- support and quality ledgers

Must not own:

- final semantic canon for who Muel is

### Discord And Web

Own:

- acquisition and access surfaces
- public interaction channels
- account-linked entrypoints
- public-facing service experience

Must not own:

- the character canon
- the underlying operational truth

### This Repository

Owns:

- public ingress orchestration
- support and CRM automation
- community posting flows
- identity and account-linking scaffolding
- service quality surfaces

Must not claim to own yet:

- full VTuber runtime
- full asset pipeline
- editing suite automation
- commerce backend beyond early scaffolding

### External Operator Tooling

Owns the performer lane until integrated explicitly:

- OBS scenes
- avatar rig runtime
- voice pipeline
- clip editing tools
- livestream operator controls

This is adjacent to the repo, not yet native to it.

## Short-Term Architecture Consequence

The key design shift is this:

Muel should no longer be treated as just the assistant name for many unrelated tools.
Muel should be treated as the single public-facing interface layer over multiple service functions.

That means every new near-term feature should answer two questions before implementation:

1. which Muel mode does this belong to
2. does this create durable IP value, operational value, or both

If a feature does neither, it is probably outside the short-term spine.

## 90-Day Rollout Shape

### Phase 0. Public-Ready Dense-Communication Gate

Goal:

- prove that Muel can be shown to unspecified users as a serious public-facing agent before wider idol and service expansion

Needed outputs:

- public-facing conversation quality rubric
- mode-specific response rules for `community`, `support`, and `trust`
- scenario pack for unscripted multi-turn evaluation
- transcript review loop for failures, confusion, and empty answers
- explicit exit threshold tying communication quality to next implementation permission

Acceptance criteria:

1. Muel can sustain multi-turn conversations that stay context-aware, specific, and operationally useful across community, support, and trust scenarios.
2. Replies consistently produce concrete next actions, not generic encouragement or decorative prose.
3. Public-facing answers do not leak internal jargon, hidden architecture, or unsafe confidence about unsupported capabilities.
4. The support path feels dependable enough that account-link and service-diagnostic flows do not degrade user trust.
5. Evaluated transcripts show that Muel can handle ambiguity, ask clarifying questions when needed, and still keep momentum.

Suggested evaluation dimensions:

- context retention
- answer specificity
- operational grounding
- role and tone consistency
- safe uncertainty handling
- next-action usefulness

Exit criteria:

- the team can honestly show Muel to new users as an agent in its own right, not just as a hidden operator tool or mascot shell
- Phase 1 through Phase 5 remain blocked until this gate is explicitly considered passed

### Phase 1. Canon Lock

Goal:

- define who Muel is before multiplying surfaces

Needed outputs:

- character bible
- voice and tone guide
- allowed public modes and forbidden tone collisions
- minimal visual direction for idol, mascot, and support appearances

Exit criteria:

- Discord replies, web copy, and CRM-facing language can all be checked against one canon source

### Phase 2. Service Spine Unification

Goal:

- make current services feel like one Muel experience

Needed outputs:

- map Discord commands, CRM views, auth flows, and service updates to explicit Muel modes
- unify response presentation where public-facing behavior is visible
- add campaign or service tags that distinguish community, support, idol, and trust outputs

Exit criteria:

- public-facing features stop reading like separate tools owned by different invisible teams

### Phase 3. Content And Campaign Loop

Goal:

- convert operational surfaces into repeatable idol-facing content output

Needed outputs:

- scheduled announcement loop
- community post and recap loop
- CRM segment driven campaign prompts
- event and release calendar around Muel

Exit criteria:

- at least one recurring content cadence exists that reuses the same Muel identity across Discord and web-facing surfaces

### Phase 4. Virtual Idol Pilot

Goal:

- add a bounded performer surface without pretending to automate the entire studio

Needed outputs:

- OBS scene checklist
- asset pack and script pack for one recurring appearance format
- operator-mediated publishing workflow for clips or event summaries

Exit criteria:

- one bounded Muel appearance loop can be executed repeatedly with clear preparation, runtime, and closeout artifacts

### Phase 5. Early IP Monetization Spine

Goal:

- prepare the bridge from community service persona to monetizable IP

Needed outputs:

- account-linked member journey
- campaign and offer taxonomy
- early goods, digital perks, or membership concept map
- trust and QA rules for public monetization claims

Exit criteria:

- the system can describe how a user moves from fan or community member to account-linked customer without changing the public identity layer

## Immediate Build Priorities For This Repo

The next bounded implementation slices should favor leverage, not spectacle.

1. Public-ready conversation gate
   - define and measure the threshold for dense communication before wider outward expansion

2. Canon source registration
   - create a canonical Muel service-spine note and keep it promotable to shared Obsidian

3. Mode taxonomy
   - distinguish `idol`, `community`, `support`, `campaign`, and `trust` modes at the planning and prompt-contract level before wider feature work

4. CRM to campaign bridge
   - treat CRM and community signals as future campaign inputs, not only dashboards

5. Account-linked service journey
   - use existing Discord OAuth and login surfaces as the first identity rail for membership or service entitlements

6. Content operations bridge
   - treat subscription, news, and post automation as the seed of Muel content operations rather than as isolated utilities

7. Performer lane boundary
   - keep OBS and editing tools as explicit external hands-layer surfaces until the repo has a clear contract for them

## Public-Ready Agent Gate Mapping To Existing Repo Surfaces

This gate should be closed using current repo assets rather than postponed until a later stack exists.

### Conversation Quality Inputs

- Discord command and prefixed chat ingress
- persona and personalization surfaces
- runtime routing and response behavior

### Trust Inputs

- health and status surfaces
- go/no-go and quality gate evidence
- approval and safety enforcement already present in the repo

### Support Inputs

- login and account-link flows
- diagnostics and support-style command interactions
- CRM and memory-backed user context

### Review Artifacts

- transcript set covering ambiguous, support-heavy, and community-heavy prompts
- failure taxonomy for vague, unsafe, off-tone, or empty answers
- evidence that Muel can recover from uncertainty without losing usefulness

## Guardrails

### One Character, Multiple Contracts

Muel can be one character with multiple modes, but the system must not blur these boundaries:

- idol fantasy
- support accuracy
- operational truth
- monetization claims

### Approval Boundaries

Human approval should remain mandatory for:

- public promises involving money, perks, orders, or fulfillment
- incident messaging during degraded service
- sensitive support cases involving account state or private user data
- major canon changes that alter Muel's identity or brand posture

### Performer Lane Safety

Do not treat a future OBS integration as proof that the repo should own autonomous live performance.

The first pilot should be operator-mediated and artifact-driven:

- script
- scene checklist
- content package
- post-event closeout

## KPI Direction

Short-term measurement should move beyond raw bot usage.

Track at least:

- community retention around Muel-centric loops
- post or campaign engagement rate
- support deflection with acceptable quality
- account-link conversion rate
- CRM reactivation rate
- content reuse rate across channels
- prep time for one repeatable Muel appearance or campaign cycle

## Relationship To The Longer-Term Company Direction

This document is the short-term bridge to a broader IP foundry model.

If stable, the pattern becomes:

- world -> character -> service -> campaign -> product -> brand -> portfolio

At that point, Muel stops being just the mascot of one service and becomes the first operational proof that the company can turn an original character into a reusable business surface.

That is the real reason to do this now.
