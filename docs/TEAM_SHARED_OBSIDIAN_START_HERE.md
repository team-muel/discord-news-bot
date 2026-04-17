# Team Shared Obsidian Start Here

## Why This Exists

- Many teammates do not have local OpenJarvis or Hermes Agent installed.
- This repository can still mention OpenJarvis, Hermes, OpenClaw, NemoClaw, or local Ollama lanes because those are real optional local or operator-specific runtime paths used in some workflows.
- Those names must not be read as a team-wide prerequisite.
- The shared collaboration contract must remain usable even when a teammate only has the repository, the shared MCP surface, and shared Obsidian.

## Team Reality

- Team-wide required surface: shared Obsidian through shared MCP, repo source docs, and operator-visible runtime endpoints.
- Optional local acceleration surface: OpenJarvis, Hermes, OpenClaw, NemoClaw, local Ollama, local n8n, and other workstation-specific tooling.
- Internal role labels such as implement, architect, review, and operate are repository-local collaboration labels. They are not proof that similarly named external tools are installed.
- If one operator runs a richer local stack, treat it as a continuity or acceleration lane. Promote only the durable rules, decisions, and workflow contracts into shared Obsidian and canonical repo docs.

## Plane Contract For Shared Onboarding

| Plane ID | What a teammate should use it for first | Canonical source | Escalate only when |
| --- | --- | --- | --- |
| `team-shared-plane` | onboarding, semantic recovery, durable team-visible meaning, local-stack-free topology recovery | this doc, shared Obsidian through shared MCP, and backfilled `ops/control-tower/*` artifacts | the question becomes deployed runtime health or workstation-only mutation |
| `service-machine` | deployed runtime truth, callable surfaces, worker ownership, operator verification | `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, and operator-visible runtime endpoints | the task explicitly requires local workstation execution |
| `local-agent-machine` | bounded local mutation, Multica issue lanes, workstation-specific validation | `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md` and local control-plane doctor or repair flows | never for baseline onboarding; only for explicit workstation work |

## Recommended Team Methodology

- Recommend the repository's gradual acceleration method as the default collaboration path instead of inventing a parallel team workflow.
- Baseline team path: shared Obsidian, shared MCP, repo source docs, and operator-visible runtime endpoints.
- Optional local accelerator path: Hermes or another local continuity runtime opens a bounded IDE session, attaches the continuity packet or compact bundle, performs bounded execution, and leaves behind a smaller reusable distillate.
- ACP packet-open is acceptable as a local bootstrap or validation transport, but ACP itself is not the shared source of truth.
- For steady-state team work, prefer the narrower bounded handoff path: compact bundle, queue objective, packet context, explicit chat launch, explicit closeout.

## Packet And Hot-State Sharing Rule

- Supabase owns hot mutable workflow state: objectives, queues, approvals, recall boundaries, workflow events, artifact refs, runtime lane, and live route state.
- Obsidian owns durable semantic meaning: handoff and progress packet mirrors, decision distillates, playbooks, retros, requirements, and onboarding context.
- A packet is a collaboration artifact class, not a third ownership plane. It can be materialized in Obsidian and generated from hot-state, but it should not become a second mutable ledger.
- ACP, VS Code chat launch, bridge logs, and other local control transports are transports only. They do not own state.
- Shared-team rule: write mutable workstream state to Supabase first when a structured runtime field exists, then project the compact delta or packet mirror into shared Obsidian.

## Shared Obsidian And Shared MCP Onboarding Contract

- Shared Obsidian is the semantic owner for onboarding context, decisions, playbooks, retros, and cross-session meaning.
- Shared MCP is the retrieval and verification transport for the team-shared plane; treat `/mcp` as the canonical shared ingress when available.
- Repo docs are the visible source and compatibility mirror that feed shared backfill; they are not a replacement for the shared semantic owner.
- A teammate without Hermes, OpenJarvis, ACP, or local models must still be able to recover the current topology from shared Obsidian, shared MCP, repo source docs, and operator-visible runtime endpoints.
- If that recovery path is missing, treat it as a documentation or backfill gap to fix in the same change window rather than silently switching to a local-only explanation.

## How To Share This With The Team

1. Share the method first through this startHere doc and shared Obsidian, not through a private local runtime setup.
2. Keep local launch manifests, temporary packet drafts, and bridge-specific glue as operator-local unless they become durable and reusable.
3. Promote team-relevant packet shapes, decision distillates, capability-demand ledgers, and workflow contracts into shared Obsidian through the repo backfill path.
4. Treat local Hermes or OpenJarvis runs as acceleration lanes that feed the shared surfaces, not as hidden team prerequisites.
5. When a teammate does not have Hermes, OpenJarvis, or ACP, they should still be able to recover the active state from shared Obsidian plus operator-visible runtime summaries.

## Shared-Only Start Here Order

1. Read this document first when onboarding or when tool ownership is unclear.
2. Read `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md` before assuming a tool name, lane, or machine is the owner surface.
3. Read `docs/RUNBOOK_MUEL_PLATFORM.md` for service-machine verification and operator procedure.
4. Read `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md` for shared MCP onboarding and team-shared access posture.
5. Read `docs/ARCHITECTURE_INDEX.md` for current repository boundaries.
6. Read `docs/planning/TEAM_SHAREABLE_USER_MEMORY.md` for collaboration preferences that should survive across sessions.
7. Read `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md` only when the task now requires local mutation or local lead-consult behavior.

## Obsidian-First Collaboration Rules

- Start shared work from shared Obsidian, not from someone else's personal local agent stack.
- When a stable rule, playbook, workflow, or architectural explanation emerges, land it in repo source docs and shared Obsidian in the same change window.
- Use shared Obsidian as the semantic owner for decisions, playbooks, retros, onboarding context, and cross-session recall.
- Treat outputs from local OpenJarvis or Hermes lanes as optional inputs or acceleration artifacts unless canonical shared docs explicitly promote them.

## What Not To Assume

- Do not assume every teammate has OpenJarvis installed.
- Do not assume every teammate has Hermes Agent or the same local model stack.
- Do not assume `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md` is required for shared onboarding; it is the local-agent-machine playbook, not the shared-plane entrypoint.
- Do not treat local prompt habits, local wrapper scripts, or personal runtime glue as team truth until they are registered in shared docs or shared Obsidian.
- Do not treat names alone as runtime truth. Verify against `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md` and operator-visible runtime surfaces.

## Definition Of Done For New Collaboration Rules

- Update always-on agent instructions when the rule affects agent behavior.
- Update a canonical repo doc when the rule affects humans or operators.
- Update `config/runtime/knowledge-backfill-catalog.json` when the rule should appear on the shared knowledge surface.
- Confirm that a teammate without a local stack can still recover plane ownership, service verification order, and shared entrypoints from the shared plane alone.
- Promote the shared Obsidian mirror before closing the same change window.
