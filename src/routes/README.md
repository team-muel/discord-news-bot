# Routes Layer

## Role

The routes layer exposes HTTP contracts and performs request-level orchestration.

## Responsibilities

- Define endpoint shape (path/method/status payload).
- Apply middleware boundaries (auth/admin/rate-limit).
- Validate and normalize request input.
- Delegate business logic to services.

## Non-Responsibilities

- Direct infra management.
- Long-running orchestration.
- Business state ownership.

## Dependencies

- `src/middleware/*` for auth/rate-limit guards.
- `src/services/*` for domain actions.
- Shared contracts/types from `src/contracts/*` and `src/types/*`.

## Conventions

- Keep handlers thin; prefer service calls.
- Keep HTTP-specific concerns in route files.
- Avoid cross-router imports.
