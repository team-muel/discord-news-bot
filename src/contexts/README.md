# Contexts Layer

## Role

The contexts layer defines structured instruction/context bundles for agent and operation domains.

## Responsibilities

- Group domain-focused contextual prompts and policy surfaces.
- Keep context definitions isolated from transport/runtime wiring.

## Current Domain Buckets

- `auth.ts`: authentication/authorization context.
- `automation.ts`: automation operations context.
- `ops.ts`: operations and observability context.
- `trading.ts`: trading strategy/runtime context.

## Conventions

- Keep context files declarative.
- Avoid runtime side effects.
- Keep cross-domain references minimal.
