# Test Execution Guide

> Load when running QA against changed code.

## Test Commands

| Command | Purpose |
|---|---|
| `npx vitest run` | Full test suite |
| `npx vitest run <path>` | Single file or directory |
| `npx vitest run --reporter=verbose` | Detailed output per test |
| `npx tsc --noEmit` | Type-check only (no emit) |
| `node scripts/smoke-api.mjs` | API endpoint smoke tests |

## Regression Test Template

```ts
import { describe, it, expect } from 'vitest';

describe('<module> regression', () => {
  it('should <expected behavior> after fix for <bug description>', () => {
    // Arrange: setup the condition that triggered the bug
    // Act: call the function
    // Assert: verify the fix
  });
});
```

## Coverage Check

- Run `npx vitest run --coverage` to generate coverage report
- Coverage report at `coverage/lcov-report/index.html`
- No coverage regression vs main is required before `/ship`

## Common QA Surfaces

| Surface | How to Test |
|---|---|
| Discord commands | Mock interactions via test harness |
| API routes | `smoke-api.mjs` or direct HTTP calls |
| Scheduler/cron | Validate cron expressions + mock timer execution |
| Supabase queries | Mock client, verify query shape |
| LLM calls | Mock provider, verify prompt + parse response |

## Bug Fix Workflow

1. Reproduce with a failing test
2. Fix the code (minimal change)
3. Verify the test passes
4. Run full suite to check for regressions
5. Commit test + fix together (atomic)
