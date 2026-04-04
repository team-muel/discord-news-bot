# Test Patterns for This Repo

> Load this reference when writing or modifying tests.

## Framework

- Vitest (ESM mode) — `vitest.config.ts` at repo root
- Run: `npx vitest run` (all), `npx vitest run <path>` (targeted)

## Mock Patterns

- Use `vi.hoisted()` for mock values referenced inside `vi.mock()` factories (hoisting issue)
- Never reference top-level `const` inside `vi.mock()` — causes `ReferenceError`
- For dynamic mocking: `vi.doMock()` (not hoisted, runs in order)

```ts
// Correct pattern
const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));
vi.mock('./myModule', () => ({ myExport: mockFn }));
```

## Assertion Conventions

- Prefer `expect(x).toBe(y)` for primitives, `expect(x).toEqual(y)` for objects
- Use `toMatchObject` for partial shape assertions
- Always assert both success and error paths

## File Organization

- Test files live next to source: `src/services/foo.ts` → `src/services/foo.test.ts`
- Integration tests in `src/__tests__/` if they span multiple services
- Smoke tests via `scripts/smoke-api.mjs`

## Common Pitfalls

- `Number('')` returns `0` — use `resolveMetric` helper for metric conversions
- ESM: no `__dirname` — use `fileURLToPath` pattern
- Supabase mocks: always mock at the client level, not at the HTTP level
