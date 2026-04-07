export const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
};

export const parseIntegerEnv = (value: string | undefined, fallback: number): number => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export const parseNumberEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseBoundedNumberEnv = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = parseNumberEnv(value, fallback);
  return Math.max(min, Math.min(max, parsed));
};

/**
 * Parse an integer env var and enforce a lower bound.
 * Equivalent to Math.max(min, parseIntegerEnv(value, fallback)).
 */
export const parseMinIntEnv = (value: string | undefined, fallback: number, min: number): number =>
  Math.max(min, parseIntegerEnv(value, fallback));

/**
 * Parse a number env var and enforce a lower bound.
 * Equivalent to Math.max(min, parseNumberEnv(value, fallback)).
 */
export const parseMinNumberEnv = (value: string | undefined, fallback: number, min: number): number =>
  Math.max(min, parseNumberEnv(value, fallback));

/**
 * Return a trimmed string env var, or the fallback when the var is absent or blank.
 */
export const parseStringEnv = (value: string | undefined, fallback: string): string => {
  const trimmed = (value ?? '').trim();
  return trimmed || fallback;
};

/**
 * Return a base URL env var trimmed and stripped of trailing slashes,
 * or the fallback when the var is absent or blank.
 */
export const parseUrlEnv = (value: string | undefined, fallback: string): string => {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return trimmed || fallback;
};

/**
 * Split a comma-separated string into a trimmed, non-empty string array.
 * Handles undefined/empty input gracefully (returns []).
 */
export const parseCsvList = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
