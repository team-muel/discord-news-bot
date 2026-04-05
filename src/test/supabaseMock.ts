import { type Mock, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared Supabase chainable mock factory for tests.
//
// Usage:
//   import { createSupabaseChain, createSupabaseMockClient } from '../../test/supabaseMock';
//
//   const chain = createSupabaseChain({ data: [...], error: null });
//   const client = createSupabaseMockClient({ data: null, error: null });
// ---------------------------------------------------------------------------

/** All PostgREST chain methods used across the codebase. */
const CHAIN_METHODS = [
  'select', 'eq', 'neq', 'in', 'or', 'not', 'is', 'ilike', 'like', 'filter',
  'gte', 'lte', 'lt', 'gt',
  'order', 'limit',
  'single', 'maybeSingle',
  'insert', 'upsert', 'update', 'delete',
] as const;

type ChainMethod = (typeof CHAIN_METHODS)[number];
type ChainResult = { data?: unknown; error?: unknown; count?: number | null };

/** Return type — every PostgREST method is a Vitest Mock. */
export type SupabaseChainMock = Record<ChainMethod, Mock> & {
  data: unknown;
  error: unknown;
  count: unknown;
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
  catch: (reject: (e: unknown) => unknown) => Promise<unknown>;
  finally: (cb: () => void) => Promise<unknown>;
};

/**
 * Create a chainable mock that mimics a Supabase PostgREST query builder.
 *
 * Every method returns `self`, so any chain like
 * `client.from('t').select('*').eq('id', 1).limit(1)` works.
 *
 * The chain is also `PromiseLike`, so `await chain` resolves to `result`.
 *
 * @param result - The `{ data, error, count? }` value returned when awaited.
 */
export const createSupabaseChain = (result: ChainResult = { data: null, error: null }): SupabaseChainMock => {
  const self: Record<string, unknown> = {
    // PromiseLike — allows `await chain` or `await chain.eq(...)`
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
    finally: (cb: () => void) => Promise.resolve(result).finally(cb),

    // Expose raw result properties for non-await access patterns
    data: result.data,
    error: result.error ?? null,
    count: result.count ?? null,
  };

  for (const method of CHAIN_METHODS) {
    self[method] = vi.fn().mockReturnValue(self);
  }

  return self as unknown as SupabaseChainMock;
};

/**
 * Create a mock Supabase client with a `from` function that returns a chain.
 *
 * @param result - Default result for all queries.
 */
export const createSupabaseMockClient = (result: ChainResult = { data: null, error: null }) => ({
  from: vi.fn(() => createSupabaseChain(result)),
  rpc: vi.fn().mockResolvedValue(result),
});

/**
 * Create a mock client where `from(tableName)` returns different chains
 * based on the table name.
 *
 * @param tableResults - Map of table name → chain result.
 * @param defaultResult - Fallback for tables not in the map.
 */
export const createSupabaseMockClientByTable = (
  tableResults: Record<string, ChainResult>,
  defaultResult: ChainResult = { data: null, error: null },
) => ({
  from: vi.fn((table: string) =>
    createSupabaseChain(tableResults[table] ?? defaultResult),
  ),
  rpc: vi.fn().mockResolvedValue(defaultResult),
});
