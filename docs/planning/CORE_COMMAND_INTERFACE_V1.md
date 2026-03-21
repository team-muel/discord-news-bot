# Core Command Interface v1

Status note:

- Reference contract specification for the adapter/core boundary.
- This file is canonical for interface shape within its contract family, but it is not a roadmap or active execution tracker.

Purpose:

- Freeze the core decision boundary so channel adapters can remain thin.
- Keep Discord-specific parsing/UX outside core execution and policy gates.

Canonical scope:

- Input envelope accepted by core: commandEnvelope v1
- Output envelope emitted by core: evidenceBundle v1 + policyDecisionRecord
- Event telemetry emitted by adapter/core edges: eventEnvelope v1

## 1) Boundary

Adapter responsibilities:

- Parse transport payload (Discord interaction/message)
- Resolve reply visibility and UX controls
- Build commandEnvelope v1
- Emit ingress/egress eventEnvelope records

Core responsibilities:

- Intent routing, policy gating, memory hydration, execution orchestration
- Skill execution and final response composition
- Produce evidenceBundle and policyDecisionRecord

Out of scope for core:

- Discord reply/edit mechanics
- Discord component lifecycle (button/modal)
- Slash registration and guild sync

## 2) Core Command v1 Contract

Required fields:

- command_id: unique command trace id
- command_type: semantic command kind (examples: agent.run, docs.ask, worker.generate)
- requested_by: actor id
- requested_at: ISO date-time
- idempotency_key: dedupe key for retry-safe command handling
- policy_context: policy mode + optional admin/session metadata
- payload: normalized business payload (goal/query/options)

Schema source:

- docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json -> $defs.commandEnvelope

## 3) Core Output Contract

Primary output:

- evidenceBundle v1

Policy output:

- policyDecisionRecord

Schema source:

- docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json -> $defs.evidenceBundle
- docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json -> $defs.policyDecisionRecord

## 4) Event Contract at Boundary

Adapter and core exchange must emit eventEnvelope v1 with:

- event_id, event_type, event_version, occurred_at, guild_id, actor_id, payload, trace_id

Compatibility rule:

- event_version=1 is required for week-1 lock.
- New keys must be additive and backward compatible within v1.
- Breaking changes require v2 introduction and dual-read window.

Schema source:

- docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json -> $defs.eventEnvelope

## 5) Current In-Process Implementation Mapping

Current adapter entry:

- src/bot.ts interaction handlers

Current core entry:

- src/services/multiAgentService.ts startAgentSession(...)

Current contract verification:

- scripts/validate-autonomy-contracts.mjs
- src/services/autonomyContractSchemas.test.ts

## 6) Acceptance for W1-01

Done when:

- Core command boundary document exists (this file)
- commandEnvelope/evidenceBundle/policyDecisionRecord schema references are fixed
- Adapter/core responsibilities are explicitly separated

Evidence commands:

- npm run contracts:validate
- npm run test:contracts
