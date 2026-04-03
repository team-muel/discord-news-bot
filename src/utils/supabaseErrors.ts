/**
 * Shared Supabase / PostgREST error detection utilities.
 *
 * Centralises the logic that was previously copy-pasted across 10+ files.
 * Detection covers both native PostgreSQL error codes (42P01, 42703, 42883)
 * and PostgREST-specific codes (PGRST202, PGRST204, PGRST205).
 */

/** Normalise an error-like value into { code, message }. */
const normalise = (error: any): { code: string; message: string } => ({
  code: String(error?.code || '').trim().toUpperCase(),
  message: String(error?.message || '').toLowerCase(),
});

// ─── Relation / Table ────────────────────────────────────────────────

/**
 * Detect "table does not exist" from any Supabase / PostgREST error.
 *
 * Checks:
 *  - 42P01  (PostgreSQL: undefined_table)
 *  - PGRST205 (PostgREST: schema-cache miss – relation)
 *  - PGRST204 (PostgREST: relation not found)
 *  - message heuristics: "does not exist", "relation", "could not find",
 *    or an optional table-name needle.
 */
export const isMissingTableError = (error: any, ...tableNames: string[]): boolean => {
  const { code, message } = normalise(error);
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true;
  if (message.includes('does not exist') || message.includes('could not find')) return true;
  if (tableNames.length > 0) {
    return tableNames.some((t) => t && message.includes(t.toLowerCase()));
  }
  return false;
};

// ─── Column ──────────────────────────────────────────────────────────

/**
 * Detect "column does not exist" (42703) or PostgREST column miss.
 */
export const isMissingColumnError = (error: any, ...columnNames: string[]): boolean => {
  const { code, message } = normalise(error);
  if (code === '42703') return true;
  if (columnNames.length > 0) {
    return columnNames.some((c) => c && message.includes(c.toLowerCase()));
  }
  return false;
};

// ─── Function / RPC ──────────────────────────────────────────────────

/**
 * Detect "function does not exist" (42883) or PostgREST RPC miss (PGRST202).
 */
export const isMissingFunctionError = (error: any, ...functionNames: string[]): boolean => {
  const { code, message } = normalise(error);
  if (code === '42883' || code === 'PGRST202') return true;
  if (functionNames.length > 0) {
    return functionNames.some((f) => f && message.includes(f.toLowerCase()));
  }
  return false;
};

// ─── Composite helpers (backward-compat convenience) ─────────────────

/**
 * Superset: table missing OR column missing OR function missing.
 * Useful for services that should gracefully degrade for any schema gap.
 */
export const isSchemaUnavailableError = (error: any, ...hints: string[]): boolean =>
  isMissingTableError(error, ...hints)
  || isMissingColumnError(error, ...hints)
  || isMissingFunctionError(error, ...hints);
