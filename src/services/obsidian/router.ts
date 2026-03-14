import { parseBooleanEnv } from '../../utils/env';
import logger from '../../logger';
import { headlessCliObsidianAdapter } from './adapters/headlessCliAdapter.ts';
import { localFsObsidianAdapter } from './adapters/localFsAdapter.ts';
import { scriptCliObsidianAdapter } from './adapters/scriptCliAdapter.ts';
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
const ADAPTER_ORDER = String(process.env.OBSIDIAN_ADAPTER_ORDER || DEFAULT_ORDER.join(','))
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const OBSIDIAN_ADAPTER_STRICT = parseBooleanEnv(process.env.OBSIDIAN_ADAPTER_STRICT, false);

const registry: Record<string, ObsidianVaultAdapter> = {
  [headlessCliObsidianAdapter.id]: headlessCliObsidianAdapter,
  [scriptCliObsidianAdapter.id]: scriptCliObsidianAdapter,
  [localFsObsidianAdapter.id]: localFsObsidianAdapter,
};

const getOrderedAdapters = (): ObsidianVaultAdapter[] => {
  const ordered = ADAPTER_ORDER
    .map((id) => registry[id])
    .filter((adapter): adapter is ObsidianVaultAdapter => Boolean(adapter));

  if (ordered.length > 0) {
    return ordered;
  }

  return [headlessCliObsidianAdapter, scriptCliObsidianAdapter, localFsObsidianAdapter];
};

const pickAdapter = (capability: ObsidianCapability): ObsidianVaultAdapter | null => {
  for (const adapter of getOrderedAdapters()) {
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

export const readObsidianLoreWithAdapter = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const adapter = pickAdapter('read_lore');
  if (!adapter || !adapter.readLore) {
    if (OBSIDIAN_ADAPTER_STRICT) {
      logger.warn('[OBSIDIAN-ADAPTER] no adapter available for read_lore (strict mode)');
    }
    return [];
  }

  const hints = await adapter.readLore(params);
  if (hints.length > 0) {
    return hints;
  }

  if (OBSIDIAN_ADAPTER_STRICT) {
    return [];
  }

  // Best-effort fallback across remaining adapters.
  for (const fallback of getOrderedAdapters()) {
    if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.readLore) {
      continue;
    }
    if (!supportsCapability(fallback, 'read_lore')) {
      continue;
    }
    const fallbackHints = await fallback.readLore(params);
    if (fallbackHints.length > 0) {
      return fallbackHints;
    }
  }

  return [];
};

export const writeObsidianNoteWithAdapter = async (params: ObsidianNoteWriteInput): Promise<{ path: string } | null> => {
  const adapter = pickAdapter('write_note');
  if (!adapter || !adapter.writeNote) {
    return null;
  }

  try {
    return await adapter.writeNote(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] write_note failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    if (OBSIDIAN_ADAPTER_STRICT) {
      return null;
    }

    for (const fallback of getOrderedAdapters()) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.writeNote) {
        continue;
      }
      if (!supportsCapability(fallback, 'write_note')) {
        continue;
      }
      try {
        return await fallback.writeNote(params);
      } catch {
        // Continue fallback chain.
      }
    }
    return null;
  }
};

export const searchObsidianVaultWithAdapter = async (params: ObsidianSearchQuery): Promise<ObsidianSearchResult[]> => {
  const adapter = pickAdapter('search_vault');
  if (!adapter || !adapter.searchVault) {
    return [];
  }

  try {
    const primary = await adapter.searchVault(params);
    if (primary.length > 0 || OBSIDIAN_ADAPTER_STRICT) {
      return primary;
    }

    for (const fallback of getOrderedAdapters()) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.searchVault) {
        continue;
      }
      if (!supportsCapability(fallback, 'search_vault')) {
        continue;
      }
      const fallbackResults = await fallback.searchVault(params);
      if (fallbackResults.length > 0) {
        return fallbackResults;
      }
    }
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] search_vault failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
  }

  return [];
};

export const readObsidianFileWithAdapter = async (params: ObsidianReadFileQuery): Promise<string | null> => {
  const adapter = pickAdapter('read_file');
  if (!adapter || !adapter.readFile) {
    return null;
  }

  try {
    const primary = await adapter.readFile(params);
    if (primary !== null || OBSIDIAN_ADAPTER_STRICT) {
      return primary;
    }

    for (const fallback of getOrderedAdapters()) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.readFile) {
        continue;
      }
      if (!supportsCapability(fallback, 'read_file')) {
        continue;
      }
      const fallbackContent = await fallback.readFile(params);
      if (fallbackContent !== null) {
        return fallbackContent;
      }
    }
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] read_file failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
  }

  return null;
};

export const getObsidianGraphMetadataWithAdapter = async (params: { vaultPath: string }): Promise<Record<string, ObsidianNode>> => {
  const adapter = pickAdapter('graph_metadata');
  if (!adapter || !adapter.getGraphMetadata) {
    return {};
  }

  try {
    const primary = await adapter.getGraphMetadata(params);
    if (Object.keys(primary).length > 0 || OBSIDIAN_ADAPTER_STRICT) {
      return primary;
    }

    for (const fallback of getOrderedAdapters()) {
      if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.getGraphMetadata) {
        continue;
      }
      if (!supportsCapability(fallback, 'graph_metadata')) {
        continue;
      }
      const fallbackMetadata = await fallback.getGraphMetadata(params);
      if (Object.keys(fallbackMetadata).length > 0) {
        return fallbackMetadata;
      }
    }
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] graph_metadata failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
  }

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
