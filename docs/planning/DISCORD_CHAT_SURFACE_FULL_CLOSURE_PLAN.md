# Discord Chat Surface Full Closure Plan

Status note:

- Canonical execution plan for finishing M-24 plus the Discord slice of M-21 on the eligible chat surfaces.
- Current repo state: real Chat SDK transport now exists for `/해줘`, `/뮤엘`, and prefixed `뮤엘 ...`; the public `/만들어줘` slash surface is retired; shared user-facing sanitization exists; remaining debt is default-on and grace-close evidence plus exact-unit legacy cleanup.
- First bounded execution slice is now landed in code: `/뮤엘` entry intent, low-signal clarification, quick-chat gating, and vibe session priority share `src/discord/muelEntryPolicy.ts`.
- Second bounded execution slice is now landed in code: slash `/뮤엘` and prefixed `뮤엘 ...` full-session flows now share one reply sink contract and the same coding-intent runtime-goal normalization, so parity debt is narrowed to live owner evidence and remaining Discord-local routing ownership.
- Third bounded execution slice is now landed in code: eligible slash surface dispatch for `/해줘`, `/뮤엘`, and the legacy `/만들어줘` grace branch now lives behind one focused router helper, so `commandRouter.ts` no longer owns those product-routing branches inline.
- This document turns "resolve all of it" into one bounded program. It does not authorize a single mass-delete patch or skipping live evidence gates.

## Objective

Close the eligible Discord chat surface program end-to-end so transport, policy, and cleanup converge without reopening the ingress boundary or continuing indefinite point-fix churn.

## Non-Goals

- move admin, persona, task, CRM, market, or runtime-control surfaces into the first closure wave
- replace the Discord.js bot lifecycle, slash registration, or gateway ownership
- reintroduce a dedicated public `/만들어줘` surface
- delete exact units before live selected-path and rollback evidence closes for that exact unit
- change Hermes, Supabase, Obsidian, OpenJarvis, or OpenClaw ownership boundaries

## Program Decision

- Keep the extracted ingress seam. `executeDiscordIngress()`, `executeDocsCommandIngress()`, `executePrefixedMessageIngress()`, `chatSdkRuntime.ts`, and `streamSessionProgress()` are the right assets to build on.
- Remove adapter-layer product policy. Discord entry modules should stop owning session-intent detection, low-signal triage, and deliberation policy as scattered local heuristics.
- Keep deletion evidence-driven. "Full resolution" means one continuous bounded lane with ordered gates, not one risky rewrite.
- Freeze the public surface now: `/뮤엘` is the canonical public entry, `/해줘` remains the compatibility ask alias, and prefixed `뮤엘 ...` remains the message entry.

## Current Problem Map

| Cluster | Current anchors | Why it still blocks closure | Target state |
| --- | --- | --- | --- |
| Transport owner not fully closed | `src/discord/runtime/discordIngressAdapter.ts`, `src/discord/runtime/chatSdkRuntime.ts`, `src/discord/runtime/commandRouter.ts` | The eligible surfaces have live canary evidence, but default-on/100, grace-close, and exact-unit rollback evidence are not fully closed | Eligible surfaces run default-on through the extracted owner path with explicit rollback artifacts for each exact unit |
| Product policy hardcoded in Discord modules | `src/discord/runtime/eligibleChatSurfaceRouter.ts`, `src/discord/commands/vibe.ts`, `src/discord/session.ts` | Eligible-surface routing is smaller than before, but build/session posture and reply behavior still live across Discord modules instead of one transport-neutral owner | One shared transport-neutral classifier or policy service owns session-intent, low-signal triage, and deliberation posture |
| User-facing safety must stay single-source | `src/discord/userFacingSanitizer.ts`, `src/discord/runtime/discordIngressAdapter.ts`, `src/discord/commands/vibe.ts`, `src/discord/session.ts` | The repo already had multiple leak paths; closure fails if sanitization drifts back into per-surface fixes | All Discord user-facing reply paths call one shared sanitizer plus one shared regression suite |
| Legacy residue is still mixed with live ownership | `src/discord/commands/docs.ts`, `src/discord/commands/vibe.ts`, `src/discord/session.ts`, `src/discord/runtime/commandRouter.ts`, `docs/planning/LEGACY_CLEANUP_LANE.md` | Only one exact unit is currently rollback-only; the rest stay locked because the remaining proof is not closed yet | Exact units move through Keep-For-Now -> Rollback-Only -> Remove-Now with explicit artifacts and no neighboring-surface inference |

## Keep / Consolidate / Remove

Keep:

- `executeDiscordIngress()` and the per-surface injection pattern
- `chatSdkRuntime.ts` as the real eligible-surface transport path
- `streamSessionProgress()` as the reusable progress surface
- `userFacingSanitizer.ts` as the single user-facing safety layer

Consolidate:

- `/뮤엘` doc versus session intent routing
- low-signal mention or slash triage
- session priority or deliberation selection
- quick reply versus full-session gating for the eligible chat surfaces

Remove when gates open:

- literal stale `/만들어줘` grace fallback in the router
- exact-unit legacy fallback blocks that remain only for rollback
- any duplicate debug-strip or sanitization logic outside the shared helper

## Ordered Workstreams

### 1. Freeze Invariants

- Do not add new Discord-only routing heuristics outside the shared policy surface.
- Do not add a new public slash command for build or automation work.
- Keep all user-facing Discord reply shaping behind the shared sanitizer.
- Treat `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md` and `docs/planning/LEGACY_CLEANUP_LANE.md` as gate documents, not as places to invent new policy.

### 2. Extract Transport-Neutral Decision Logic

- Consolidate `isMuelSessionIntent()`, low-signal or noise detection, quick-reply gating, and `resolveVibeSessionPriority()` behind one shared classifier or policy service.
- Reuse `src/services/taskRoutingService.ts` as the routing signal owner instead of letting `commandRouter.ts`, `vibe.ts`, and `session.ts` keep independent policy branches.
- Keep Discord modules as callers that bind envelopes, reply sinks, and Discord-only side effects, not as the product-policy owners.

Exit criteria:

- changing `/뮤엘` routing or latency posture touches one policy surface instead of three Discord modules
- the eligible Discord modules no longer define independent regex policy for the same routing question

### 3. Close Session-Progress Transport Parity

- Finish the build or automation reply and update lifecycle on top of the existing sink and session-progress surfaces.
- Make slash `/뮤엘` build requests and prefixed `뮤엘 ...` build requests obey the same `ack -> updateProgress -> final -> followUp` contract as the ask surface where applicable.
- Keep the retired `/만들어줘` surface out of scope; phase 2 parity is about transport-neutral progress ownership, not about restoring that public command.

Exit criteria:

- session-progress closeout no longer depends on any dedicated `/만들어줘` transport
- eligible build or automation flows have one canonical reply-update contract

### 4. Drive Default-On And Evidence Closeout

- Expand the `chat-sdk` selected owner for the eligible surfaces to full default-on or 100 percent once parity is clean.
- Collect selected-path parity plus forced-fallback rollback artifacts for both `docs-command` and `muel-message`.
- Close one clean slash re-registration window after `/만들어줘` retirement before deleting any grace-only compatibility branch.

Exit criteria:

- both eligible surfaces have live selected-path and rollback artifacts in `docs/planning/gate-runs/chat-sdk-cutover/`
- the cutover validation doc stays green for the real owner path, not just the generic seam

### 5. Execute Exact-Unit Legacy Cleanup

- Refresh the removal inventory against the latest live code and artifacts.
- Move exact units from Keep-For-Now to Rollback-Only to Remove-Now only when the exact surface evidence is closed.
- Remove the stale `/만들어줘` router grace branch after the re-registration window is verified closed.
- Remove exact fallback units in `docs.ts`, `vibe.ts`, `session.ts`, and `commandRouter.ts` only after the cleanup lane opens them explicitly.

Exit criteria:

- `docs/planning/LEGACY_CLEANUP_LANE.md` cites only still-live compatibility residue
- exact units that are no longer rollback owners are removed, not merely relabeled

### 6. Simplify Post-Close Discord Ownership

- Reduce `commandRouter.ts` to transport registration, non-chat runtime wiring, and surface dispatch that remains truly Discord-native.
- Keep reusable transport-neutral assets instead of deleting them just because the first migration wave is closed.
- Sync the execution board, cutover validation doc, cleanup lane, and shared backfill coverage in the same closure window.

Exit criteria:

- eligible chat-surface behavior is governed by shared policy plus extracted ingress seams, not by Discord-local product logic
- remaining Discord-native files are transport or platform shells, not mixed transport plus business-policy files

## Mandatory Gates Per Closure Step

- `npm run test:discord`
- `npx tsc --noEmit`
- `npm run gates:discord:cutover` or the explicit bounded live equivalent
- targeted regression coverage for user-facing sanitizer behavior, low-signal gating, `/뮤엘` build absorption, and session-progress parity
- inventory refresh in `docs/planning/LEGACY_CLEANUP_LANE.md` before any deletion patch
- execution board and shared-knowledge backfill sync in the same change window when a canonical boundary changes

## Program Exit Criteria

- `/뮤엘` is the single public build or question entry and the stale `/만들어줘` grace logic is removed
- eligible chat surfaces run default-on through the extracted owner path with live rollback evidence archived for the exact remaining units
- no Discord user-facing path can emit prompt compiler, intent tag, directive, FinOps, RAG, or route metadata
- `commandRouter.ts`, `vibe.ts`, and `session.ts` no longer own separate routing or deliberation heuristics for the same eligible-surface decision
- `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md` and `docs/planning/LEGACY_CLEANUP_LANE.md` both move from “pending closure work” to “closed or exact remaining residue only” for the eligible chat surfaces

## First Bounded Execution Slice

Do this first before further surface cleanup:

1. extract one shared eligible-surface policy helper that owns session-intent detection, low-signal triage, and priority posture
2. rewire `commandRouter.ts`, `vibe.ts`, and `session.ts` to consume that helper
3. rerun Discord regression coverage and typecheck
4. then resume default-on or grace-close work from the cutover lane

Reason:

- this is the smallest slice that removes the current hardcoded product-policy drift without destabilizing the already-valid transport seam
- it lowers the cost of every later latency, UX, and cleanup adjustment in the same program
