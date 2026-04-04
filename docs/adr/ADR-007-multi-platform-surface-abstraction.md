# ADR-007: Multi-Platform Surface Abstraction

- Status: Proposed
- Date: 2026-04-04

## Background

### Current state

The bot's user-facing layer is entirely coupled to Discord via discord.js.
The `src/discord/` directory contains 24 files, and 20+ source files across the
repository import discord.js types directly. The coupling falls into three
distinct layers:

**Layer 1 — Already abstracted (no work needed)**

| File | Why it's clean |
|------|---------------|
| `messages.ts` | Pure string catalog, zero platform imports |
| `runtimePolicy.ts` | Numeric/regex config only, no discord.js dependency |
| `session.ts` (`ProgressSink`) | `{ update: (content: string) => Promise<unknown> }` — already platform-agnostic |

**Layer 2 — Abstractable (targeted refactor)**

| File | Coupling point | Abstraction path |
|------|---------------|-----------------|
| `ui.ts` | Returns discord.js embed objects directly (`{ embeds: [...] }`) | Produce a `CardSpec` IR, render to Discord embeds via a platform renderer |
| `buttonInteractions.ts` | Parses `ButtonInteraction` type, dispatches to services | Extract `actionId → service call` into a pure router; keep discord.js parsing as thin adapter |
| `passiveMemoryCapture.ts` | Consumes `Message` type | Accept a `MessageReceived` event instead |
| `automationBot.ts` | Receives `Client` directly in the services layer | Replace with a `MessageSink` interface |

**Layer 3 — Discord-permanent (coexist, never abstract away)**

| File | Why it stays |
|------|-------------|
| `gatewayPreflight.ts` | Discord REST/WebSocket health probe; no cross-platform equivalent |
| `loginAttempt.ts` | Discord token-based authentication with rate-limit handling |
| `guildLifecycle.ts` | Discord guild join/leave events → onboarding / privacy purge |
| `readyWorkloads.ts` | Starts runtime modules when the Discord client is ready |
| `bot.ts` (client init) | `Client`, `GatewayIntentBits`, `Partials` configuration |

### Chat SDK status (as of 2026-04-04)

Vercel's Chat SDK (`chat-sdk.dev`, npm `chat`) provides a cross-platform chatbot
framework with adapters for Slack, Teams, Discord, Telegram, and more. The
Discord adapter (`@chat-adapter/discord`) is currently labeled "Beta" but is
functionally stable with 402+ releases.

**Discord adapter feature matrix:**

| Feature | Support |
|---------|---------|
| Messages | Yes |
| Threads | Yes |
| Reactions | Yes |
| Cards (Embeds) | Yes |
| Buttons | Yes |
| Modals | **No** — post+edit fallback only |
| Streaming | Post+edit fallback |
| Direct Messages | Yes |
| Slash Commands | Yes |

Key limitation: `persona.ts` currently uses `ModalBuilder` / `showModal` for
user note input. Chat SDK's Discord adapter does not support modals. A post+edit
or DM-based input flow would be needed as a workaround on the Chat SDK surface.

### Obsidian CLI precedent

The Obsidian integration followed the same strategy successfully:

1. Defined `ObsidianVaultAdapter` interface during Obsidian CLI open beta
2. Built a capability-based router (`pickAdapter`) with fallback chains
3. Implemented adapters (`native-cli`, `headless-cli`, `script-cli`, `local-fs`)
4. When Obsidian CLI shipped GA (2026-04-03), the bot plugged in with minimal
   friction because the abstraction boundary was already in place

The same pattern applies here: build the abstraction boundary now while Chat SDK
is in beta, so that integration is adapter-plug-in work rather than a rewrite
when the right moment arrives.

## Decision

Introduce a **Surface Abstraction Layer** between the platform-specific surface
(`src/discord/`, future `src/slack/`, `src/web/`, etc.) and the engine layer
(`src/services/`). The abstraction consists of four components.

### 1. Card IR (Intermediate Representation)

Define platform-agnostic types in `src/surface/types.ts`:

```typescript
type CardSpec = {
  title: string;
  description: string;
  color?: number;
  fields?: FieldSpec[];
  actions?: ActionSpec[][];   // rows of buttons
  footer?: string;
};

type FieldSpec = { label: string; value: string; inline?: boolean };
type ActionSpec = {
  id: string;
  label: string;
  style: 'primary' | 'secondary' | 'danger';
  value?: string;
};
```

Refactor `ui.ts` builders (`buildSimpleEmbed`, `buildUserCard`, `buildAdminCard`)
to produce `CardSpec` objects. Add a `toDiscordEmbed(spec)` renderer in
`src/discord/renderers.ts` that converts `CardSpec` to the current discord.js
embed format. Future renderers (`toChatSdkCard`, `toSlackBlockKit`) implement the
same `CardSpec → platform message` contract.

### 2. Action Router

Extract the core dispatch logic from `buttonInteractions.ts` into a pure
function in `src/surface/actionRouter.ts`:

```typescript
type ActionEvent = {
  actionId: string;
  value: string;
  userId: string;
  guildId: string;
  isAdmin: boolean;
};

type ActionResult =
  | { kind: 'service_call'; handler: string; args: Record<string, unknown> }
  | { kind: 'open_modal'; modalId: string; data: Record<string, unknown> }
  | { kind: 'error'; message: string };

function routeAction(event: ActionEvent): ActionResult;
```

The discord.js-specific adapter parses `ButtonInteraction` into `ActionEvent`,
calls `routeAction`, and executes the result. Future platform adapters do the
same with their native event types.

### 3. Event Abstraction

Define a `PlatformEvent` union consumed by service-facing modules:

```typescript
type MessageReceived = {
  kind: 'message';
  authorId: string;
  guildId: string;
  channelId: string;
  content: string;
  isBot: boolean;
};

type ButtonClicked = {
  kind: 'button';
  actionId: string;
  value: string;
  userId: string;
  guildId: string;
  messageId: string;
};

type SlashCommandInvoked = {
  kind: 'slash_command';
  name: string;
  options: Record<string, unknown>;
  userId: string;
  guildId: string;
  channelId: string;
};

type ReactionAdded = {
  kind: 'reaction';
  emoji: string;
  userId: string;
  messageAuthorId: string;
  guildId: string;
  channelId: string;
  messageId: string;
};

type PlatformEvent = MessageReceived | ButtonClicked | SlashCommandInvoked | ReactionAdded;
```

`passiveMemoryCapture.ts` consumes `MessageReceived` instead of discord.js
`Message`. `discordReactionRewardService` consumes `ReactionAdded` instead of
raw reaction partials.

### 4. Surface Adapter Interface

Following the proven `ObsidianVaultAdapter` pattern:

```typescript
type SurfaceCapability =
  | 'send_card'
  | 'send_message'
  | 'edit_message'
  | 'open_modal'
  | 'slash_commands'
  | 'reactions'
  | 'threads'
  | 'dm';

type SurfaceAdapter = {
  id: string;
  platform: string;
  capabilities: readonly SurfaceCapability[];
  isAvailable: () => boolean;
  sendCard: (channelId: string, card: CardSpec) => Promise<string>;        // returns messageId
  sendMessage: (channelId: string, content: string) => Promise<string>;
  editMessage: (channelId: string, messageId: string, card: CardSpec) => Promise<void>;
  openModal?: (interactionRef: unknown, modalSpec: ModalSpec) => Promise<void>;
};
```

A registry (mirroring `src/services/obsidian/router.ts`) selects the adapter per
capability with fallback chains and runtime status reporting.

### 5. Ownership boundary

**Hard rule**: `src/services/` NEVER imports types from `src/discord/`,
`src/slack/`, `@chat-adapter/*`, or any platform-specific package. The dependency
arrow is strictly one-directional:

```
src/discord/  ──imports──▶  src/surface/types  ◀──imports──  src/services/
src/slack/    ──imports──▶  src/surface/types
```

Platform adapters import engine types and adapt. The engine never reaches into
platform code.

**Critical fix**: `automationBot.ts` currently lives in `src/services/` but
receives a discord.js `Client` instance directly via `startAutomationModules(client)`.
This must be refactored to accept a `MessageSink` interface:

```typescript
type MessageSink = {
  sendToChannel: (channelId: string, card: CardSpec) => Promise<void>;
  sendDm: (userId: string, content: string) => Promise<void>;
};
```

The Discord surface layer provides the concrete `MessageSink` backed by the
discord.js client. The automation service consumes only the interface.

## Rationale

### Bet on the seam, not the product

The abstraction boundary is valuable regardless of whether Chat SDK succeeds. If
Chat SDK pivots or a superior framework appears, the `CardSpec → renderer`
pattern and `SurfaceAdapter` interface work with any replacement. The investment
is in the **boundary**, not in Chat SDK specifically.

### Obsidian CLI validated this strategy

The Obsidian adapter router was built during open beta. When Obsidian CLI shipped
GA on 2026-04-03, the integration required only an adapter swap — no service
layer changes. The same economics apply to the surface layer.

### Cost profile is front-loaded and low-risk

| Phase | Files changed | Risk | Chat SDK dependency |
|-------|--------------|------|-------------------|
| A (Card IR) | 3 | Low — pure refactor, output identical | None |
| B (Action Router) | 2 | Low — extract + thin wrapper | None |
| C (Event + automationBot) | 3-4 | Medium — touches automation | None |
| D (Chat SDK integration) | 2-3 new files | High — external dependency | Yes |

Phases A-C deliver value (testability, cleaner dependency graph, readiness)
without taking on any Chat SDK dependency. Phase D is deferred until a concrete
trigger.

### Modal limitation is manageable

`persona.ts` uses modals for user note input (a single feature). On the Chat SDK
Discord surface, this degrades to a post+edit or DM prompt flow — acceptable
because note creation is low-frequency. The gateway preflight, guild lifecycle,
and other Discord-specific features coexist alongside Chat SDK; no replacement is
forced.

## Consequences

### Positive

- **Multi-platform readiness**: Adding Slack or web chat becomes an adapter
  implementation (~1 file) rather than a surface rewrite (~24 files).
- **Testability**: `CardSpec` and `ActionEvent` types can be tested without
  mocking discord.js internals.
- **Dependency hygiene**: Enforcing `src/services/ ↛ src/discord/` prevents
  future coupling drift. The `automationBot` Client leak is fixed.
- **Framework optionality**: Not locked into Chat SDK. The surface layer works
  with raw platform SDKs, Chat SDK, or any future abstraction.

### Negative

- **Indirection cost**: One additional layer between command handlers and Discord
  API. Mitigated by keeping renderers thin (pure data transforms).
- **Modal workaround**: Chat SDK Discord adapter lacks modal support. The
  persona note feature requires a fallback UX on non-Discord or Chat SDK
  surfaces.
- **Beta API risk**: Chat SDK's adapter interface may change before GA. Phase D
  must not leak Chat SDK types into `src/surface/types.ts`. All Chat SDK
  specifics stay inside `src/surface/adapters/chatSdk.ts`.

### Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Chat SDK Discord adapter breaks on update | Medium | Phase D is optional; discord.js adapter remains primary |
| Over-abstraction slows Discord-only development | Low | Card IR adds one function call; action router is same LOC |
| Chat SDK is abandoned | Low | Phases A-C have zero Chat SDK dependency; value stands alone |
| Gateway preflight / intents not supported by Chat SDK | N/A | These stay on discord.js permanently; Chat SDK handles only the card/message surface |

## Follow-ups — Implementation Roadmap

### Phase A: Card IR & Renderers

**Trigger**: Immediately after ADR acceptance.

**Entry criteria**: ADR-007 status changed to Accepted.

**Work**:
1. Create `src/surface/types.ts` with `CardSpec`, `FieldSpec`, `ActionSpec`,
   `ModalSpec` type definitions.
2. Create `src/discord/renderers.ts` with `toDiscordEmbed(spec: CardSpec)` that
   produces the current `{ embeds: [...] }` format.
3. Refactor `ui.ts` builders to produce `CardSpec`, then pipe through
   `toDiscordEmbed` at call sites.

**Exit criteria**: `tsc --noEmit` clean. All existing tests pass. No behavior
change in Discord output.

**Files**: `src/surface/types.ts` (new), `src/discord/renderers.ts` (new),
`src/discord/ui.ts` (refactor).

---

### Phase B: Action Router Extraction

**Trigger**: Can run in parallel with Phase A.

**Entry criteria**: ADR-007 accepted.

**Work**:
1. Create `src/surface/actionRouter.ts` with pure `routeAction(event)` function.
2. Refactor `buttonInteractions.ts` into a thin discord.js adapter: parse
   `ButtonInteraction` → `ActionEvent`, call `routeAction`, execute result.

**Exit criteria**: Button interaction tests pass. Action routing is testable
without discord.js mocks.

**Files**: `src/surface/actionRouter.ts` (new),
`src/discord/runtime/buttonInteractions.ts` (thin wrapper refactor).

---

### Phase C: Event Abstraction & automationBot Decoupling

**Trigger**: After Phase A completes.

**Entry criteria**: `CardSpec` types available in `src/surface/types.ts`.

**Work**:
1. Add `PlatformEvent` union and `MessageSink` types to `src/surface/types.ts`.
2. Refactor `passiveMemoryCapture.ts` to consume `MessageReceived` instead of
   discord.js `Message`.
3. Refactor `automationBot.ts` to accept `MessageSink` instead of `Client`.
   The Discord surface layer creates the concrete sink backed by the client.
4. Define `SurfaceAdapter` interface in `src/surface/types.ts`.

**Exit criteria**: `src/services/` has zero direct discord.js imports (verified
by grep). `vitest run` passes. `automationBot` receives `MessageSink` only.

**Files**: `src/surface/types.ts` (extend),
`src/discord/runtime/passiveMemoryCapture.ts` (refactor),
`src/services/automationBot.ts` (refactor),
`src/services/automation/modules.ts` (refactor if needed).

---

### Phase D: Chat SDK Integration

**Trigger**: One of the following:
- A second surface is requested (Slack, Teams, web chat), OR
- Chat SDK ships stable (post-beta) with no breaking adapter API changes.

The trigger is **need-based, not date-based**. If no second surface is needed,
Phase D can remain deferred indefinitely.

**Entry criteria**: Phases A-C complete. Target surface identified.

**Work**:
1. Add `chat`, `@chat-adapter/discord` (and/or target platform adapter),
   `@chat-adapter/state-redis` as dependencies.
2. Create `src/surface/adapters/chatSdkAdapter.ts` implementing `SurfaceAdapter`.
3. Create `src/surface/renderers/chatSdkRenderer.ts` — `CardSpec → Chat SDK
   Card JSX`.
4. Modal fallback: implement post+edit input flow for persona notes.
5. Evaluate coexistence: discord.js handles gateway preflight, guild lifecycle,
   intents. Chat SDK handles card rendering and multi-platform dispatch.
6. If replacing discord.js entirely: migrate client init, intent config, and
   webhook routing to Chat SDK. This is a separate ADR decision.

**Exit criteria**: Target surface operational. Existing Discord surface
unchanged. Integration tests cover the new surface.

**Files**: `src/surface/adapters/chatSdkAdapter.ts` (new),
`src/surface/renderers/chatSdkRenderer.ts` (new), `package.json` (deps).

---

### Coexistence model (Phases A-C vs Phase D)

```
After Phase C (no Chat SDK):                After Phase D (with Chat SDK):

┌─────────────────────────────┐             ┌─────────────────────────────┐
│  src/discord/               │             │  src/discord/               │
│  discord.js adapter         │             │  discord.js adapter         │
│  (full Discord features)    │             │  (gateway, lifecycle, etc.) │
└──────────┬──────────────────┘             └──────────┬──────────────────┘
           │                                           │
┌──────────▼──────────────────┐             ┌──────────▼──────────────────┐
│  src/surface/               │             │  src/surface/               │
│  CardSpec, ActionRouter,    │             │  CardSpec, ActionRouter,    │
│  PlatformEvent, Adapter IF  │             │  SurfaceAdapter registry    │
└──────────┬──────────────────┘             └──────────┬──────────────────┘
           │                                           │
┌──────────▼──────────────────┐             ┌──────────▼──────────────────┐
│  src/services/              │             │  src/services/              │
│  engine (unchanged)         │             │  engine (unchanged)         │
└─────────────────────────────┘             └─────────────────────────────┘
                                                       │
                                            ┌──────────▼──────────────────┐
                                            │  src/surface/adapters/      │
                                            │  chatSdkAdapter.ts          │
                                            │  (Slack, Teams, web, etc.)  │
                                            └─────────────────────────────┘
```

The engine layer is identical in both states. The abstraction investment in
Phases A-C is not wasted if Phase D never happens.
