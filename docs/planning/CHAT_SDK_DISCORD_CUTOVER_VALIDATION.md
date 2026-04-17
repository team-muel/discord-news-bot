# Chat SDK Discord Cutover Validation

Status note:

- Reference validation contract for M-24 cutover verification.
- Current gate state: boundary-definition and rollout controls are complete, and the eligible chat surfaces now have live selected-path parity, forced-fallback rollback, and runtime-green evidence for the generic ingress seam. Cutover validation has exited first-pass evidence collection; remaining work is exact-unit grace-close and later owner-change validation.
- Current execution priority remains in `EXECUTION_BOARD.md`.

## Objective

Prove that a future Chat SDK-based Discord ingress adapter can take traffic behind the same ingress contract without changing runtime ownership, operator procedure, or fallback safety.

This session validates cutover readiness. It does not design the ingress boundary, implement the adapter, or remove the legacy path.

## Non-Goals

- Defining the normalized ingress envelope itself
- Implementing the Chat SDK Discord adapter
- Removing the current Discord/OpenClaw or legacy fallback path
- Re-owning Hermes, OpenJarvis, Supabase, or Obsidian surfaces
- Expanding cutover scope beyond the currently ingress-routed Discord surfaces

## Current Baseline

Today, the live Discord ingress contract is narrower than the full bot surface.

- Slash docs surface: `/해줘` and `/뮤엘` enter through `createDocsHandlers()`, with `src/discord/runtime/commandRouter.ts` injecting `executeDocsCommandIngress()` backed by `executeDiscordIngress()`; if ingress declines, is hard-disabled, or runs in shadow mode, the existing RAG/LLM fallback in `src/discord/commands/docs.ts` continues.
- Prefixed message surface: `뮤엘 ...` in simple message mode calls `executePrefixedMessageIngress()` backed by `executeDiscordIngress()` before quick-conversation or full session fallback.
- OpenClaw ingress is optional. `openClawDiscordIngressAdapter` requires `OPENCLAW_ENABLED=true` plus gateway chat support, and it fails by returning `null` so the existing handlers continue.
- Continuity queue side effects remain in `src/discord/runtime/discordIngressAdapter.ts`, only apply to coding or automation intents, and private threads explicitly skip continuity enqueue.
- Admin, persona, task, CRM, market, and runtime-control surfaces are not part of this cutover unless the implementation session explicitly expands scope.

## Current Readiness Verdict

- Boundary-definition status: complete.
- Adapter implementation status: complete for the eligible chat surfaces. Session A and Session B are both closed for `/해줘`, `/뮤엘`, and prefixed `뮤엘 ...`; `/만들어줘` remains phase 2 and outside this window.
- Rollout-control status: core primitives and live seam evidence are complete for the eligible chat surfaces.
- Removal inventory status: the first exact-unit refresh is complete. The `docs.ask` post-ingress fallback now qualifies as rollback-only residue, while whole-file removal for `docs.ts`, `vibe.ts`, `session.ts`, and `commandRouter.ts` remains locked.
- Cutover validation status: green for the current canary window and closed for the first generic-ingress evidence gate; later preferred-adapter changes still require their own bounded validation window.
Remaining follow-ups for full owner transition:
- eligible surface 전체 default-on/100 전환은 아직 완료되지 않았다.
- rollback grace-close 종료와 legacy demotion/removal은 별도 후속 session이다.
- `/만들어줘`와 full session-progress reply/update lifecycle은 여전히 phase 2 범위다.
- prefixed `muel-message` fallback branch still needs its own production live rollback observation artifact before it can move to rollback-only.
- the latest production rerun (`2026-04-17_chat-sdk-cutover-20260417-212611.*`) refreshed live selected-owner parity for both eligible surfaces on the current `chat-sdk` canary, but the deployed internal cutover exercise route still emitted only a single forced-fallback rollback observation. Local code now supports per-surface rollback rehearsal for both eligible surfaces, so the remaining blocker is deploying that newer control-plane path and re-running the bounded live validation window.

- `src/discord/runtime/discordIngressAdapter.ts` now emits structured route-decision telemetry, per-surface rollout/holdout gating, and persisted cutover evidence snapshots under `tmp/discord-ingress-cutover/latest.json`.
- `scripts/run-chat-sdk-discord-cutover-validation.ts` now emits the md/json gate-run artifact pair under `docs/planning/gate-runs/chat-sdk-cutover/`.
- `npm run gates:discord:cutover` can now drive a real running process through the service-role protected internal cutover routes when `--applyLivePolicy=true` is passed with a reachable runtime base URL; this writes live selected-owner evidence plus forced-fallback rollback rehearsal for both eligible surfaces instead of relying only on local rehearsal.
- `npm run gates:discord:cutover` still remains local-only by default; `npm run gates:discord:cutover:dry` remains inspection-only unless explicit exercise flags are passed.
- lab rehearsal evidence may still be recorded in production, but it stays `observed-only` there and cannot satisfy the final live parity or rollback decision.
- `npm run gates:discord:cutover:lab:dry` may still accept lab evidence during a dry-run rehearsal even when dotenv resolves `NODE_ENV=production`, because the command writes no final artifact and is scoped to local rehearsal closeout only.
- latest live-go artifact: `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-212611.md`
- latest pre-chat-sdk live-go artifact for the extracted seam itself: `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-142211.md`

## Entry Criteria

All of the following must be true before cutover verification starts.

1. Boundary definition is closed and the normalized ingress envelope plus reply-adapter contract are documented.
2. The Chat SDK Discord adapter exists behind a hard-disable switch and can decline traffic without throwing user-visible failures.
3. Adapter telemetry includes, at minimum, adapter id, surface, route decision, fallback reason, guild id, and request correlation id.
4. The implementation session has added targeted tests for adapter acceptance, adapter decline, and transport failure.
5. Legacy delete candidates are identified but still present behind a grace-period boundary.
6. Operators can force rollback without modifying unrelated runtime loops or deployment ownership.

If any entry criterion is missing, this session stops with `needs-implementation` rather than generating a misleading go/no-go.

## Required Operator Controls

The validation session assumes the implementation exposes these controls. In the current repo state, `docs.ask` and prefixed `뮤엘 ...` now share preferred adapter selection, hard-disable, shadow evaluation, rollout percentage, and structured telemetry through per-surface execute handlers plus a persisted cutover evidence snapshot.

- Preferred ingress adapter selection for the eligible Discord surfaces
- Shadow or mirror mode that evaluates the Chat SDK path without making it user-visible
- Rollout percentage or holdout selection for canary expansion
- Hard-disable kill switch that restores the current path immediately
- Readiness probe for the Chat SDK transport or adapter bridge
- Structured logs or metrics that count adapter accept, adapter decline, transport error, and fallback outcomes separately

## Scope Under Validation

Only the currently ingress-routed Discord surfaces are allowed in the first cutover window.

| Surface | Current baseline | Pass condition |
| --- | --- | --- |
| `/해줘`, `/뮤엘` | docs command may prefer ingress before RAG fallback | Same permission, visibility, and fallback semantics remain intact |
| `뮤엘 ...` prefixed message | message path may prefer ingress before quick chat or full session fallback | Same reply-mode and fallback semantics remain intact |
| Private thread continuity behavior | continuity enqueue is skipped for private threads | No private-thread continuity side effect is introduced |
| OpenClaw/legacy fallback | ingress can currently return `null` and fall through | Chat SDK failure or decline must preserve deterministic fallthrough |

Everything else is a negative test: it must remain unchanged.

## Validation Axes

### 1. Behavioral Parity

Do not compare exact model wording. Compare invariants.

- correct handler ownership per surface
- correct permission and visibility behavior
- correct fallback when the preferred ingress declines or fails
- correct preservation of source refs and channel context
- correct skip-continuity behavior for private threads

### 2. User-Facing Safety

- no debug, confidence, or internal control-plane text leaks into Discord replies
- message and embed length limits stay within current bounds
- prefixed message replies remain concise and do not bypass existing sanitization expectations

### 3. Operational Stability

The cutover must not disturb the existing runtime envelope.

- `/health` and `/ready` remain healthy or intentionally degraded only
- `/api/bot/status` remains stable
- `/api/bot/agent/runtime/scheduler-policy` remains unchanged for loop ownership
- no unexpected deadletter or structured error growth caused by ingress routing

### 4. Rollback Safety

- operator can force the preferred ingress back to the current path quickly
- rollback does not require removing code in the same window
- post-rollback parity on the eligible Discord surfaces is re-verified

## Rollout Sequence

1. Shadow validation
   - Chat SDK adapter evaluates live requests for eligible surfaces, but users still receive the current path.
   - Collect parity and fallback evidence without altering user-visible ownership.
2. Canary validation
   - Start with the smallest holdout-safe percentage for eligible surfaces only.
   - Require a clean operator window before any expansion.
3. Expanded canary
   - Increase rollout only after parity, error budget, and rollback checks remain clean.
4. Full cutover with grace period
   - Keep legacy path present as a rollback target during the delete-candidate grace period.
   - Legacy removal remains a separate session.

## Abort Conditions

Any single condition below turns the run into `no-go`.

- permission or visibility regression on `/해줘`, `/뮤엘`, or `뮤엘 ...`
- private thread continuity leak
- fallback no longer returns deterministically to the current path
- `/ready` or scheduler-policy ownership degrades unexpectedly
- deadletters or structured ingress errors exceed the agreed threshold
- operator cannot force rollback quickly with the documented control

## Evidence Bundle

Store run evidence under `docs/planning/gate-runs/chat-sdk-cutover/`.

Minimum artifact set per run:

- one markdown summary
- one JSON summary
- targeted test results for Discord surfaces and adapter contract
- operator snapshot for runtime health and scheduler-policy
- rollback result when a rollback or forced fallback was exercised

### Operator Evidence Source Rules

- `operator_runtime` may use an external `/health` payload for `bot_ready` and `automation_healthy` when the validator is running away from the live process and the in-process snapshot is cold.
- Do not treat an external `/health` payload as the scheduler-policy owner surface unless it exposes `runtimeSchedulerPolicy.summary` with the canonical `{ total, appOwned, dbOwned, enabled, running }` shape.
- If that canonical scheduler summary is absent or malformed, fall back to `GET /api/bot/agent/runtime/scheduler-policy` or the in-process `getRuntimeSchedulerPolicySnapshot()` result before closing the operational-stability check.
- Lab evidence and live evidence must remain isolated. When resetting the file-backed cutover snapshot between windows or tests, persist the fresh in-memory state immediately instead of rehydrating the previous on-disk snapshot first.

The markdown or JSON summary must record at least:

- environment
- adapter id and revision
- eligible surfaces under test
- rollout percentage or shadow mode
- parity verdict per surface
- fallback verdict
- continuity/private-thread verdict
- sanitization verdict
- operator-runtime verdict
- rollback verdict
- final decision: `go` or `no-go`

See `gate-runs/chat-sdk-cutover/README.md` for the evidence layout.

## Minimum Local Gate Stack

Even before a deployment gate, the cutover validation session should run the smallest current repo-aligned checks.

1. `npm run test:discord`
2. `npx tsc --noEmit`
3. `npm run gates:validate:strict`
4. `npm run rehearsal:stage-rollback:validate:strict`

Adapter-specific tests or smoke commands from the implementation session should be added on top of these, not instead of them.

## Exit Criteria

The cutover verification session is complete only when all of the following are true.

1. Eligible Discord surfaces pass behavioral parity checks at the target rollout window.
2. Abort conditions stay clear for the agreed observation window.
3. Operator rollback is exercised or otherwise demonstrated with equivalent evidence.
4. Non-target Discord surfaces remain unchanged.
5. The session emits an explicit `go` or `no-go` artifact for the next migration session.

If the session finishes with `go`, the next session may start the legacy grace period or legacy removal work. If it finishes with `no-go`, ownership returns to the implementation session with concrete failed invariants, not generic instability notes.
