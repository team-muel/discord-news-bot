# Muel Super Agent Product Experience

Purpose:

- Translate the Muel super-agent packaging strategy into product experience design guidance.
- Give frontend and product work one concrete artifact that explains what the public-facing Muel super agent should feel like.

Scope:

- public-facing product experience only
- not admin console IA
- not a raw API inventory
- not the owner-only orchestration cockpit

Source strategy:

- `docs/planning/MUEL_SUPER_AGENT_PRODUCT_PACKAGING.md`
- `docs/planning/MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md`
- `docs/planning/MUEL_IDOL_SERVICE_SPINE.md`
- `docs/planning/OWNER_PERSONALIZED_AGENT_ORCHESTRATION.md` for the explicit boundary between public product UX and owner-only orchestration UX

## Product Promise

Muel should feel like one super agent that helps the user move through conversation, support, memory, and service tasks from one place.

The product promise is:

- one agent
- one face
- one conversation surface
- multiple clearly framed jobs
- visible trust boundaries

## Experience Principles

1. One entrypoint
   - users should not have to choose between many disconnected product surfaces before they even start

2. Capability-first framing
   - show what Muel helps with, not how the backend is wired

3. Recommendation before commitment
   - when user intent is ambiguous, Muel should recommend the right lane rather than pretending certainty

4. Memory should reduce friction, not increase mystery
   - remembered context must feel helpful and bounded

5. Trust must always be visible
   - login state, system status, and uncertainty boundaries should be easy to find

6. Next-step clarity
   - every meaningful response should leave the user knowing what happens next

## Primary Surface Map

### 1. Super Agent Home

Purpose:

- introduce Muel as the single public-facing super agent
- show the main job families
- make login and trust state immediately visible

Recommended modules:

- Muel intro / promise block
- service family cards
- recent context or returning-user module
- trust and status strip
- primary conversation entry

### 2. Conversation Workspace

Purpose:

- keep one main interaction surface while allowing the system to steer the user into the right lane

Recommended modules:

- main conversation thread
- intent suggestion chips
- current task mode or lane badge
- next-step card
- generated artifact panel
- escalation or login requirement notice when relevant

### 3. Service Family Cards

Suggested public-facing families:

- Ask Muel
- Get Support
- Continue Context
- Plan Or Organize Work
- Check Trust Or Status

These should map to internal surfaces without exposing internal bundle names directly.

### 4. Trust And Status Surface

Must show:

- whether the user is signed in
- whether a task requires login
- whether Muel is answering, recommending, or awaiting an approval boundary
- whether platform status or degraded state affects the answer

### 5. Account And Relationship Surface

Purpose:

- make account-linked continuity feel like a strength, not a hidden dependency

Must clarify:

- what is remembered
- why it helps
- what requires sign-in
- what stays unavailable without login

## Conversation Output Shape

The public super-agent experience should prefer outputs that contain:

- short summary
- answer or recommendation
- one explicit next action
- boundary notice when needed

Avoid outputs that feel like:

- decorative prose without action
- hidden router behavior with no explanation
- raw operator diagnostics pasted into the user surface
- infrastructure jargon

## Copy Rules

Use language that says:

- what Muel can help with now
- what Muel recommends next
- when Muel needs login, confirmation, or more detail

Avoid language that implies:

- unlimited omniscience
- universal autonomy
- hidden execution guarantees the system does not yet own

## Current API Surfaces Relevant To This UX

Already relevant:

- `GET /health`
- `GET /api/status`
- `GET /api/auth/me`
- `GET /api/bot/status`
- `GET /api/bot/agent/super/services`
- `GET /api/bot/agent/super/services/:serviceId`
- `POST /api/bot/agent/super/services/:serviceId/recommend`
- `POST /api/bot/agent/super/services/:serviceId/sessions`

Important current limitation:

- the super-agent service routes are currently admin-oriented.
- a public product surface will need a safe public wrapper, translated facade, or explicitly approved exposure path.

## Immediate UX Artifact Gaps

1. No public super-agent landing narrative yet
2. No user-facing service family taxonomy yet
3. No translated public-safe wrapper over the current admin-oriented super-agent bundle routes yet
4. No frontend client helpers for super-agent routes yet
5. No canonical trust/status strip spec for the Muel super-agent surface yet

## Handoff Guidance

If the frontend repo picks this up, start with these artifacts in order:

1. Muel super-agent home screen wireframe
2. service family card taxonomy
3. conversation workspace states
4. trust/status strip spec
5. public-safe route contract proposal for super-agent packaging

## Success Condition

This handoff is successful when a designer or frontend engineer can describe the Muel product like this:

Muel is not just a bot page. It is one super-agent entrypoint that routes the user into the right bounded service experience while keeping identity, memory, and trust coherent.
