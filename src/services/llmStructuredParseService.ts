type StructuredRecord = Record<string, unknown>;

const JSON_BRACE_BLOCK = /\{[\s\S]*\}/;
const KV_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(.+)$/;
const KV_INLINE_PATTERN = /([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*([^,;\n]+)/g;

const stripWrappingQuotes = (value: string): string => {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
};

const normalizeKey = (key: string): string => String(key || '').trim().toLowerCase();

const parseNumericIfPossible = (value: string): unknown => {
  const text = stripWrappingQuotes(value);
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return text;
};

const parseJsonObject = (raw: string): StructuredRecord | null => {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StructuredRecord;
    }
  } catch {
    // Try extracting brace block below.
  }

  const block = text.match(JSON_BRACE_BLOCK)?.[0];
  if (!block) {
    return null;
  }

  try {
    const parsed = JSON.parse(block);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StructuredRecord;
    }
  } catch {
    return null;
  }

  return null;
};

const parseKeyValueFallback = (raw: string): StructuredRecord | null => {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  const result: StructuredRecord = {};
  const lines = text.split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim().replace(/^[-*]\s*/, '');
    if (!line) continue;
    const lineMatch = line.match(KV_LINE_PATTERN);
    if (!lineMatch) continue;
    const key = normalizeKey(lineMatch[1]);
    if (!key) continue;
    result[key] = parseNumericIfPossible(lineMatch[2]);
  }

  if (Object.keys(result).length > 0) {
    return result;
  }

  const inlineMatches = text.matchAll(KV_INLINE_PATTERN);
  for (const match of inlineMatches) {
    const key = normalizeKey(match[1]);
    if (!key) continue;
    result[key] = parseNumericIfPossible(match[2]);
  }

  return Object.keys(result).length > 0 ? result : null;
};

export const parseLlmStructuredRecord = (raw: string): StructuredRecord | null => {
  const jsonRecord = parseJsonObject(raw);
  if (jsonRecord) {
    return jsonRecord;
  }

  return parseKeyValueFallback(raw);
};
