---
description: "Emergency fix workflow — implement, review, and ship a hotfix quickly."
---
# Hotfix

Fix the following issue with minimal blast radius.

## Issue

{{input}}

## Instructions

1. Skip `/plan` — go directly to `/implement` for the smallest safe fix.
2. Run `/review` with `risk_level: high` to verify no regressions.
3. Run `tsc --noEmit` and `vitest run` to validate.
4. Proceed to `/ship` if all gates pass.
5. HITL: Always confirm before creating PR or deploying. This is a hotfix — extra caution required.
