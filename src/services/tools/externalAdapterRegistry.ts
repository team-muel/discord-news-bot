import { openshellAdapter } from './adapters/openshellCliAdapter';
import { nemoclawAdapter } from './adapters/nemoclawCliAdapter';
import { openclawAdapter } from './adapters/openclawCliAdapter';
import { openjarvisAdapter } from './adapters/openjarvisAdapter';
import type { ExternalAdapterId, ExternalToolAdapter, ExternalAdapterResult } from './externalAdapterTypes';

const ADAPTERS: ReadonlyArray<ExternalToolAdapter> = [
  openshellAdapter,
  nemoclawAdapter,
  openclawAdapter,
  openjarvisAdapter,
];

const adapterMap = new Map<ExternalAdapterId, ExternalToolAdapter>(
  ADAPTERS.map((a) => [a.id, a]),
);

export const getExternalAdapter = (id: ExternalAdapterId): ExternalToolAdapter | undefined =>
  adapterMap.get(id);

export const listExternalAdapters = (): ReadonlyArray<ExternalToolAdapter> => ADAPTERS;

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
  const results = await Promise.all(
    ADAPTERS.map(async (a) => {
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
