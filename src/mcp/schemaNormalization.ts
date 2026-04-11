import type { McpToolSpec } from './types';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const hasSchemaType = (schema: Record<string, unknown>, targetType: string): boolean => {
  const rawType = schema.type;
  return rawType === targetType || (Array.isArray(rawType) && rawType.includes(targetType));
};

const normalizeSchemaMap = (value: unknown): Record<string, unknown> => {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeSchemaNode(entry)]),
  );
};

const normalizeSchemaNode = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map((entry) => normalizeSchemaNode(entry));
  }

  if (!isPlainObject(node)) {
    return node;
  }

  const normalized: Record<string, unknown> = { ...node };

  if (hasSchemaType(normalized, 'array')) {
    const rawItems = normalized.items;
    if (Array.isArray(rawItems)) {
      normalized.items = rawItems.map((entry) => (isPlainObject(entry) ? normalizeSchemaNode(entry) : {}));
    } else if (isPlainObject(rawItems)) {
      normalized.items = normalizeSchemaNode(rawItems);
    } else {
      normalized.items = {};
    }
  }

  if (hasSchemaType(normalized, 'object')) {
    normalized.properties = normalizeSchemaMap(normalized.properties);
  }

  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const) {
    if (Array.isArray(normalized[keyword])) {
      normalized[keyword] = normalized[keyword].map((entry) => (isPlainObject(entry) ? normalizeSchemaNode(entry) : {}));
    }
  }

  for (const keyword of ['contains', 'not', 'if', 'then', 'else'] as const) {
    if (isPlainObject(normalized[keyword])) {
      normalized[keyword] = normalizeSchemaNode(normalized[keyword]);
    }
  }

  if (isPlainObject(normalized.additionalProperties)) {
    normalized.additionalProperties = normalizeSchemaNode(normalized.additionalProperties);
  }

  if (isPlainObject(normalized.$defs)) {
    normalized.$defs = normalizeSchemaMap(normalized.$defs);
  }

  if (isPlainObject(normalized.definitions)) {
    normalized.definitions = normalizeSchemaMap(normalized.definitions);
  }

  return normalized;
};

export const normalizeMcpInputSchema = (schema: unknown): McpToolSpec['inputSchema'] => {
  const normalizedRoot = isPlainObject(schema)
    ? normalizeSchemaNode(schema)
    : { type: 'object', properties: {} };
  const normalizedObject = isPlainObject(normalizedRoot)
    ? { ...normalizedRoot }
    : { type: 'object', properties: {} };

  if (!hasSchemaType(normalizedObject, 'object')) {
    normalizedObject.type = 'object';
  }

  normalizedObject.properties = normalizeSchemaMap(normalizedObject.properties);

  return normalizedObject as McpToolSpec['inputSchema'];
};

export const normalizeMcpToolSpec = (tool: McpToolSpec): McpToolSpec => ({
  ...tool,
  inputSchema: normalizeMcpInputSchema(tool.inputSchema),
});

export const hasSchemaArrayWithoutItems = (schema: unknown): boolean => {
  if (Array.isArray(schema)) {
    return schema.some((entry) => hasSchemaArrayWithoutItems(entry));
  }

  if (!isPlainObject(schema)) {
    return false;
  }

  if (hasSchemaType(schema, 'array')) {
    const rawItems = schema.items;
    if (!Array.isArray(rawItems) && !isPlainObject(rawItems)) {
      return true;
    }
  }

  return Object.values(schema).some((entry) => hasSchemaArrayWithoutItems(entry));
};