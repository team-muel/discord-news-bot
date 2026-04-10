# Obsidian Transition Plan

Status:

- Transition plan from the current mixed control-plane shape to the Obsidian-centered operating model.
- Planning document only; no runtime contract changes are implied by this file alone.

## 1. Objective

Move the system toward one visible operating graph where the vault becomes the semantic operating surface and runtime/derived systems mirror it instead of competing with it.

## 2. Non-Goals

- abrupt folder renames across the live synced vault
- replacing all Supabase usage
- moving critical runtime logic out of code and into markdown
- changing deployment topology as part of the documentation slice alone

## 3. Current State Summary

The repository already has strong enabling pieces:

- graph-first retrieval contract
- knowledge-control runtime surface
- operating baseline manifest
- remote-vault parity awareness
- fail-closed write semantics for the selected writer

The main problems are structural:

1. control truth is split across docs, runtime JSON, env, and vault conventions
2. durable object types are implicit instead of explicit
3. retros, incidents, decisions, and improvements are not yet one coherent object graph
4. several operational summaries exist both in docs and in derived stores with no single semantic owner
5. repo-wide process knowledge is spread across docs, `.github`, scripts, config, and gate outputs with no stable archaeology object

## 4. Target State

Target state is achieved when:

- the vault owns semantic meaning and object identity
- runtime routes expose mirrors of the same object graph
- derived stores accelerate, but do not redefine, meaning
- operators can inspect incidents, services, decisions, customers, and improvements in one connected graph

## 5. Transition Strategy

### Phase 1. Contract Freeze

Goal:

- freeze the operating model before more runtime features create new object drift

Scope:

- approve the blueprint
- approve the object model
- bind the direction to M-23 operational documentation consolidation

Entry criteria:

- current runtime docs are aligned

Exit criteria:

- canonical planning docs reference the blueprint and object model

### Phase 2. Visible Entry Points

Goal:

- make the vault legible through predictable indexes and hubs

Scope:

- create generated indexes for service, incident, decision, and improvement hubs
- make `_control/INDEX.md` and `_control/LOG.md` first-class entry points
- standardize `canonical_key`, `object_type`, `source_refs`, and `supersedes`
- add repository-context and development-slice entry points for repo-wide archaeology

Recommended implementation slices:

1. generated object catalog from existing notes
2. lint for missing object_type/canonical_key
3. incident/improvement backlink validation
4. repository-context note template + development-slice template

Exit criteria:

- a new operator can start from the control index and traverse the operating graph without reading runbook prose first

### Phase 3. Runtime Mirror Convergence

Goal:

- align runtime routes and vault-visible state

Scope:

- mirror current loop, parity, and health snapshots into `_runtime/`
- ensure service pages link to latest runtime snapshots
- connect incident pages to live runtime evidence

Recommended implementation slices:

1. runtime snapshot writer for selected health/control surfaces
2. service-page backlink injection for current snapshots
3. incident template that binds runtime evidence automatically

Exit criteria:

- runtime mismatch detection is visible from both API and vault

### Phase 4. Improvement Graph Convergence

Goal:

- turn retros and gaps into durable improvement objects rather than prose endpoints

Scope:

- introduce improvement note templates
- bind retros to improvements and validation rules
- attach validation evidence and rollout state

Recommended implementation slices:

1. retro-to-improvement conversion helper
2. validation-result append path
3. generated improvement backlog view

Exit criteria:

- every non-trivial retro can be traced into a visible improvement object with validation evidence

### Phase 5. Derived Store Simplification

Goal:

- reduce semantic duplication between vault and operational stores

Scope:

- move meaning-bearing fields into note metadata where still missing
- keep Supabase as acceleration, analytics, and audit plane
- simplify dual persistence where the vault should be the semantic owner

Recommended implementation slices:

1. identify dual-write paths and classify them as semantic vs derived
2. eliminate only the semantic duplication first
3. keep performance helpers and audit trails in place

Exit criteria:

- semantic drift risk is materially lower and derived stores can be rebuilt without meaning loss

## 6. Risks And Mitigations

### Risk 1. Documentation outruns runtime

Mitigation:

- keep `docs/ARCHITECTURE_INDEX.md`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, and runtime routes as the runtime truth
- treat this transition plan as directional until implementation lands

### Risk 2. Vault reshaping breaks the visible synced workspace

Mitigation:

- preserve current roots during transition
- prefer compatibility mapping over large-scale moves
- keep same-vault semantics as a hard gate

### Risk 3. LLM-generated structure outruns human inspectability

Mitigation:

- require evidence backlinks and canonical keys
- generate indexes instead of relying on memory of folder structure
- lint orphaned or low-link notes regularly

### Risk 4. Too many object types re-create complexity

Mitigation:

- keep the object model small
- add a new object family only when current families cannot express a durable operating concern

## 7. Suggested First Implementation Sequence

If this plan moves into implementation, the safest order is:

1. object-type metadata lint + canonical key normalization
2. generated control index and hub pages
3. repository-context catalog + development-slice template
4. service/incident/improvement relationship enforcement
5. runtime snapshot mirroring into the vault
6. retro-to-improvement flow

## 8. Recommended Next Skill

- `/implement` for metadata normalization, generated indexes, and relationship enforcement
- `/review` after the first object-model enforcement slice lands

## 9. Companion Documents

- `docs/planning/OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md`
- `docs/planning/OBSIDIAN_OBJECT_MODEL.md`
- `docs/planning/OBSIDIAN_DEVELOPMENT_ARCHAEOLOGY.md`
- `docs/ARCHITECTURE_INDEX.md`
- `docs/RUNBOOK_MUEL_PLATFORM.md`
