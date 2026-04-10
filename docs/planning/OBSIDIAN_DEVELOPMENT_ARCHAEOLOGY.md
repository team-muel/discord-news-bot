# Obsidian Development Archaeology

Status:

- Canonical reference for turning repo-wide development process and scattered operating artifacts into a queryable wiki graph.
- Extends the Obsidian operating model from service/runtime knowledge into development archaeology, repo context, and multi-repo onboarding.

## 1. Goal

Capture the development process as visible, linkable operating knowledge without turning the vault into a blind mirror of the repository.

Target outcomes:

- the development path from plan to implementation to review to validation is inspectable in the vault
- repo-wide scattered artifacts are grouped into stable wiki objects instead of being left as disconnected files
- adding a new service or an external repo context has a predictable onboarding shape

## 2. Non-Goals

- mirroring every source file, script, or config file into a note
- replacing code, tests, or runtime manifests with markdown
- treating generated summaries as more authoritative than the original repo artifact
- forcing a full folder rename across the current synced vault

## 3. What Counts As Development Archaeology

Development archaeology is the durable record of how the system changed and why.

It includes:

- roadmap, execution board, backlog, and transition plans
- ADRs, architecture changelog entries, and operating baseline changes
- implementation slices, review findings, QA evidence, and rollout checks
- service onboarding, dependency changes, recovery notes, and external repo context
- `.github` instructions, skills, contracts, and scripts when they materially shape behavior

It does not mean every file becomes a note. It means every meaningful change has a stable semantic home.

## 4. Two New Wiki Objects

### 4.1 Repository Context

Purpose:

- represent a repository or external codebase as an object in the graph
- keep cross-repo context inspectable when more services or repos join the platform

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

- local service profiles that depend on the repo
- decisions or contracts that define the relationship
- development slices that changed the integration

### 4.2 Development Slice

Purpose:

- capture one bounded change episode across plan, implement, review, QA, and rollout
- become the readable archaeology layer instead of scattering meaning across backlog notes, changelog snippets, and gate outputs

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

- source plans or backlog items
- affected services or repo-context objects
- validation evidence, gate runs, or runtime checks
- follow-up improvement or incident objects when applicable

## 5. Repo Artifact Mapping Rules

| Repo artifact family | Wiki landing zone | Note style | Default rule |
| --- | --- | --- | --- |
| Canonical control docs | `ops/control-tower/` | canonical control note | Backfill directly |
| Service deploy/runtime docs | `ops/services/<service>/` | service profile / recovery / dependency map | Backfill or synthesize as service-memory |
| Roadmap, board, backlog, transition docs | `plans/` | execution or transition note | Backfill directly |
| ADRs and architecture changelog | `plans/decisions/` or linked development slices | decision evidence | Link from slice, do not duplicate meaning |
| `.github` instructions and skills | control note or development slice evidence | agent protocol evidence | Mirror only when they shape behavior materially |
| Scripts and config files | linked from service profile or playbook | implementation evidence | Do not mirror every file |
| Gate runs, reports, checklist outputs | development slice / quality note | validation evidence | Keep as evidence, not as primary canonical docs |
| External repo docs or DeepWiki context | `ops/contexts/repos/` | repository context note | Link local purpose, owner, integration surface |

Rule of thumb:

- If the file defines runtime or semantic meaning, it deserves a canonical wiki landing zone.
- If the file is mainly execution detail, keep it in the repo and link to it from the canonical note.

## 6. Seed Order For Repo-Wide Wikiization

The safest order is:

1. control and runbook docs
2. service profiles and runtime manifests
3. roadmap, board, backlog, and transition notes
4. multi-repo repository-context notes
5. development slices for high-value or high-risk changes
6. evidence attachments for gate runs, QA, incidents, and retros

This keeps the semantic spine stable before adding archaeology depth.

## 7. Onboarding A New Service

When a new service is added:

1. create or update `ops/services/<service>/PROFILE.md`
2. link dependency, recovery, and runtime surfaces from that profile
3. create a development slice for the onboarding change if the service changes runtime behavior
4. attach validation refs and rollout evidence
5. update a repository-context note if the service depends on another repo or external codebase

## 8. Onboarding A New External Repo Context

When another repo becomes part of the working context:

1. create `ops/contexts/repos/<owner_repo>.md`
2. record repo role, owner, purpose, and integration surfaces
3. link the local services that consume or depend on it
4. link the decision or contract that justified the connection
5. create development slices for any local changes driven by that repo

This avoids spraying cross-repo meaning across changelog lines and implementation notes.

## 9. Anti-Sprawl Rules

1. Do not create one wiki note per file by default.
2. Do not duplicate generated reports into canonical notes; link them as evidence.
3. Do not let development slices become raw diaries; they must link objective, changed paths, validation, and next actions.
4. Do not track cross-repo context only in roadmap prose; use repository-context objects.
5. Do not backfill low-signal artifacts unless they answer a recurring operational question.

## 10. Recommended First Slice In This Repo

For this repository, the first useful archaeology slice is:

- keep existing control, service, and plan backfill as the semantic spine
- add this development-archaeology policy as a canonical control note
- extend the object model with `repository_context` and `development_slice`
- use future high-value changes to seed `plans/development/` incrementally rather than bulk-generating history

## 11. Companion Documents

- `docs/planning/OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md`
- `docs/planning/OBSIDIAN_OBJECT_MODEL.md`
- `docs/planning/OBSIDIAN_TRANSITION_PLAN.md`
- `docs/planning/PLATFORM_CONTROL_TOWER.md`
- `docs/contracts/OBSIDIAN_READ_LOOP.md`

## 12. Team Repeatability

Yes. The team can do the same work as long as the semantic source stays in the repository and the shared vault stays a derived target.

Minimal repeat workflow:

1. pull `main`
2. inspect current catalog coverage with `npm run obsidian:backfill:system:report -- --json`
3. add or update the repo source note under `docs/`
4. wire the note into `config/runtime/knowledge-backfill-catalog.json`
5. backfill the specific entry or the full catalog into the synced vault
6. re-run the report and confirm the new target exists

This keeps the process team-visible, reviewable in git, and repeatable without making the vault the only source of truth.
