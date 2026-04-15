# Obsidian Digital Twin Note Schema

## Purpose

This document defines the minimum note-family and frontmatter contract for an Obsidian vault that acts as a digital twin.

The schema is intentionally small. It exists to keep notes stable for human reading, graph retrieval, and future agent writes.

## Schema Principles

- Metadata must survive folder moves. Identity should not depend on one directory layout.
- One note should have one dominant job. Split notes when one file is trying to be both source archive and canonical synthesis.
- Filename stability is usually more valuable than taxonomy perfection.
- Frontmatter should be just large enough to preserve lineage, routing, and reuse.
- If the agent cannot fill a field honestly, it should omit the field or create a source-preserving note first.

## Minimum Frontmatter

All durable note classes should use the following minimum contract when possible.

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | human-readable stable note title |
| `twin_kind` | yes | `source`, `digest`, `canonical`, `workspace`, or `decision` |
| `twin_mode` | yes | `source-preserving`, `derived`, `canonical`, or `working` |
| `status` | yes | `active`, `draft`, `stable`, `superseded`, or `archived` |
| `tags` | yes | retrieval and graph hints |
| `created_at` | yes | first durable creation date |
| `updated_at` | yes | last meaningful content update date |
| `source_refs` | conditional | source pointers for notes grounded in external material |
| `derived_from` | conditional | note links or IDs used as the basis for synthesis |
| `canonical_for` | optional | domains or concepts this note owns canonically |
| `aliases` | optional | alternate names used by humans or agents |
| `confidence` | optional | `low`, `medium`, `high`, or an explicit scoped description |
| `steward` | optional | human, agent, or team currently responsible for upkeep |
| `packet_kind` | optional | for `workspace` notes used as collaboration packets; typically `handoff` or `progress` |

## Example Frontmatter

```yaml
---
title: Hermes bootstrap working brief
twin_kind: workspace
twin_mode: working
status: active
tags:
  - control
  - hermes
  - bootstrap
created_at: 2026-04-11
updated_at: 2026-04-11
derived_from:
  - [[OBSIDIAN_DIGITAL_TWIN_CONSTITUTION]]
  - [[MANAGED_AGENTS_FOUR_LAYER_MODEL]]
steward: agent
confidence: high
---
```

## Class-Specific Expectations

| `twin_kind` | Typical `twin_mode` | Required Emphasis | Update Rule |
| --- | --- | --- | --- |
| `source` | `source-preserving` | preserve imported material and source metadata | never replace body with lossy summary |
| `digest` | `derived` | summarize, cluster, compare, extract | can rewrite for clarity if lineage remains intact |
| `canonical` | `canonical` | stable reusable knowledge object | merge and refine without dropping evidence trail |
| `workspace` | `working` | active execution support | aggressive rewrite allowed, but keep status and next target current |
| `decision` | `canonical` or `derived` | durable rationale and boundary record | prefer append or section update over silent rationale replacement |

## Source Reference Contract

Use `source_refs` whenever the note depends on imported material outside the note itself.

Recommended fields inside each source reference item:

- `kind`: pdf, web, repo-doc, transcript, email, slide, or other short classifier
- `locator`: URL, file path, attachment name, or stable identifier
- `imported_at`: date or timestamp
- `notes`: optional short context about what portion mattered

## Upsert Rules

### Source Notes

- Normalize structure, not meaning.
- Add extraction metadata, aliases, tags, and links freely.
- If a stronger summary is needed, create a sibling `digest` note.

### Digest Notes

- Prefer one digest per clear synthesis job.
- Rewrites are allowed when they increase clarity or retrieval value.
- Keep `derived_from` current when merging additional evidence.

### Canonical Notes

- Canonical notes own stable phrasing for a concept, person, system, or operating rule.
- Update incrementally. Avoid full rewrites unless the note identity has genuinely changed.
- When replacing a canonical note, mark the older note `superseded` and link forward.

### Workspace Notes

- Workspace notes may change quickly.
- They still need enough metadata for another agent to resume work.
- When the work stabilizes, converge it into a digest, canonical, or decision note.
- When a workspace note acts as a collaboration packet, set `packet_kind` so later sessions can distinguish handoff state from high-frequency progress state.

## Linking Rules

- Link to the most specific stable note available.
- Prefer explicit wikilinks over implicit name reuse when identity matters.
- Use aliases to absorb naming variation instead of duplicating near-identical notes.
- Do not remove an outgoing link from a canonical note unless the underlying relationship is actually gone.

## Validation Checklist

Before treating a write as complete, verify:

1. frontmatter still parses
2. required fields still match the note's actual role
3. source or derivation lineage is present when needed
4. the note is easier to retrieve or reuse than before
5. no structural Markdown features were broken during the write

## Relationship To Neighbor Documents

- `OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md` explains why these rules exist.
- `OBSIDIAN_OBJECT_MODEL.md` remains the broader vault object reference.
- `HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md` describes the first runtime that should honor this schema locally.
