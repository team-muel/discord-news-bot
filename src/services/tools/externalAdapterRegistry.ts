import { openshellAdapter } from './adapters/openshellCliAdapter';
import { nemoclawAdapter } from './adapters/nemoclawCliAdapter';
import { openclawAdapter } from './adapters/openclawCliAdapter';
import { openjarvisAdapter } from './adapters/openjarvisAdapter';
import { n8nAdapter } from './adapters/n8nAdapter';
import { deepwikiAdapter } from './adapters/deepwikiAdapter';
import { obsidianExternalAdapter } from './adapters/obsidianAdapter';
import { renderAdapter } from './adapters/renderAdapter';
import { ollamaAdapter } from './adapters/ollamaAdapter';
import { litellmAdminAdapter } from './adapters/litellmAdminAdapter';
import { mcpIndexingAdapter } from './adapters/mcpIndexingAdapter';
import { validateAdapterId, type ExternalAdapterId, type ExternalToolAdapter, type ExternalAdapterResult } from './externalAdapterTypes';
import logger from '../../logger';

/** Built-in adapters loaded at module init. */
const BUILTIN_ADAPTERS: ReadonlyArray<ExternalToolAdapter> = [
  openshellAdapter,
  nemoclawAdapter,
  openclawAdapter,
  openjarvisAdapter,
  n8nAdapter,
  deepwikiAdapter,
  obsidianExternalAdapter,
  renderAdapter,
  ollamaAdapter,
  litellmAdminAdapter,
  mcpIndexingAdapter,
];

/** Mutable map — built-ins + dynamically registered adapters. */
const adapterMap = new Map<string, ExternalToolAdapter>(
  BUILTIN_ADAPTERS.map((a) => [a.id, a]),
);

/**
 * M-15 / F-01: Register a dynamic adapter at runtime.
 * Validates the adapter ID against ADAPTER_ID_PATTERN.
 * Returns true on success, false if ID is invalid or already taken by a built-in.
 */
export const registerExternalAdapter = (adapter: ExternalToolAdapter): boolean => {
  const id = validateAdapterId(adapter.id);
  if (!id) {
    logger.warn('[ADAPTER-REGISTRY] rejected adapter registration: invalid id=%s', adapter.id);
    return false;
  }
  if (adapterMap.has(id) && BUILTIN_ADAPTERS.some((b) => b.id === id)) {
    logger.warn('[ADAPTER-REGISTRY] rejected adapter registration: built-in id=%s cannot be overwritten', id);
    return false;
  }
  adapterMap.set(id, { ...adapter, id });
  logger.info('[ADAPTER-REGISTRY] registered dynamic adapter id=%s capabilities=%s', id, adapter.capabilities.join(','));
  return true;
};

/**
 * M-15 / F-01: Unregister a dynamic adapter. Built-in adapters cannot be removed.
 */
export const unregisterExternalAdapter = (id: ExternalAdapterId): boolean => {
  if (BUILTIN_ADAPTERS.some((b) => b.id === id)) return false;
  return adapterMap.delete(id);
};

export const getExternalAdapter = (id: ExternalAdapterId): ExternalToolAdapter | undefined =>
  adapterMap.get(id);

export const listExternalAdapters = (): ReadonlyArray<ExternalToolAdapter> => [...adapterMap.values()];

export const executeExternalAction = async (
  adapterId: ExternalAdapterId,
  action: string,
  args: Record<string, unknown> = {},
): Promise<ExternalAdapterResult> => {
  const adapter = adapterMap.get(adapterId);
  if (!adapter) {
    return {
      ok: false,
      adapterId,
      action,
      summary: `Adapter not found: ${adapterId}`,
      output: [],
      error: 'ADAPTER_NOT_FOUND',
      durationMs: 0,
    };
  }

  const available = await adapter.isAvailable();
  if (!available) {
    return {
      ok: false,
      adapterId,
      action,
      summary: `Adapter ${adapterId} is not available (disabled or CLI not found)`,
      output: [],
      error: 'ADAPTER_UNAVAILABLE',
      durationMs: 0,
    };
  }

  return adapter.execute(action, args);
};

export const getExternalAdapterStatus = async (): Promise<
  Array<{ id: ExternalAdapterId; available: boolean; capabilities: readonly string[]; liteMode?: boolean; liteCapabilities?: readonly string[] }>
> => {
  const adapters = [...adapterMap.values()];
  const results = await Promise.all(
    adapters.map(async (a) => {
      const available = await a.isAvailable();
      const liteMode = available && a.liteCapabilities ? a.capabilities.length !== a.liteCapabilities.length : undefined;
      return {
        id: a.id,
        available,
        capabilities: a.capabilities,
        ...(liteMode !== undefined ? { liteMode, liteCapabilities: a.liteCapabilities } : {}),
      };
    }),
  );
  return results;
};
