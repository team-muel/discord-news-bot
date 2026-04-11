---
description: "Obsidian wikiization policy — durable repo memory, architecture deltas, and changelog-worthy changes should be promoted into shared Obsidian wiki objects instead of remaining only in repo-local memory or changelog surfaces."
applyTo: "**"
---

# Obsidian Wikiization

> Durable team knowledge belongs in the shared wiki, not only in repo-local memory artifacts.

## Canonical Ownership

- Shared Obsidian through the shared MCP surface is the semantic owner for durable repo memory, architecture deltas, development archaeology, and operator-facing change history.
- Repo memory is a bootstrap and compatibility overlay for the IDE agent; it should not remain the only durable home for team-relevant facts.
- `docs/CHANGELOG-ARCH.md` is a compatibility mirror and repo-visible source artifact, not the only semantic owner of architecture-significant change history.

## Promotion Rules

- When a repository fact becomes stable and team-relevant, promote or propose promotion into shared Obsidian.
- When architecture changes materially, capture it as shared wiki objects such as a decision, development slice, service profile, playbook, or improvement note, then keep repo-visible mirrors aligned.
- When a canonical doc is added or materially updated for team/operator use, wire it into `config/runtime/knowledge-backfill-catalog.json` so the shared vault can ingest it.

## Mapping Hints

- repo memory fact → repository context, service profile, playbook, or improvement
- architecture delta → decision + development slice
- changelog-worthy runtime or ops change → development slice + service/runtime profile + optional mirror in `CHANGELOG-ARCH.md`
- recurring gotcha → playbook, improvement, or tribal knowledge source plus shared promotion when durable

## Anti-Patterns

- Do not leave durable team knowledge only in `/memories/repo`.
- Do not treat `docs/CHANGELOG-ARCH.md` as the only semantic owner of change history.
- Do not mirror every file into the vault; promote durable semantic objects instead.
