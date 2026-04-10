---
title: "Repository Context - team-muel/discord-news-bot"
canonical_key: "repository_context:team-muel/discord-news-bot"
object_type: "repository_context"
status: "active"
created: "2026-04-10T00:00:00Z"
updated: "2026-04-10T00:00:00Z"
tags:
  - repo-context
  - development-archaeology
  - control-plane
  - discord-news-bot
source_refs:
  - ".github/copilot-instructions.md"
  - "docs/ARCHITECTURE_INDEX.md"
  - "docs/planning/OBSIDIAN_DEVELOPMENT_ARCHAEOLOGY.md"
supersedes: []
repo_key: "team-muel/discord-news-bot"
repo_owner: "team-muel"
repo_name: "discord-news-bot"
repo_role: "primary-control-and-runtime-repo"
integration_surfaces:
  - "Discord bot runtime and scheduler"
  - "Express API and agent routes"
  - "Supabase-backed memory and sprint state"
  - "Obsidian vault control plane"
  - "Shared MCP and external tool routing"
---

## Repository Context - team-muel/discord-news-bot

## Purpose

This note is the stable wiki object for the repository itself.

Use it when the team needs one semantic home for:

- what this repo owns
- which runtime surfaces it controls
- which service profiles and plans describe its current behavior
- where future external repo contexts should attach

## Role In The Platform

This repository is the primary operating repo for:

- Discord bot runtime behavior
- API and worker orchestration entrypoints
- Obsidian operating-model contracts
- shared/team MCP routing and operator guidance
- planning, roadmap, and sprint execution governance

## Canonical Entry Points

- Architecture baseline: `docs/ARCHITECTURE_INDEX.md`
- Runtime name/surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`
- Operating cadence and runbook: `docs/OPERATIONS_24_7.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Obsidian operating model: `docs/planning/OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md`, `docs/planning/OBSIDIAN_OBJECT_MODEL.md`, `docs/planning/OBSIDIAN_TRANSITION_PLAN.md`, `docs/planning/OBSIDIAN_DEVELOPMENT_ARCHAEOLOGY.md`

## Linked Local Service Context

- `ops/services/unified-mcp/PROFILE.md` - shared MCP and Obsidian adapter operating context
- `ops/services/gcp-worker/PROFILE.md` - remote worker execution context
- `ops/services/openjarvis/PROFILE.md` - OSS integration service context

## Team Repeatability Contract

The team can perform the same wikiization workflow because the semantic sources live in the repository and the vault note is derived from the backfill catalog.

Minimum repeat path:

1. pull `main`
2. run `npm run obsidian:backfill:system:report -- --json`
3. backfill the needed catalog entry with `npm run obsidian:backfill:system -- --entry <id>` or run the full catalog
4. confirm the target note appears in the synced Obsidian vault

This keeps the shared wiki process repo-tracked, auditable, and reproducible by other operators.

## External Repo Attachment Rule

When a second repository becomes operationally relevant, create another repository-context note and link it from here only if this repo depends on it for runtime, planning, or control-surface behavior.

Do not use this page as a dumping ground for every upstream reference.

## Current Development Slice Link

- `plans/development/2026-04-10_obsidian-development-archaeology-wikiization.md` - first archaeology seeding slice for repo-wide wikiization
