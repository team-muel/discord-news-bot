# Codebase Lightweighting Execution

This document tracks practical code-lightweighting actions while preserving unattended runtime safety.

## Goal

- Reduce app-side orchestration complexity.
- Shift repetitive maintenance and observability workloads to Supabase extension/RPC paths.
- Keep API and bot behavior equivalent or safer.

## Phase A (Already Implemented)

1. Supabase extension runtime visibility endpoints.
2. pg_cron maintenance RPC + ensure endpoint.
3. pg_trgm-backed memory hybrid search path.
4. hypopg candidate/evaluation API path.
5. LLM provider A/B logging and experiment summary path.

## Phase B (Execute Next)

1. Timer consolidation:

- Build one scheduler policy map that lists loop owner (`app` or `db`) and startup behavior.
- Keep app loops only for tasks that require Discord client context.

2. Duplicate removal:

- Collapse memory search branch logic into one pipeline with RPC-first + typed fallback.
- Remove helper wrappers that are no longer referenced after provider dispatch refactor.

3. Diagnostics consolidation:

- Standardize query tuning workflow:
  - read top SQL via pg_stat_statements
  - test hypothetical indexes via hypopg
  - apply real indexes only after measured gain threshold

## Recent Completion Delta

1. Memory search path simplified to RPC-first with resilient classic fallback only on RPC failure.
2. Legacy lifecycle startup handler removed to keep one startup path via ready workloads.
3. Lightweighting readiness now uses runtime scheduler diagnostics (not static-only flags).

## Runtime Entry

- `GET /api/bot/agent/runtime/lightweighting-plan`
- `GET /api/bot/agent/runtime/scheduler-policy`
- `GET /api/bot/agent/runtime/efficiency`
- `POST /api/bot/agent/runtime/efficiency/quick-wins`

Use this endpoint as the authoritative checklist for readiness/blocked items.
