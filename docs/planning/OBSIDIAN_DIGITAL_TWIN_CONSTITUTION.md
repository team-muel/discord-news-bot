# Obsidian Digital Twin Constitution

## Purpose

The Obsidian vault is the semantic owner of the user's digital twin.
It must accept arbitrary documents, preserve what matters, and turn raw material into reusable knowledge without damaging Markdown integrity, frontmatter validity, or graph utility.

This document defines the write-side constitution for that vault-first operating model.

## Core Commitments

- The vault is not a scratchpad dump. Durable writes must either preserve source, improve structure, or clarify control.
- Agent autonomy is allowed by default. The boundary is not note approval class but transformation safety, provenance, and reversibility.
- Every durable note must stay readable as plain Markdown, parseable by tooling, and navigable through links, tags, and stable metadata.
- Derived knowledge must point back to evidence.
- Canonical notes may simplify, but they must not hide where claims came from.
- Working notes may stay provisional, but they must still be locatable, linkable, and convergent toward a durable object or an explicit expiration.

## Transformation Modes

The main control boundary is transformation mode.

| Mode | Primary Goal | Allowed Mutation | Required Lineage |
| --- | --- | --- | --- |
| `source-preserving` | Capture or normalize source material without semantic loss | light cleanup, heading normalization, OCR repair, metadata enrichment | import reference, ingestion timestamp, source pointer |
| `derived` | Extract structure, summarize, cluster, compare, or explain | selective synthesis and re-organization | explicit `derived_from` links to source or prior notes |
| `canonical` | Maintain the durable note humans and agents should reuse | section re-organization, consolidation, dedupe, stable naming | evidence links plus replacement/supersession trail |
| `working` | Support active execution, triage, or temporary operator reasoning | aggressive rewrite allowed | owner, status, and next convergence target |

## Non-Negotiable Invariants

### Structural Integrity

- Frontmatter must remain valid YAML.
- Wikilinks, embeds, headings, and code fences must not be silently broken.
- Writes must prefer minimal diffs over whole-file replacement when identity is stable.
- If a transformation cannot preserve structure confidently, the agent should create a sibling note instead of damaging the current one.

### Provenance

- A claim without traceable lineage is not canonical knowledge.
- Source-preserving notes must never be overwritten with lossy summary text.
- Derived and canonical notes must retain the path back to the source set that justified them.

### Graph Utility

- Durable notes must improve future retrieval, not only immediate readability.
- A note should expose stable names, aliases, and meaningful links so a later agent can navigate the graph without re-reading the entire vault.
- Link density is allowed when it improves recall and navigation; sparse notes are not automatically better notes.

### Human and Agent Co-Use

- The same note should remain understandable to a human reader and operable by an agent.
- Decorative prose that weakens structure, searchability, or future edit safety is a regression.
- The vault should explain why something matters, not only that it exists.

## Durable Note Classes

These are functional classes, not approval classes.

- `source`: imported or source-preserving material
- `digest`: extracted or condensed understanding from one or more sources
- `canonical`: the note future work should preferentially read and update
- `workspace`: active task, scratch control, or short-lived execution context
- `decision`: stable rationale, policy, or boundary choice

Any class may be agent-authored. The agent is responsible for choosing the right transformation mode and preserving lineage.

## Write Policy

### Allowed by Default

- Create new notes when that is safer than mutating an existing one.
- Update existing derived, canonical, or workspace notes when lineage remains clear.
- Add metadata, aliases, backlinks, and structural scaffolding that improve retrieval and future maintenance.

### Disallowed by Default

- Replacing a source-preserving note body with a summary.
- Dropping frontmatter fields that still carry identity, lineage, or routing meaning.
- Collapsing multiple independent concepts into one note just to reduce file count.
- Rewriting a canonical note in a way that destroys its outgoing evidence trail.

## Success Criteria

A digital-twin write is successful only if all of the following stay true:

1. The note still parses and renders as valid Markdown with valid frontmatter.
2. The note remains discoverable through names, tags, links, or explicit source references.
3. The note exposes enough lineage for a later agent to justify or revise the content.
4. The note is more reusable after the write than before it.
5. The vault is closer to a graph of stable knowledge objects, not farther.

## Failure Modes To Avoid

- Source destruction hidden as cleanup
- Canonical note drift without evidence updates
- Over-compression that removes nuance needed for later reasoning
- Pretty formatting that weakens machine parsing or search
- Workspace sprawl that never converges into durable knowledge

## First Operating Consequences

- Ingestion should start with source-preserving capture, not immediate canonical rewrite.
- Derived notes should do the heavy semantic compression work.
- Canonical notes should remain comparatively stable and high-signal.
- Hermes or any other hands-layer runtime should treat this constitution as the write-side gate before broader autonomy.

## Relationship To Neighbor Documents

- `OBSIDIAN_OBJECT_MODEL.md` stays the broader object-model reference.
- `OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md` defines the minimum frontmatter and note-family contract that operationalizes this constitution.
- `HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md` defines the smallest safe local rollout for a hands-layer runtime acting on the vault.
