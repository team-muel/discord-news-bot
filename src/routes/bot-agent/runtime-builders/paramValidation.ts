import { toBoundedInt, toStringParam } from '../../../utils/validation';

export const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

export const toOptionalBoundedInt = (value: unknown, max: number): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  return toBoundedInt(value, 1, { min: 1, max });
};

export const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

export const toStringArrayParam = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return dedupeStrings(value.map((entry) => toStringParam(entry)));
  }
  const normalized = toStringParam(value);
  if (!normalized) {
    return [];
  }
  return dedupeStrings(normalized.split(',').map((entry) => entry.trim()));
};

export const buildOpenJarvisAutopilotStatusParams = (query: Record<string, unknown> | null | undefined) => ({
  sessionPath: toStringParam(query?.sessionPath) || null,
  sessionId: toStringParam(query?.sessionId) || null,
  vaultPath: toStringParam(query?.vaultPath) || null,
  capacityTarget: toOptionalBoundedInt(query?.capacityTarget, 100),
  gcpCapacityRecoveryRequested: parseBool(toStringParam(query?.gcpCapacityRecovery) || undefined, false),
  runtimeLane: toStringParam(query?.runtimeLane) || null,
});