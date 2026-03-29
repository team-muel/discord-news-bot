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
