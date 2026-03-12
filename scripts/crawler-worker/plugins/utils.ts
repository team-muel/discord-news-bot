export const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

export const dedupeByUrl = <T extends { url: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const row of rows) {
    const key = String(row.url || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }

  return out;
};

export const toPositiveLimit = (raw: unknown, fallback: number, max: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(n)));
};
