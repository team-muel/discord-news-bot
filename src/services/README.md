# Services Layer

## Role

The services layer owns business logic, integration calls, and runtime orchestration.

## Responsibilities

- Implement domain operations for auth, automation, trading, and agents.
- Encapsulate third-party integration details (Supabase, Discord, LLM, market sources).
- Offer reusable units called by routes and bot runtime.

## Non-Responsibilities

- HTTP route declaration.
- Discord slash command declaration details (kept in bot runtime layer).

## Dependency Guidance

- Routes and bot runtime may depend on services.
- Service-to-service calls should stay within clear domain boundaries.
- Shared infra adapters should be centralized (e.g. supabase client wrappers).

## Operational Notes

- Runtime-critical modules include automation, trading engine, and runtime alerts.
- Distributed coordination and rate limiting should remain behind service abstractions.
