# Obsidian Object Model

Status:

- Canonical reference for the durable object families that should structure the vault.
- Intended to reduce feature-specific note sprawl and make the graph queryable by both humans and agents.

## 1. Goal

Define a small number of durable object types that can represent most of the operating graph:

- source
- service
- customer
- incident
- decision
- playbook
- improvement
- runtime snapshot
- repository context
- development slice

These object types are the schema of the living wiki.

## 2. Shared Frontmatter Contract

Every canonical object should prefer the following shared fields when applicable:

```yaml
---
title: "..."
canonical_key: "..."
object_type: "service|customer|incident|decision|playbook|improvement|source|runtime_snapshot|repository_context|development_slice"
status: "active|draft|deprecated|superseded|resolved|archived"
created: "ISO-8601"
updated: "ISO-8601"
tags: []
source: "human|agent|sync|system"
source_refs: []
supersedes: []
valid_at: null
invalid_at: null
owner: ""
---
```

Notes:

- `canonical_key` should be stable even when the title changes.
- `source_refs` should point to evidence objects, not just free-text URLs when a local evidence note exists.
- `supersedes` should be used instead of silent replacement.

## 3. Canonical Object Families

### 3.1 Source

Purpose:

- preserve raw evidence and provenance

Suggested path:

- `sources/<domain>/<slug>.md`

Required fields:

- `object_type: source`
- `captured_from`
- `captured_at`
- `source_kind`

Must link to:

- any affected service, customer, incident, or decision pages if known

### 3.2 Service

Purpose:

- represent an operated system surface, dependency, or business capability

Suggested path:

- `ops/services/<service-id>/PROFILE.md`

Required fields:

- `object_type: service`
- `service_id`
- `service_tier`
- `runtime_surface`
- `owners`

Should link to:

- current playbooks
- incidents
- decisions
- improvements
- runtime snapshots

### 3.3 Customer

Purpose:

- represent a user, guild, account, or stakeholder entity that accumulates operating context

Suggested path:

- `guilds/<guild-id>/customers/<customer-id>.md`

Required fields:

- `object_type: customer`
- `customer_id`
- `guild_id`
- `segment`

Should link to:

- incidents affecting the customer
- decisions involving the customer
- service relationships
- evidence of needs, escalations, and satisfaction

### 3.4 Incident

Purpose:

- track failures, risk events, degradations, and investigation state

Suggested path:

- `ops/incidents/<incident-id>.md`

Required fields:

- `object_type: incident`
- `incident_id`
- `severity`
- `opened_at`
- `state`
- `affected_services`

Must link to:

- evidence
- impacted services
- impacted customers when applicable
- recovery playbook
- follow-up improvement

### 3.5 Decision

Purpose:

- preserve architecture, process, or policy choices with explicit reasoning

Suggested path:

- `plans/decisions/<decision-id>.md`

Required fields:

- `object_type: decision`
- `decision_id`
- `decision_scope`
- `decision_date`
- `state`

Must link to:

- supporting evidence
- affected services
- affected incidents or improvements if any

### 3.6 Playbook

Purpose:

- define stable procedures for response, operation, validation, or maintenance

Suggested path:

- `ops/playbooks/<slug>.md`

Required fields:

- `object_type: playbook`
- `playbook_type`
- `entry_conditions`
- `exit_conditions`

Should link to:

- services covered
- incidents it remediates
- runtime checks it depends on

### 3.7 Improvement

Purpose:

- bind a failure pattern or capability gap to a proposed change and its verification state

Suggested path:

- `improvements/<improvement-id>.md`

Required fields:

- `object_type: improvement`
- `improvement_id`
- `origin_type`
- `state`
- `validation_rule`

Must link to:

- originating incident, retro, or gap
- affected service/customer/decision
- validation evidence

### 3.8 Runtime Snapshot

Purpose:

- mirror current runtime truth into the vault in a human-readable form

Suggested path:

- `_runtime/<snapshot-kind>/<date-or-key>.md`

Required fields:

- `object_type: runtime_snapshot`
- `snapshot_kind`
- `captured_at`
- `producer`

Should link to:

- the service pages and incidents implied by the snapshot

### 3.9 Repository Context

Purpose:

- represent a repository or external codebase as a durable object in the graph

Suggested path:

- `ops/contexts/repos/<owner_repo>.md`

Required fields:

- `object_type: repository_context`
- `repo_key`
- `repo_owner`
- `repo_name`
- `repo_role`
- `integration_surfaces`

Must link to:

- local services that depend on the repo
- decisions, contracts, or playbooks that define the relationship
- development slices that changed the integration

### 3.10 Development Slice

Purpose:

- capture one bounded change episode across planning, implementation, review, validation, and rollout

Suggested path:

- `plans/development/<date>_<slug>.md`

Required fields:

- `object_type: development_slice`
- `slice_id`
- `objective`
- `changed_paths`
- `validation_refs`
- `outcome_state`

Must link to:

- source backlog item, ADR, or decision record
- affected services or repository-context objects
- validation evidence and follow-up improvements or incidents when applicable

## 4. Graph Invariants

The object model is only useful if the graph stays legible.

### 4.1 Required invariants

1. Decisions must link to evidence.
2. Incidents must link to affected services.
3. Improvements must link to their origin and their validation rule.
4. Service pages must link to current playbooks and recent incidents.
5. Customer pages must not become free-form diaries; they should link to evidence, incidents, and decisions.
6. Repository-context pages must link to local services, integration surfaces, and the decisions that justify the relationship.
7. Development slices must link objective, changed paths, validation evidence, and next actions.

### 4.2 Anti-patterns

- large prose notes with no canonical key
- summaries with no evidence backlinks
- incident pages that stop at description and never connect to improvement
- duplicated service profiles with slightly different titles
- using Supabase row IDs as the only stable identifier when the vault needs a human-stable key

## 5. What Lives In Obsidian vs Derived Stores

### 5.1 Obsidian should own

- semantic meaning
- object identity
- backlinks and graph shape
- human-readable decisions
- visible runtime interpretation

### 5.2 Supabase and other derived systems should own

- cache acceleration
- eval aggregation
- ranking aids
- telemetry history
- API-friendly structured summaries

Rule:

- If a field changes the meaning of a note, it belongs in Obsidian metadata first.
- If a field only accelerates lookup or aggregation, it can live in a derived store.

## 6. Generated Views

The following views should be generated from canonical objects rather than hand-maintained separately:

- root index pages
- service map
- incident register
- customer escalation watchlist
- improvement backlog summaries
- runtime mismatch watch pages
- repository context map
- development archaeology log

## 7. Minimum Query Entry Points

The vault should always expose a few predictable starting points.

- `_control/INDEX.md` — canonical object catalog
- `_control/LOG.md` — chronological ingest/query/lint/operate/improve log
- `ops/services/` — service hub
- `ops/incidents/` — incident hub
- `ops/contexts/repos/` — repository context hub
- `plans/decisions/` — decision hub
- `plans/development/` — development archaeology hub
- `improvements/` — improvement hub

## 8. Relationship To Current Repository

This object model fits the current repository direction because it reinforces:

- graph-first retrieval
- runtime-visible knowledge control
- same-vault write semantics
- visible operator truth

It does not require immediate removal of current folders. It requires consistent object meaning inside them.

## 9. Companion Documents

- `docs/planning/OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md`
- `docs/planning/OBSIDIAN_TRANSITION_PLAN.md`
- `docs/contracts/OBSIDIAN_READ_LOOP.md`
