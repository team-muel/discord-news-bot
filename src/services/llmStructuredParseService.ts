import {
  normalizeAnalysisVerdict,
  normalizeDiscoveryResult,
  type AnalysisVerdict,
  type DiscoveryResult,
} from './securityCandidateContract';

type StructuredRecord = Record<string, unknown>;
type StructuredValue = StructuredRecord | unknown[];

const JSON_BRACE_BLOCK = /\{[\s\S]*\}/;
const JSON_ARRAY_BLOCK = /\[[\s\S]*\]/;
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

const parseJsonValue = (raw: string): StructuredValue | null => {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed as StructuredValue;
    }
  } catch {
    // Try extracting object/array block below.
  }

  const objectBlock = text.match(JSON_BRACE_BLOCK)?.[0];
  if (objectBlock) {
    try {
      const parsed = JSON.parse(objectBlock);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as StructuredRecord;
      }
    } catch {
      // Try array block below.
    }
  }

  const arrayBlock = text.match(JSON_ARRAY_BLOCK)?.[0];
  if (!arrayBlock) {
    return null;
  }

  try {
    const parsed = JSON.parse(arrayBlock);
    if (Array.isArray(parsed)) {
      return parsed;
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
  const parsedValue = parseJsonValue(raw);
  if (parsedValue && !Array.isArray(parsedValue)) {
    return parsedValue;
  }

  return parseKeyValueFallback(raw);
};

export const parseLlmStructuredValue = (raw: string): StructuredValue | null => {
  const parsedValue = parseJsonValue(raw);
  if (parsedValue) {
    return parsedValue;
  }

  return parseKeyValueFallback(raw);
};

export const parseLlmStructuredArray = (raw: string): unknown[] | null => {
  const parsedValue = parseJsonValue(raw);
  if (Array.isArray(parsedValue)) {
    return parsedValue;
  }
  return null;
};

export const parseLlmNormalized = <T>(raw: string, normalize: (value: unknown) => T): T | null => {
  const parsedValue = parseLlmStructuredValue(raw);
  if (!parsedValue) {
    return null;
  }

  try {
    return normalize(parsedValue);
  } catch {
    return null;
  }
};

export const parseLlmDiscoveryResult = (raw: string): DiscoveryResult | null => {
  return parseLlmNormalized(raw, normalizeDiscoveryResult);
};

export const parseLlmAnalysisVerdict = (raw: string): AnalysisVerdict | null => {
  return parseLlmNormalized(raw, normalizeAnalysisVerdict);
};
