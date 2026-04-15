# Hermes Obsidian Minimum Bootstrap

## Purpose

This document defines the smallest safe bootstrap for using Hermes as the local hands-layer runtime in an Obsidian-centered digital twin workflow.

It is not an installation cookbook for every platform. It is the minimum operating contract that should be true before broader autonomy is allowed.

## Target Runtime Shape

- high-capacity reasoning model: primary brain for planning, synthesis, and hard decisions
- Hermes: local hands-layer runtime for editor, terminal, and automation actions
- Obsidian vault: semantic owner and durable digital twin surface
- Ollama: optional local sidecar for cheap summarization, preprocessing, and offline fallback
- OpenJarvis: optional later-stage projection, indexing, evaluation, and learning-loop surface

## Platform Posture

- On Windows, Hermes should be treated as a WSL2-first tool unless native support becomes real and stable.
- Obsidian can remain on the host OS as the human-facing workspace.
- The vault path exposed to Hermes should be the same logical vault, not a divergent export copy.

## Minimum Capability Set

Before calling the bootstrap complete, Hermes must be able to do all of the following safely:

1. read vault notes without breaking frontmatter or wikilinks
2. create new source, digest, canonical, and workspace notes using the agreed schema
3. update existing canonical notes with minimal diffs instead of blind overwrite
4. operate local terminal and git workflows for the relevant repo work
5. reach the remote VM or other heavy execution surfaces when the task exceeds local scope
6. write back the outcome of meaningful work into the vault
7. maintain one handoff packet and one progress snapshot that a later bounded GPT session can resume from directly

## Phase Order

### Phase 0: Read-Only Safety Check

- confirm Hermes can enumerate the target vault safely
- confirm note reads preserve Markdown and frontmatter exactly
- confirm the runtime can distinguish source notes from canonical notes before attempting writes

### Phase 1: Safe Note Writes

- create one new source-preserving note from imported material
- create one derived digest from that source
- update one existing or newly created canonical note with evidence-backed synthesis
- create one workspace note that records the active loop and next action

### Phase 2: Tooling and Execution Integration

- attach local terminal and git execution
- attach remote VM access for heavy or long-running actions
- keep vault writes as the control artifact, not as an afterthought log dump

### Phase 3: Optional Local Acceleration

- attach Ollama for cheap transforms or offline passes
- project selected vault and runtime artifacts into OpenJarvis only after the vault write path is already stable
- keep OpenJarvis as projection and acceleration, not ownership replacement

## First Useful Loop

The first real loop should be small and repeatable:

1. ingest one external document into a `source` note
2. create a `digest` note that extracts reusable meaning
3. merge the durable insight into a `canonical` note
4. record outstanding actions in a `workspace` note
5. if code or ops action is required, execute it through Hermes and write the outcome back into the vault

If this loop is not reliable, broader autonomy is premature.

## Safety Rails

- Hermes should prefer sibling-note creation over risky in-place rewrite.
- Source-preserving notes should be append-only except for structural cleanup and metadata improvement.
- Canonical note updates should remain evidence-backed and reversible.
- Workspace notes should converge into durable notes or explicit closure, not accumulate forever.
- Local cheap-model usage must not silently replace the primary reasoning layer on high-stakes decisions.

## Non-Goals For The Minimum Slice

- full unattended autonomy across every machine and service
- complete OpenJarvis learning-loop integration
- generalized arbitrary tool wrapping beyond the needed vault, terminal, git, and remote-access surfaces
- replacing Obsidian with a vector index or agent memory store

## Exit Criteria

The bootstrap is complete only when all of the following are true:

- the vault survives repeated read/write cycles without structural damage
- Hermes can complete the first useful loop end to end
- the resulting notes, handoff packet, and progress snapshot are still good enough for a later agent session to resume from them directly
- the operator can tell what happened, why it happened, and what should happen next by reading the vault

## Relationship To Neighbor Documents

- `OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md` defines the write-side boundary Hermes must respect.
- `OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md` defines the minimum note contract Hermes should emit.
- `MANAGED_AGENTS_FOUR_LAYER_MODEL.md` explains why Hermes is the hands layer rather than the semantic owner or the primary brain.
- `HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md` defines the post-bootstrap collaboration contract, including handoff packets, progress snapshots, and recall boundaries.
