import { parseBooleanEnv } from '../../utils/env';
import logger from '../../logger';
import { headlessCliObsidianAdapter } from './adapters/headlessCliAdapter.ts';
import { localFsObsidianAdapter } from './adapters/localFsAdapter.ts';
import { scriptCliObsidianAdapter } from './adapters/scriptCliAdapter.ts';
import { logOutcomeSignal, type OutcomeSignal } from '../observability/outcomeSignal';
import type {
  ObsidianCapability,
  ObsidianLoreQuery,
  ObsidianNode,
  ObsidianNoteWriteInput,
  ObsidianReadFileQuery,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianVaultAdapter,
} from './types';
import { supportsCapability } from './types';

const DEFAULT_ORDER = ['headless-cli', 'script-cli', 'local-fs'];

const parseAdapterOrder = (value: string | undefined): string[] => String(value || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const ADAPTER_ORDER = parseAdapterOrder(process.env.OBSIDIAN_ADAPTER_ORDER || DEFAULT_ORDER.join(','));

const ORDER_ENV_BY_CAPABILITY: Record<ObsidianCapability, string | undefined> = {
  read_lore: process.env.OBSIDIAN_ADAPTER_ORDER_READ_LORE,
  search_vault: process.env.OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT,
  read_file: process.env.OBSIDIAN_ADAPTER_ORDER_READ_FILE,
  graph_metadata: process.env.OBSIDIAN_ADAPTER_ORDER_GRAPH_METADATA,
  write_note: process.env.OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE,
  set_property: undefined,
  set_tags: undefined,
  run_plugin_command: undefined,
};
const OBSIDIAN_ADAPTER_STRICT = parseBooleanEnv(process.env.OBSIDIAN_ADAPTER_STRICT, false);

const registry: Record<string, ObsidianVaultAdapter> = {
  [headlessCliObsidianAdapter.id]: headlessCliObsidianAdapter,
  [scriptCliObsidianAdapter.id]: scriptCliObsidianAdapter,
  [localFsObsidianAdapter.id]: localFsObsidianAdapter,
};

const CORE_CAPABILITIES: ObsidianCapability[] = ['read_lore', 'search_vault', 'read_file', 'graph_metadata', 'write_note'];

const getAdapterOrderForCapability = (capability: ObsidianCapability): string[] => {
  const capabilityOrder = parseAdapterOrder(ORDER_ENV_BY_CAPABILITY[capability]);
  if (capabilityOrder.length > 0) {
    return capabilityOrder;
  }
  if (ADAPTER_ORDER.length > 0) {
    return ADAPTER_ORDER;
  }
  return DEFAULT_ORDER;
};

const logAdapterSignal = (params: {
  capability: ObsidianCapability;
  outcome: OutcomeSignal;
  primary: string | null;
  fallback?: string | null;
  detail?: string;
}) => {
  logOutcomeSignal({
    scope: 'adapter',
    component: `obsidian-${params.capability}`,
    outcome: params.outcome,
    path: 'adapter-router',
    detail: params.detail,
    extra: {
      primary: params.primary || 'none',
      fallback: params.fallback || 'none',
    },
  });
};

const getOrderedAdapters = (capability?: ObsidianCapability): ObsidianVaultAdapter[] => {
  const rawOrder = capability ? getAdapterOrderForCapability(capability) : (ADAPTER_ORDER.length > 0 ? ADAPTER_ORDER : DEFAULT_ORDER);
  const uniqueOrder = [...new Set(rawOrder)];
  const ordered = uniqueOrder
    .map((id) => registry[id])
    .filter((adapter): adapter is ObsidianVaultAdapter => Boolean(adapter));

  if (ordered.length > 0) {
    return ordered;
  }

  return [headlessCliObsidianAdapter, scriptCliObsidianAdapter, localFsObsidianAdapter];
};

const pickAdapter = (capability: ObsidianCapability): ObsidianVaultAdapter | null => {
  for (const adapter of getOrderedAdapters(capability)) {
    if (!adapter.isAvailable()) {
      continue;
    }
    if (!supportsCapability(adapter, capability)) {
      continue;
    }
    return adapter;
  }
  return null;
};

export const isObsidianCapabilityAvailable = (capability: ObsidianCapability): boolean => {
  return pickAdapter(capability) !== null;
};

export const getObsidianAdapterRuntimeStatus = (): {
  strictMode: boolean;
  configuredOrder: string[];
  configuredOrderByCapability: Record<string, string[]>;
  adapters: Array<{ id: string; available: boolean; capabilities: ReadonlyArray<ObsidianCapability> }>;
  selectedByCapability: Record<string, string | null>;
} => {
  const adapters = getOrderedAdapters().map((adapter) => ({
    id: adapter.id,
    available: adapter.isAvailable(),
    capabilities: adapter.capabilities,
  }));

  const selectedByCapability = Object.fromEntries(
    CORE_CAPABILITIES.map((capability) => [capability, pickAdapter(capability)?.id ?? null]),
  );
  const configuredOrderByCapability = Object.fromEntries(
    CORE_CAPABILITIES.map((capability) => [capability, getAdapterOrderForCapability(capability)]),
  );

  return {
    strictMode: OBSIDIAN_ADAPTER_STRICT,
    configuredOrder: [...ADAPTER_ORDER],
    configuredOrderByCapability,
    adapters,
    selectedByCapability,
  };
};

export const readObsidianLoreWithAdapter = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const adapter = pickAdapter('read_lore');
  if (!adapter || !adapter.readLore) {
    if (OBSIDIAN_ADAPTER_STRICT) {
      logger.warn('[OBSIDIAN-ADAPTER] no adapter available for read_lore (strict mode)');
    }
    logAdapterSignal({ capability: 'read_lore', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return [];
  }

  const hints = await adapter.readLore(params);
  if (hints.length > 0) {
    logAdapterSignal({ capability: 'read_lore', outcome: 'success', primary: adapter.id, detail: 'primary_hit' });
    return hints;
  }

  if (OBSIDIAN_ADAPTER_STRICT) {
    logAdapterSignal({ capability: 'read_lore', outcome: 'failure', primary: adapter.id, detail: 'strict_empty' });
    return [];
  }

  // Best-effort fallback across remaining adapters.
  for (const fallback of getOrderedAdapters('read_lore')) {
    if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.readLore) {
      continue;
    }
    if (!supportsCapability(fallback, 'read_lore')) {
      continue;
    }
    const fallbackHints = await fallback.readLore(params);
    if (fallbackHints.length > 0) {
      logAdapterSignal({ capability: 'read_lore', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_hit' });
      return fallbackHints;
    }
  }

  logAdapterSignal({ capability: 'read_lore', outcome: 'failure', primary: adapter.id, detail: 'all_empty' });
  return [];
};

export const writeObsidianNoteWithAdapter = async (params: ObsidianNoteWriteInput): Promise<{ path: string } | null> => {
  const adapter = pickAdapter('write_note');
  if (!adapter || !adapter.writeNote) {
    logAdapterSignal({ capability: 'write_note', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return null;
  }

  try {
    const primary = await adapter.writeNote(params);
    logAdapterSignal({ capability: 'write_note', outcome: 'success', primary: adapter.id, detail: 'primary_write_ok' });
    return primary;
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] write_note failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    if (OBSIDIAN_ADAPTER_STRICT) {
      logAdapterSignal({ capability: 'write_note', outcome: 'failure', primary: adapter.id, detail: 'strict_primary_error' });
      return null;
    }

    for (const fallback of getOrderedAdapters('write_note')) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.writeNote) {
        continue;
      }
      if (!supportsCapability(fallback, 'write_note')) {
        continue;
      }
      try {
        const fallbackResult = await fallback.writeNote(params);
        logAdapterSignal({ capability: 'write_note', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_write_ok' });
        return fallbackResult;
      } catch {
        // Continue fallback chain.
      }
    }
    logAdapterSignal({ capability: 'write_note', outcome: 'failure', primary: adapter.id, detail: 'all_fallback_failed' });
    return null;
  }
};

export const searchObsidianVaultWithAdapter = async (params: ObsidianSearchQuery): Promise<ObsidianSearchResult[]> => {
  const adapter = pickAdapter('search_vault');
  if (!adapter || !adapter.searchVault) {
    logAdapterSignal({ capability: 'search_vault', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return [];
  }

  try {
    const primary = await adapter.searchVault(params);
    if (primary.length > 0 || OBSIDIAN_ADAPTER_STRICT) {
      logAdapterSignal({ capability: 'search_vault', outcome: primary.length > 0 ? 'success' : 'failure', primary: adapter.id, detail: primary.length > 0 ? 'primary_hit' : 'strict_empty' });
      return primary;
    }

    for (const fallback of getOrderedAdapters('search_vault')) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.searchVault) {
        continue;
      }
      if (!supportsCapability(fallback, 'search_vault')) {
        continue;
      }
      const fallbackResults = await fallback.searchVault(params);
      if (fallbackResults.length > 0) {
        logAdapterSignal({ capability: 'search_vault', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_hit' });
        return fallbackResults;
      }
    }
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] search_vault failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    logAdapterSignal({ capability: 'search_vault', outcome: 'failure', primary: adapter.id, detail: 'exception' });
  }

  logAdapterSignal({ capability: 'search_vault', outcome: 'failure', primary: adapter.id, detail: 'all_empty' });
  return [];
};

export const readObsidianFileWithAdapter = async (params: ObsidianReadFileQuery): Promise<string | null> => {
  const adapter = pickAdapter('read_file');
  if (!adapter || !adapter.readFile) {
    logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return null;
  }

  try {
    const primary = await adapter.readFile(params);
    if (primary !== null || OBSIDIAN_ADAPTER_STRICT) {
      logAdapterSignal({ capability: 'read_file', outcome: primary !== null ? 'success' : 'failure', primary: adapter.id, detail: primary !== null ? 'primary_hit' : 'strict_empty' });
      return primary;
    }

    for (const fallback of getOrderedAdapters('read_file')) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.readFile) {
        continue;
      }
      if (!supportsCapability(fallback, 'read_file')) {
        continue;
      }
      const fallbackContent = await fallback.readFile(params);
      if (fallbackContent !== null) {
        logAdapterSignal({ capability: 'read_file', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_hit' });
        return fallbackContent;
      }
    }
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] read_file failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: adapter.id, detail: 'exception' });
  }

  logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: adapter.id, detail: 'all_empty' });
  return null;
};

export const getObsidianGraphMetadataWithAdapter = async (params: { vaultPath: string }): Promise<Record<string, ObsidianNode>> => {
  const adapter = pickAdapter('graph_metadata');
  if (!adapter || !adapter.getGraphMetadata) {
    logAdapterSignal({ capability: 'graph_metadata', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return {};
  }

  try {
    const primary = await adapter.getGraphMetadata(params);
    if (Object.keys(primary).length > 0 || OBSIDIAN_ADAPTER_STRICT) {
      logAdapterSignal({ capability: 'graph_metadata', outcome: Object.keys(primary).length > 0 ? 'success' : 'failure', primary: adapter.id, detail: Object.keys(primary).length > 0 ? 'primary_hit' : 'strict_empty' });
      return primary;
    }

    for (const fallback of getOrderedAdapters('graph_metadata')) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.getGraphMetadata) {
        continue;
      }
      if (!supportsCapability(fallback, 'graph_metadata')) {
        continue;
      }
      const fallbackMetadata = await fallback.getGraphMetadata(params);
      if (Object.keys(fallbackMetadata).length > 0) {
        logAdapterSignal({ capability: 'graph_metadata', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_hit' });
        return fallbackMetadata;
      }
    }
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] graph_metadata failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    logAdapterSignal({ capability: 'graph_metadata', outcome: 'failure', primary: adapter.id, detail: 'exception' });
  }

  logAdapterSignal({ capability: 'graph_metadata', outcome: 'failure', primary: adapter.id, detail: 'all_empty' });
  return {};
};

export const warmupObsidianAdapters = async (vaultPath: string): Promise<void> => {
  const safeVaultPath = String(vaultPath || '').trim();
  if (!safeVaultPath) {
    return;
  }

  const tasks = getOrderedAdapters()
    .filter((adapter) => adapter.isAvailable() && typeof adapter.warmup === 'function')
    .map(async (adapter) => {
      try {
        await adapter.warmup?.({ vaultPath: safeVaultPath });
      } catch (error) {
        logger.warn('[OBSIDIAN-ADAPTER] warmup failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
      }
    });

  await Promise.all(tasks);
};
