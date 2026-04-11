# Tool-First Knowledge Contracts

Status: Reference/control baseline (2026-04-11)
Execution note: This contract is a shared-control reference, not a parallel WIP board. Use `EXECUTION_BOARD.md`, `docs/CHANGELOG-ARCH.md`, and development slices for rollout state.

## Objective

Reduce agent dependence on manual prompt/instruction tuning by giving the IDE agent a small set of high-level MCP tools that compile shared knowledge, runtime state, and local repository context into reusable artifacts.

The design target is not a repo-local helper only. The shared MCP server is also a team-shared and company-internal surface that may carry internal knowledge, internal runbooks, and intranet-adjacent context.

This document assumes a practical constraint:

- the shared Obsidian vault is authoritative when it has relevant content
- the shared Obsidian vault is currently incomplete for repository and development context
- the shared MCP server may expose useful internal knowledge outside the current repository even when Obsidian coverage is thin
- the answer is not to abandon MCP/Obsidian-first, but to build tools that compensate for sparse knowledge and progressively promote verified findings into shared surfaces

## Problem Statement

Current agent behavior still risks collapsing into a low-level loop:

1. search local markdown
2. read multiple files
3. manually synthesize
4. lose the synthesis after the session

This is expensive, inconsistent, and pushes too much burden onto agent customization.

The desired posture is different:

1. ask a high-level MCP tool for the relevant bundle or snapshot
2. let the tool gather shared Obsidian, runtime, docs, and local overlay context in a fixed order
3. return a structured result with provenance and gaps
4. promote durable findings back into shared knowledge when appropriate
5. capture durable repo memory and changelog-worthy changes into shared wiki objects instead of leaving them only in local compatibility artifacts

## Design Principles

1. Obsidian-first means MCP-mediated shared Obsidian-first, not raw local vault reads as the initial path.
2. The shared MCP server should be treated as a common team/company knowledge surface, not only as a repo utility endpoint.
3. Sparse shared knowledge is an expected starting condition, not an exception.
4. High-level tools should hide multi-step archaeology from the agent.
5. Every tool should return provenance and explicit gaps, not only prose summaries.
6. When a workflow repeats, convert it into a tool contract instead of refining prompts indefinitely.
7. Repo memory and changelog mirrors should be treated as promotion sources and compatibility views, not as the only semantic owner of durable change knowledge.
8. If a user explicitly provides an article, URL, note, or prior discussion as implementation input, the resulting tool output should keep that source visible in provenance before code work begins.

## Source Precedence

All high-level knowledge tools should use the same source order unless a tool overrides it explicitly.

1. Shared Obsidian / shared MCP knowledge surfaces via `gcpCompute`
2. Other internal knowledge and intranet-adjacent surfaces exposed via the shared MCP server
3. Structured runtime and operator surfaces
4. Canonical repository docs and contracts
5. Shared code-index/context bundle
6. Local dirty-workspace overlay

Interpretation:

- Layer 1 is preferred because it captures shared intent and operator-visible truth.
- Layer 2 captures team-shared and company-internal context that may not yet be promoted into Obsidian.
- Layers 3 to 5 are compensating layers when the shared knowledge surface is incomplete.
- Layer 6 exists to explain current local deltas, not to replace shared truth.

Rule:

- explicit user-provided sources do not override source precedence, but they do remain attached in provenance when they materially triggered the task

## Human-Visible Provenance

The provenance fields emitted by high-level tools are not only for internal agent reasoning.

They are also the human-visible review surface for operators and teammates using the same shared MCP and Obsidian stack.

Therefore:

- `artifacts[]`, `sources[]`, and `sourceRefs[]` should be renderable as a knowledge-panel-style source list
- implementation-driving user inputs should appear there even when the answer is later grounded by shared wiki notes
- the shared MCP path should preserve organizational traceability across team members, not just single-agent convenience

## Proposed High-Level MCP Contracts

### 1. `knowledge.bundle.compile`

Purpose:

- Return the minimum structured knowledge bundle needed to answer a repo, plan, or architecture question.

Inputs:

- `goal`: the user question or task objective
- `domains[]`: optional hints such as `planning`, `requirements`, `ops`, `architecture`, `memory`
- `sourceHints[]`: optional hints such as `obsidian`, `internal-docs`, `runtime`, `repo-docs`, `local-overlay`
- `includeLocalOverlay`: optional boolean
- `maxArtifacts`: optional integer

Outputs:

- `summary`
- `facts[]`: normalized facts with source and confidence
- `artifacts[]`: relevant notes, docs, runtime snapshots, or code bundles
- `gaps[]`: what is still missing from shared knowledge
- `recommendedPromotions[]`: artifacts that should be written back into Obsidian or another shared surface

Behavior:

- Try shared Obsidian first.
- If insufficient, compile from internal knowledge surfaces, canonical docs, runtime surfaces, and code index.
- Use local file reads only as the final overlay.
- If the triggering request includes explicit user-provided URLs, articles, or note identifiers, keep them visible in `artifacts[]` or fact provenance before implementation proceeds.

### 2. `internal.knowledge.resolve`

Purpose:

- Resolve company-internal docs, internal runbooks, internal note identifiers, and intranet-adjacent knowledge into a structured bundle before the agent falls back to repo-local archaeology.

Inputs:

- `goal`
- `targets[]`: optional internal URLs, note identifiers, service names, or knowledge keys
- `audience`: optional string such as `engineering`, `ops`, `leadership`
- `includeRelatedArtifacts`: optional boolean

Outputs:

- `summary`
- `facts[]`
- `artifacts[]`
- `redactions[]`
- `accessNotes[]`
- `gaps[]`

Behavior:

- Query only shared/internal MCP surfaces first.
- Return explicit access or visibility gaps instead of silently degrading into local repo-only guesses.

### 3. `operator.snapshot`

Purpose:

- Return a normalized control-plane view of the current system state so the agent does not need to manually inspect multiple runtime endpoints and docs.

Inputs:

- `guildId`: optional
- `includeDocs`: optional boolean
- `includeRuntime`: optional boolean
- `includePendingIntents`: optional boolean

Outputs:

- `status`
- `loops`
- `workers`
- `providers`
- `activeMilestones`
- `knownBlockers[]`
- `sources[]`

Behavior:

- Prefer runtime control-plane endpoints and shared operator notes.
- Attach only the smallest set of supporting documents needed for explanation.

### 4. `requirement.compile`

Purpose:

- Convert URLs, repo context, and user intent into a structured requirement object without forcing the agent to manually scrape and reframe everything in chat.

Inputs:

- `targets[]`: URLs, repo paths, or note identifiers
- `targets[]` may include internal URLs or shared knowledge identifiers exposed through MCP surfaces
- `objective`
- `domain`: optional, such as `game-ops`, `community-ops`, `tooling`, `workflow`
- `desiredArtifact`: optional, such as `plan`, `brief`, `contract`, `backlog`

Outputs:

- `problem`
- `constraints[]`
- `entities[]`
- `workflows[]`
- `capabilityGaps[]`
- `openQuestions[]`
- `recommendedNextArtifacts[]`

Behavior:

- Pull shared planning/requirement notes first.
- Pull internal knowledge surfaces when the target depends on company context.
- Use local docs and code only to fill missing structure.
- Record where the shared knowledge surface is still thin.
- Keep user-provided target URLs, articles, or chat-supplied note identifiers visible in the returned provenance so the requirement object remains reviewable by humans.

### 5. `knowledge.promote`

Purpose:

- Persist verified findings from local analysis into a shared knowledge surface so later agents do not need to rediscover them.

Inputs:

- `artifactKind`: note, requirement, ops-note, contract, retrofit, lesson
- `title`
- `content`
- `sources[]`
- `confidence`
- `tags[]`

Outputs:

- `status`
- `writtenArtifacts[]`
- `skippedReasons[]`

Behavior:

- Enforce sanitization, provenance, and minimum quality thresholds.
- Prefer shared Obsidian/MCP write paths.

### 6. `wiki.change.capture`

Purpose:

- Convert repo-local memory notes, architecture deltas, and changelog-worthy changes into shared Obsidian wiki objects plus aligned repo-visible mirrors.

Inputs:

- `changeSummary`
- `changedPaths[]`
- `changeKind`: `repo-memory|architecture-delta|service-change|ops-change|development-slice|changelog-worthy`
- `validationRefs[]`
- `mirrorTargets[]`: optional values such as `repo-memory`, `CHANGELOG-ARCH`
- `promoteImmediately`: optional boolean

Outputs:

- `classification`
- `wikiTargets[]`
- `writtenArtifacts[]`
- `mirrorUpdates[]`
- `followUps[]`
- `gaps[]`

Behavior:

- Classify the change into repository-context, decision, development-slice, service-profile, playbook, improvement, or runtime-snapshot objects.
- Write or propose shared wiki artifacts first.
- Update compatibility mirrors such as `docs/CHANGELOG-ARCH.md` only after the wiki targets are identified.

### 7. `tool.contract.scaffold`

Purpose:

- Turn a repeated manual investigation or synthesis pattern into a concrete MCP tool proposal, so the solution scales through tools rather than custom prompt labor.

Inputs:

- `workflowName`
- `goal`
- `currentSteps[]`
- `painPoints[]`
- `desiredOutput`
- `riskLevel`

Outputs:

- `toolName`
- `contract`
- `dependencies[]`
- `observabilityRequirements[]`
- `rolloutPlan[]`

Behavior:

- Identify what should move from agent behavior into a durable tool surface.
- Bias toward composite tools that absorb multi-step repo archaeology.

## Implementation Order

1. `knowledge.bundle.compile`
2. `internal.knowledge.resolve`
3. `operator.snapshot`
4. `requirement.compile`
5. `wiki.change.capture`
6. `knowledge.promote`
7. `tool.contract.scaffold`

Reasoning:

- The first five reduce day-to-day agent friction immediately.
- The sixth improves future retrieval quality.
- The seventh creates a repeatable path from pain point to new tool.

## Minimal Acceptance Criteria

1. A shared knowledge question should no longer require the agent to start with grep across local docs.
2. Team-shared or company-internal knowledge questions should check shared MCP/internal surfaces before repository-local archaeology.
3. Sparse Obsidian content should degrade gracefully into compiled bundles, not into uncontrolled file archaeology.
4. Every high-level tool should emit provenance and missing-information fields.
5. Durable repo memory and changelog-worthy changes should produce shared wiki objects plus aligned compatibility mirrors.
6. Repeated multi-step discovery patterns should produce a promotion path into shared knowledge or a new MCP contract.

## Non-Goals

1. Replacing all low-level tools.
2. Forcing the Obsidian vault to be complete before the agent becomes useful.
3. Solving agent quality primarily through more prompt customization.

## Expected Outcome

The agent becomes easier to use because the burden shifts from handcrafted agent behavior to durable MCP tools that encapsulate discovery, synthesis, and promotion workflows.

## Companion Documents

- `KNOWLEDGE_BUNDLE_COMPILE_SPEC.md`: detailed request, response, algorithm, and rollout contract for `knowledge.bundle.compile`
- `OBSIDIAN_AGENT_LEVERAGE_PRIORITIES.md`: top-five implementation order for the highest-leverage Obsidian/MCP capabilities
- `docs/planning/OBSIDIAN_SEED_OBJECTS_PRIORITY.md`: prioritized seed objects that should exist in the shared wiki to reduce repeated archaeology
