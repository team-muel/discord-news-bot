export const toStringParam = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
};

export const toBoundedInt = (
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number },
): number => {
  // Guard against Number('') → 0 and Number(null) → 0
  if (value === '' || value === null || value === undefined) return fallback;
  const numeric = Number(value);
  let parsed = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;

  if (options?.min !== undefined) {
    parsed = Math.max(options.min, parsed);
  }
  if (options?.max !== undefined) {
    parsed = Math.min(options.max, parsed);
  }

  return parsed;
};

export const isOneOf = <T extends string>(value: string, options: readonly T[]): value is T => {
  return (options as readonly string[]).includes(value);
};

const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Strip prototype-pollution keys from a plain object.
 * Returns a shallow copy without `__proto__`, `constructor`, or `prototype` keys.
 */
export const sanitizeRecord = (
  value: unknown,
): Record<string, unknown> | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!PROTO_KEYS.has(k)) {
      out[k] = v;
    }
  }
  return out;
};

/**
 * Parse a numeric value from user input with NaN safety.
 * Returns fallback if the value is not a finite number.
 */
export const toFiniteNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
