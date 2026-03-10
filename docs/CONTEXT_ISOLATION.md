# Context Isolation Guide

This document defines a fast path for focused edits and reviews. Use a single context entrypoint instead of scanning the full repository.

## Why This Exists

- Reduce cognitive load for non-developers and reviewers.
- Keep AI-assisted edits focused on one domain.
- Limit regression risk by touching a smaller file set.

## Context Entrypoints

- `src/contexts/automation.ts`
  - Bot automation runtime, monitor triggers, runtime alerts.
  - Use for `/admin` job controls and monitor lifecycle.
- `src/contexts/trading.ts`
  - Trading engine lifecycle, strategy config, AI order execution.
  - Use for trading cycle behavior and strategy tuning.
- `src/contexts/auth.ts`
  - Session, CSRF, auth middleware, admin allowlist checks.
  - Use for login/session security and protected API behavior.
- `src/contexts/ops.ts`
  - Shared reliability primitives: locking, rate limit, timeout, concurrency.
  - Use for scaling safety and distributed operation changes.

## Recommended Review Workflow

1. Pick one context entrypoint.
2. Follow only direct exports from that file.
3. Avoid opening unrelated services unless the change requires cross-domain behavior.
4. Run `npm run lint` after any context-level change.

## Prompting Template For AI

Use this template for focused AI edits:

```text
Work only in `<context file path>` and directly imported files.
Goal: <single behavior goal>
Constraints: no unrelated refactors; keep API compatibility unless specified.
Validation: run npm run lint.
```

## Current Domain Map

- Automation domain: `services/automationBot`, `services/newsSentimentMonitor`, `services/youtubeSubscriptionsMonitor`, `services/runtimeAlertService`
- Trading domain: `services/tradingEngine`, `services/tradingStrategyService`, `services/aiTradingClient`
- Auth domain: `middleware/auth`, `services/authService`, `services/adminAllowlistService`
- Ops primitives: `services/sourceMonitorStore`, `services/distributedLockService`, `services/supabaseRateLimitService`, `utils/network`, `utils/async`
