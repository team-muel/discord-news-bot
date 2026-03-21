# Multi-Agent Dry Run - 2026-03-19

Status note:

- this file is historical dry-run evidence for an older routing shape
- interpret role names here as repository-local labels, not proof of external OSS integration
- use `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md` for current name-collision and runtime-surface truth

Task ID: TASK-2026-03-19-AGENT-DRYRUN-001

Objective:

- Harden Discord deliverable sanitization for wrapped deliverable sections.
- Preserve public API shape.

Constraints:

- No schema changes
- No unrelated refactors
- Startup/auth/scheduler safety unchanged
- Preserve Obsidian graph-first retrieval behavior

## 1) Routing Result (OpenJarvis)

Classification:

- Primary: implement
- Secondary: verify, risk-review, ops-readiness

Sequence:

1. OpenDev: scope and milestone slice
2. OpenCode: minimal implementation
3. NemoClaw: regression/security/test-gap review
4. OpenJarvis: operational go/no-go and rollback readiness

Hard gates:

- Startup/auth/scheduler safety not degraded
- Graph-first Obsidian behavior preserved
- Wrapped deliverable sanitization leakage = 0

## 2) Scope Brief (OpenDev)

Likely touched surfaces:

- src/discord/session.ts
- (if strictly required) src/services/multiAgentService.ts
- tests for session sanitization behavior

Out of scope:

- API shape changes
- schema changes
- unrelated refactoring
- retrieval strategy changes

## 3) Minimal Patch Plan (OpenCode)

Planned change set:

- Strengthen wrapped deliverable extraction and sanitization in session output path.
- Keep signatures and external response contract unchanged.
- Add focused tests for wrapped header variants and debug marker stripping.

Planned validation commands:

- npm run lint
- npm run test -- src/discord/session.test.ts
- npm run test -- src/services/multiAgentService.test.ts

## 4) Defensive Review (NemoClaw)

Verdict:

- Conditional No-Go

Top risks:

- Over-sanitization can remove valid user text.
- Header/format variance can bypass extraction and leak unwanted sections.
- Session-path regression tests are mandatory before release.

Required tests before Go:

- Wrapped deliverable only output
- Normal semantic text preservation
- Header format variance coverage
- Error-path sanitization
- API shape regression safety

## 5) Operational Gate (OpenJarvis)

Verdict:

- Conditional No-Go (until evidence bundle complete)

Required evidence bundle:

- changed surfaces and non-goals
- mandatory test pass evidence
- startup/auth/scheduler non-impact confirmation
- staged handoff logs across 4 agents

Rollback path:

1. Stop rollout
2. Roll back to last known-good release
3. Run session smoke checks
4. Log incident and block re-release until root cause is addressed

First-run monitoring:

- debug marker leakage count
- wrapped deliverable sanitize miss count
- session error/timeout/retry rate
- startup/auth/scheduler baseline drift

## 6) Executable Assets Added

- .github/instructions/multi-agent-routing.instructions.md
- .github/prompts/openjarvis-route.prompt.md
- .github/prompts/opencode-implement.prompt.md
- .github/prompts/nemoclaw-review.prompt.md
- .github/prompts/opendev-validate.prompt.md

## 7) Recommended Next Step

Run the first real task using the exact sequence:
OpenDev -> OpenCode -> NemoClaw -> OpenJarvis
and attach this dry-run file as baseline evidence template.
