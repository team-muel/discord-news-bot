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

export type RegexPatternValidationIssue = 'empty' | 'too-long' | 'redos-suspect' | 'invalid-regex';

export type RegexPatternValidationResult =
  | { ok: true; pattern: string }
  | { ok: false; pattern: string; issue: RegexPatternValidationIssue; message: string };

const REDOS_SUSPECT_RE = /([+*]|\{[0-9,]+\})\s*\)\s*[+*?]|\(\?=.*[+*].*\)\s*[+*]/;

export const validateSafeRegexPattern = (
  value: unknown,
  options?: { label?: string; maxLength?: number; allowEmpty?: boolean },
): RegexPatternValidationResult => {
  const label = String(options?.label || 'pattern').trim() || 'pattern';
  const maxLength = Math.max(1, Math.trunc(Number(options?.maxLength) || 240));
  const allowEmpty = options?.allowEmpty === true;
  const pattern = String(value || '').trim();

  if (!pattern) {
    return allowEmpty
      ? { ok: true, pattern }
      : { ok: false, pattern, issue: 'empty', message: `${label} is required` };
  }

  if (pattern.length > maxLength) {
    return {
      ok: false,
      pattern,
      issue: 'too-long',
      message: `${label} must be ${maxLength} characters or fewer`,
    };
  }

  if (REDOS_SUSPECT_RE.test(pattern)) {
    return {
      ok: false,
      pattern,
      issue: 'redos-suspect',
      message: `${label} looks unsafe for regex execution`,
    };
  }

  try {
    void new RegExp(pattern, 'i');
    return { ok: true, pattern };
  } catch {
    return {
      ok: false,
      pattern,
      issue: 'invalid-regex',
      message: `${label} is not a valid regex`,
    };
  }
};

export const validateTaskRoutingSignalPattern = (value: unknown): RegexPatternValidationResult => {
  return validateSafeRegexPattern(value, {
    label: 'signalPattern',
    maxLength: 180,
  });
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
