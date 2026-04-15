# Obsidian Digital Twin Ingest Workflow

## Purpose

This document defines the first repeatable loop for turning arbitrary material into durable digital twin knowledge.

It is the operational bridge between source-preserving capture and reusable canonical notes.

## Goal

Move one input through a safe path:

`input -> source note -> digest note -> canonical note update -> workspace or decision follow-up`

## Non-Goals

- building a universal OCR or parser layer for every format
- replacing careful judgment with a fully automatic merge step
- forcing every imported source to become canonical immediately

## Accepted Input Classes

- PDFs and long-form documents
- web pages and copied articles
- repo docs and architectural notes
- transcripts, meeting notes, or chat logs
- operator artifacts that need durable normalization

## Workflow

### Step 1: Intake And Classify

Determine the dominant job of the input before writing.

- If the material is evidence-heavy or hard to reconstruct, start with a `source` note.
- If the material is already a high-quality summary but still needs graph integration, create a `digest` note with explicit source references.
- If the material is actually a stable decision or rule change, route toward `decision` or `canonical`, but only after source lineage is clear.

### Step 2: Create A Source-Preserving Note

- Normalize headings, spacing, and obvious extraction noise.
- Preserve the meaning and order of the imported material.
- Record `source_refs` immediately.
- Do not compress semantics yet.

Exit criterion:
the source can be re-read later without depending on the original external system.

### Step 3: Produce A Digest Note

- Extract the reusable meaning from the source.
- Cluster repeated ideas, compare conflicting claims, and identify the concepts that matter.
- Keep `derived_from` current.
- If confidence is low, say so explicitly instead of pretending the summary is stable.

Exit criterion:
someone can understand what matters without rereading the raw source first.

### Step 4: Update Or Create The Canonical Note

- Reuse an existing canonical note if identity already exists.
- Create a new canonical note only when the concept truly lacks a stable home.
- Apply minimal diffs when updating canonical text.
- Preserve evidence and lineage links.

Exit criterion:
future work has one clear high-signal note to read first.

### Step 5: Create Workspace Or Decision Follow-Up If Needed

- Use a `workspace` note when active work remains.
- Use a `decision` note when a durable boundary or rationale must be preserved.
- Link back to the digest and canonical surfaces.

Exit criterion:
the next actor can see what remains open and where the durable knowledge now lives.

### Step 6: Validate And Close

- frontmatter parses
- links are intact
- source lineage is explicit
- the final graph is easier to traverse than before ingest
- no source note was overwritten with a lossy summary

## Routing Decisions

| Situation | Preferred Action |
| --- | --- |
| unclear or noisy source | create source note first |
| multiple related sources | create one digest from many sources, then update canonical |
| existing canonical already covers the concept | patch canonical minimally, do not fork a duplicate |
| active task remains after understanding | create workspace note |
| stable rule or rationale changed | create or update decision note |
| confidence remains low | keep claim in digest or workspace, not canonical |

## Failure-Closed Rules

- If parsing quality is poor, preserve more source and summarize less.
- If canonical identity is ambiguous, stop at digest and open a workspace note.
- If a note update would require destructive rewrite, create a sibling note and link it.
- If provenance cannot be reconstructed, do not promote the claim to canonical.

## First Automation Boundary

The first safe automation target is not full canonical merge.
It is this narrower loop:

1. create source note
2. create digest note
3. propose canonical patch or sibling canonical candidate
4. record any unfinished work in a workspace note

That is the minimum loop a hands-layer runtime such as Hermes should complete reliably before broader unattended autonomy is trusted.

## Relationship To Neighbor Documents

- `OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md` defines the governing write boundary.
- `OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md` defines the metadata contract for each note family.
- `OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md` provides the concrete skeletons used at each workflow step.
- `HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md` uses this ingest loop as the first useful local runtime loop.
