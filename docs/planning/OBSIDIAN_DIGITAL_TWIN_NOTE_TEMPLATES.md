# Obsidian Digital Twin Note Templates

## Purpose

This document turns the digital twin constitution and note schema into reusable note skeletons.

These templates are intentionally plain.
They should stay easy to paste into Obsidian, easy for an agent to emit, and easy to validate after edits.

## How To Use

- Start from the closest note family instead of forcing one universal template.
- Fill placeholders honestly. If the agent cannot justify a field, omit it or create a source note first.
- Preserve the section order when possible so future agents can predict where key information lives.
- Prefer stable filenames. Use aliases and tags to absorb naming drift.

## Shared Frontmatter Pattern

```yaml
---
title: {{title}}
twin_kind: {{source|digest|canonical|workspace|decision}}
twin_mode: {{source-preserving|derived|canonical|working}}
status: {{draft|active|stable|superseded|archived}}
tags:
  - {{domain}}
  - {{topic}}
packet_kind: {{optional-handoff-or-progress}}
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
aliases: []
source_refs: []
derived_from: []
canonical_for: []
confidence: {{low|medium|high}}
steward: {{human|agent|team}}
---
```

Remove empty optional fields if they do not help the note.

## Source Note Template

Use when the main job is to preserve imported material and its provenance.

```markdown
---
title: {{source title}}
twin_kind: source
twin_mode: source-preserving
status: active
tags:
  - source
  - {{domain}}
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
source_refs:
  - kind: {{pdf|web|repo-doc|transcript|other}}
    locator: {{url-or-path}}
    imported_at: {{YYYY-MM-DD}}
    notes: {{optional-scope-note}}
confidence: high
steward: agent
---

# Summary

One or two lines on what this source is.

# Source Context

- origin:
- reason imported:
- scope worth keeping:

# Normalized Content

Preserve the material here with only structural cleanup.

# Extraction Notes

- terms worth aliasing:
- follow-up digest target:
- unresolved OCR or parsing issues:
```

## Digest Note Template

Use when the goal is to extract reusable understanding from one or more sources.

```markdown
---
title: {{digest title}}
twin_kind: digest
twin_mode: derived
status: active
tags:
  - digest
  - {{domain}}
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
derived_from:
  - [[{{source note}}]]
confidence: {{medium|high}}
steward: agent
---

# Thesis

What the source set means in reusable terms.

# Key Points

-
-
-

# Evidence Map

- [[{{source note}}]]: what this source contributed

# Open Questions

-

# Canonical Targets

- notes to update or create next:
```

## Canonical Note Template

Use when the note should become the stable object that later humans and agents reuse.

```markdown
---
title: {{canonical title}}
twin_kind: canonical
twin_mode: canonical
status: stable
tags:
  - canonical
  - {{domain}}
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
derived_from:
  - [[{{digest note}}]]
canonical_for:
  - {{concept-or-system}}
aliases: []
confidence: high
steward: {{agent|team}}
---

# What This Is

Short stable description.

# Current Model

-
-
-

# Why It Matters

-

# Evidence And Lineage

- [[{{digest note}}]]
- [[{{source note}}]]

# Related Notes

-
```

## Workspace Note Template

Use when active execution needs a resumable scratch control surface.

```markdown
---
title: {{workspace title}}
twin_kind: workspace
twin_mode: working
status: active
tags:
  - workspace
  - {{project-or-loop}}
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
derived_from:
  - [[{{canonical or digest note}}]]
confidence: medium
steward: agent
---

# Current Goal

What is being done now.

# Current State

-

# Next Actions

1. 
2. 
3. 

# Blocking Questions

-

# Convergence Target

- digest/canonical/decision note to update when this work closes
```

## Handoff Packet Template

Use when one active workstream needs a stable cross-session resume packet for bounded GPT reasoning and persistent Hermes continuity.

```markdown
---
title: {{handoff title}}
twin_kind: workspace
twin_mode: working
status: active
tags:
  - workspace
  - hermes
  - handoff
packet_kind: handoff
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
derived_from:
  - [[{{canonical or digest note}}]]
confidence: medium
steward: agent
---

# Session Objective

One or two lines on the current user-visible outcome.

# User Intent Model

- requested outcome:
- explicit non-goals:
- current priority:
- important constraints:

# Verified State

- fact:
- fact:

# Completed Since Last Session

-

# Decision Distillate For Hermes

- situation:
- decision:
- why:
- rejects:
- reuse_when:
- recall_when:

# Open Loops

-

# Pending Decisions For GPT

-

# Safe Autonomous Queue For Hermes

1.
2.

# Evidence And References

- [[{{supporting note}}]]

# Recall Triggers

-

# Context Budget State

- included_now:
- intentionally_omitted:
- fetch_on_demand:
```

## Progress Snapshot Template

Use when one active workstream needs a short overwrite-friendly status heartbeat during execution.

```markdown
---
title: {{progress title}}
twin_kind: workspace
twin_mode: working
status: active
tags:
  - workspace
  - hermes
  - progress
packet_kind: progress
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
derived_from:
  - [[{{handoff or canonical note}}]]
confidence: medium
steward: agent
---

# Objective

Current workstream objective in one line.

# Owner And Mode

- owner: {{hermes|gpt|human}}
- mode: {{observing|executing|waiting|blocked|review-needed}}
- last_verified_at: {{YYYY-MM-DD HH:MM optional}}

# Delta Since Last GPT Session

-

# Completed

-

# In Flight

-

# Blockers

-

# Next Action

-

# Escalation Status

- {{none|pending-gpt|pending-human}}

# Context Budget State

- included_now:
- intentionally_omitted:
- fetch_on_demand:

# Evidence And References

- [[{{supporting note}}]]
```

## Decision Note Template

Use when the note should preserve durable rationale and boundary choices.

```markdown
---
title: {{decision title}}
twin_kind: decision
twin_mode: canonical
status: stable
tags:
  - decision
  - {{domain}}
created_at: {{YYYY-MM-DD}}
updated_at: {{YYYY-MM-DD}}
derived_from:
  - [[{{supporting digest or canonical note}}]]
confidence: high
steward: {{agent|team}}
---

# Decision

What was chosen.

# Context

Why this decision had to be made.

# Consequences

- positive:
- negative:
- follow-up:

# Evidence And References

- [[{{supporting note}}]]
```

## Minimal Validation Pass

Before treating a template-derived note as complete, verify:

1. frontmatter still parses
2. `twin_kind` and `twin_mode` match the body's actual job
3. lineage fields are present when claims depend on source material
4. section headings still help future retrieval instead of adding noise
5. the note became easier to reuse, not just longer

## Relationship To Neighbor Documents

- `OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md` defines the write boundary.
- `OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md` defines the minimum metadata contract.
- `OBSIDIAN_DIGITAL_TWIN_INGEST_WORKFLOW.md` defines when each template should be used in the ingest loop.
