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
