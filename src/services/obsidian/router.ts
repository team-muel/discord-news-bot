import { parseBooleanEnv } from '../../utils/env';
import logger from '../../logger';
import { headlessCliObsidianAdapter } from './adapters/headlessCliAdapter.ts';
import { nativeCliObsidianAdapter } from './adapters/nativeCliAdapter.ts';
import { scriptCliObsidianAdapter } from './adapters/scriptCliAdapter.ts';
import { logOutcomeSignal, type OutcomeSignal } from '../observability/outcomeSignal';
import { sanitizeForObsidianWrite } from './obsidianSanitizationWorker';
import type {
  ObsidianCapability,
  ObsidianFileInfo,
  ObsidianLoreQuery,
  ObsidianNode,
  ObsidianNoteWriteInput,
  ObsidianOutlineHeading,
  ObsidianReadFileQuery,
  ObsidianSearchContextResult,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianTask,
  ObsidianVaultAdapter,
} from './types';
import { supportsCapability } from './types';

const DEFAULT_ORDER = ['native-cli', 'headless-cli', 'script-cli'];

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
  daily_note: process.env.OBSIDIAN_ADAPTER_ORDER_DAILY_NOTE,
  task_management: process.env.OBSIDIAN_ADAPTER_ORDER_TASK_MANAGEMENT,
  set_property: undefined,
  set_tags: undefined,
  run_plugin_command: undefined,
  outline: undefined,
  search_context: undefined,
  property_read: undefined,
  files_list: undefined,
  append_content: undefined,
};
const OBSIDIAN_ADAPTER_STRICT = parseBooleanEnv(process.env.OBSIDIAN_ADAPTER_STRICT, false);

const registry: Record<string, ObsidianVaultAdapter> = {
  [nativeCliObsidianAdapter.id]: nativeCliObsidianAdapter,
  [headlessCliObsidianAdapter.id]: headlessCliObsidianAdapter,
  [scriptCliObsidianAdapter.id]: scriptCliObsidianAdapter,
};

const CORE_CAPABILITIES: ObsidianCapability[] = ['read_lore', 'search_vault', 'read_file', 'graph_metadata', 'write_note', 'daily_note', 'task_management'];

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

  return [nativeCliObsidianAdapter, headlessCliObsidianAdapter, scriptCliObsidianAdapter];
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

  let hints: string[] = [];
  try {
    hints = await adapter.readLore(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] read_lore failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
  }

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
    try {
      const fallbackHints = await fallback.readLore(params);
      if (fallbackHints.length > 0) {
        logAdapterSignal({ capability: 'read_lore', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_hit' });
        return fallbackHints;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] readLore fallback=%s failed: %s', fallback.id, err instanceof Error ? err.message : String(err));
      // Continue fallback chain.
    }
  }

  logAdapterSignal({ capability: 'read_lore', outcome: 'failure', primary: adapter.id, detail: 'all_empty' });
  return [];
};

export const writeObsidianNoteWithAdapter = async (params: ObsidianNoteWriteInput & { trustedSource?: boolean }): Promise<{ path: string } | null> => {
  const sanitized = sanitizeForObsidianWrite({ content: params.content, trustedSource: params.trustedSource });
  if (sanitized.blocked) {
    logger.warn('[OBSIDIAN-ADAPTER] write_note blocked by sanitizer: %s (file: %s)', sanitized.reasons.join(', '), params.fileName);
    logAdapterSignal({ capability: 'write_note', outcome: 'failure', primary: null, detail: `sanitizer_blocked:${sanitized.reasons.join(',')}` });
    return null;
  }
  const sanitizedParams: ObsidianNoteWriteInput = { ...params, content: sanitized.cleaned.content };

  const adapter = pickAdapter('write_note');
  if (!adapter || !adapter.writeNote) {
    logAdapterSignal({ capability: 'write_note', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return null;
  }

  try {
    const primary = await adapter.writeNote(sanitizedParams);
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
        const fallbackResult = await fallback.writeNote(sanitizedParams);
        logAdapterSignal({ capability: 'write_note', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_write_ok' });
        return fallbackResult;
      } catch (err) {
        logger.debug('[OBSIDIAN-ROUTER] writeNote fallback=%s failed: %s', fallback.id, err instanceof Error ? err.message : String(err));
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

  let primaryResults: ObsidianSearchResult[] = [];
  let primaryFailed = false;
  try {
    primaryResults = await adapter.searchVault(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] search_vault failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    primaryFailed = true;
  }

  if (primaryResults.length > 0) {
    logAdapterSignal({ capability: 'search_vault', outcome: 'success', primary: adapter.id, detail: 'primary_hit' });
    return primaryResults;
  }

  if (OBSIDIAN_ADAPTER_STRICT && !primaryFailed) {
    logAdapterSignal({ capability: 'search_vault', outcome: 'failure', primary: adapter.id, detail: 'strict_empty' });
    return [];
  }

  for (const fallback of getOrderedAdapters('search_vault')) {
    if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.searchVault) {
      continue;
    }
    if (!supportsCapability(fallback, 'search_vault')) {
      continue;
    }
    try {
      const fallbackResults = await fallback.searchVault(params);
      if (fallbackResults.length > 0) {
        logAdapterSignal({ capability: 'search_vault', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: primaryFailed ? 'primary_error_fallback_hit' : 'fallback_hit' });
        return fallbackResults;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] searchVault fallback=%s failed: %s', fallback.id, err instanceof Error ? err.message : String(err));
      // Continue fallback chain.
    }
  }

  logAdapterSignal({ capability: 'search_vault', outcome: 'failure', primary: adapter.id, detail: primaryFailed ? 'primary_error_all_fallback_empty' : 'all_empty' });
  return [];
};

export const readObsidianFileWithAdapter = async (params: ObsidianReadFileQuery): Promise<string | null> => {
  const adapter = pickAdapter('read_file');
  if (!adapter || !adapter.readFile) {
    logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return null;
  }

  let primaryContent: string | null = null;
  let primaryFailed = false;
  try {
    primaryContent = await adapter.readFile(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] read_file failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    primaryFailed = true;
  }

  if (primaryContent !== null) {
    logAdapterSignal({ capability: 'read_file', outcome: 'success', primary: adapter.id, detail: 'primary_hit' });
    return primaryContent;
  }

  if (OBSIDIAN_ADAPTER_STRICT && !primaryFailed) {
    logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: adapter.id, detail: 'strict_empty' });
    return null;
  }

  for (const fallback of getOrderedAdapters('read_file')) {
    if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.readFile) {
      continue;
    }
    if (!supportsCapability(fallback, 'read_file')) {
      continue;
    }
    try {
      const fallbackContent = await fallback.readFile(params);
      if (fallbackContent !== null) {
        logAdapterSignal({ capability: 'read_file', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: primaryFailed ? 'primary_error_fallback_hit' : 'fallback_hit' });
        return fallbackContent;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] readFile fallback=%s failed: %s', fallback.id, err instanceof Error ? err.message : String(err));
      // Continue fallback chain.
    }
  }

  logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: adapter.id, detail: primaryFailed ? 'primary_error_all_fallback_empty' : 'all_empty' });
  return null;
};

export const getObsidianGraphMetadataWithAdapter = async (params: { vaultPath: string }): Promise<Record<string, ObsidianNode>> => {
  const adapter = pickAdapter('graph_metadata');
  if (!adapter || !adapter.getGraphMetadata) {
    logAdapterSignal({ capability: 'graph_metadata', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return {};
  }

  let primaryResult: Record<string, ObsidianNode> = {};
  let primaryFailed = false;
  try {
    primaryResult = await adapter.getGraphMetadata(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] graph_metadata failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    primaryFailed = true;
  }

  if (Object.keys(primaryResult).length > 0) {
    logAdapterSignal({ capability: 'graph_metadata', outcome: 'success', primary: adapter.id, detail: 'primary_hit' });
    return primaryResult;
  }

  if (OBSIDIAN_ADAPTER_STRICT && !primaryFailed) {
    logAdapterSignal({ capability: 'graph_metadata', outcome: 'failure', primary: adapter.id, detail: 'strict_empty' });
    return {};
  }

  for (const fallback of getOrderedAdapters('graph_metadata')) {
    if (fallback.id === adapter.id || !fallback.isAvailable() || !fallback.getGraphMetadata) {
      continue;
    }
    if (!supportsCapability(fallback, 'graph_metadata')) {
      continue;
    }
    try {
      const fallbackMetadata = await fallback.getGraphMetadata(params);
      if (Object.keys(fallbackMetadata).length > 0) {
        logAdapterSignal({ capability: 'graph_metadata', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: primaryFailed ? 'primary_error_fallback_hit' : 'fallback_hit' });
        return fallbackMetadata;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] graphMetadata fallback=%s failed: %s', fallback.id, err instanceof Error ? err.message : String(err));
      // Continue fallback chain.
    }
  }

  logAdapterSignal({ capability: 'graph_metadata', outcome: 'failure', primary: adapter.id, detail: primaryFailed ? 'primary_error_all_fallback_empty' : 'all_empty' });
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

// ── Daily Note ─────────────────────────────────────

export const appendDailyNoteWithAdapter = async (content: string): Promise<boolean> => {
  const adapter = pickAdapter('daily_note');
  if (!adapter || !adapter.dailyAppend) {
    logAdapterSignal({ capability: 'daily_note', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return false;
  }

  try {
    const ok = await adapter.dailyAppend({ content });
    logAdapterSignal({ capability: 'daily_note', outcome: ok ? 'success' : 'failure', primary: adapter.id, detail: ok ? 'append_ok' : 'append_empty' });
    return ok;
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] daily_note append failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    logAdapterSignal({ capability: 'daily_note', outcome: 'failure', primary: adapter.id, detail: 'exception' });
    return false;
  }
};

export const readDailyNoteWithAdapter = async (): Promise<string | null> => {
  const adapter = pickAdapter('daily_note');
  if (!adapter || !adapter.dailyRead) {
    logAdapterSignal({ capability: 'daily_note', outcome: 'failure', primary: null, detail: 'no_adapter_read' });
    return null;
  }

  try {
    const content = await adapter.dailyRead();
    logAdapterSignal({ capability: 'daily_note', outcome: content !== null ? 'success' : 'failure', primary: adapter.id, detail: content !== null ? 'read_ok' : 'read_empty' });
    return content;
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] daily_note read failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    logAdapterSignal({ capability: 'daily_note', outcome: 'failure', primary: adapter.id, detail: 'exception' });
    return null;
  }
};

// ── Task Management ────────────────────────────────

export const listObsidianTasksWithAdapter = async (): Promise<ObsidianTask[]> => {
  const adapter = pickAdapter('task_management');
  if (!adapter || !adapter.listTasks) {
    logAdapterSignal({ capability: 'task_management', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return [];
  }

  try {
    const tasks = await adapter.listTasks();
    logAdapterSignal({ capability: 'task_management', outcome: tasks.length > 0 ? 'success' : 'failure', primary: adapter.id, detail: `listed_${tasks.length}` });
    return tasks;
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] task_management list failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    logAdapterSignal({ capability: 'task_management', outcome: 'failure', primary: adapter.id, detail: 'exception' });
    return [];
  }
};

export const toggleObsidianTaskWithAdapter = async (filePath: string, line: number): Promise<boolean> => {
  const adapter = pickAdapter('task_management');
  if (!adapter || !adapter.toggleTask) {
    logAdapterSignal({ capability: 'task_management', outcome: 'failure', primary: null, detail: 'no_adapter_toggle' });
    return false;
  }

  try {
    const ok = await adapter.toggleTask({ filePath, line });
    logAdapterSignal({ capability: 'task_management', outcome: ok ? 'success' : 'failure', primary: adapter.id, detail: ok ? 'toggle_ok' : 'toggle_failed' });
    return ok;
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] task_management toggle failed on %s: %s', adapter.id, error instanceof Error ? error.message : String(error));
    logAdapterSignal({ capability: 'task_management', outcome: 'failure', primary: adapter.id, detail: 'exception' });
    return false;
  }
};

export type ObsidianVaultHealthStatus = {
  healthy: boolean;
  issues: string[];
  adapterStatus: ReturnType<typeof getObsidianAdapterRuntimeStatus>;
  writeCapable: boolean;
  readCapable: boolean;
  searchCapable: boolean;
};

export const getObsidianVaultHealthStatus = (): ObsidianVaultHealthStatus => {
  const adapterStatus = getObsidianAdapterRuntimeStatus();
  const issues: string[] = [];

  const writeCapable = adapterStatus.selectedByCapability.write_note !== null;
  const readCapable = adapterStatus.selectedByCapability.read_file !== null || adapterStatus.selectedByCapability.read_lore !== null;
  const searchCapable = adapterStatus.selectedByCapability.search_vault !== null;

  if (!writeCapable) {
    issues.push('No adapter available for write_note — all Obsidian writes are no-ops');
  }
  if (!readCapable) {
    issues.push('No adapter available for read operations — retrieval disabled');
  }
  if (!searchCapable) {
    issues.push('No adapter available for search_vault — search disabled');
  }

  const availableCount = adapterStatus.adapters.filter((a) => a.available).length;
  if (availableCount === 0) {
    issues.push('No Obsidian adapters available — vault is completely disconnected');
  }

  return {
    healthy: issues.length === 0,
    issues,
    adapterStatus,
    writeCapable,
    readCapable,
    searchCapable,
  };
};

// ── New capability routers ────────────────────────────────────────────────────

export const getObsidianOutlineWithAdapter = async (
  vaultPath: string,
  filePath: string,
): Promise<ObsidianOutlineHeading[]> => {
  const adapter = pickAdapter('outline');
  if (!adapter?.getOutline) return [];
  try {
    return await adapter.getOutline({ vaultPath, filePath });
  } catch {
    return [];
  }
};

export const searchObsidianContextWithAdapter = async (
  vaultPath: string,
  query: string,
  limit?: number,
): Promise<ObsidianSearchContextResult[]> => {
  const adapter = pickAdapter('search_context');
  if (!adapter?.searchContext) return [];
  try {
    return await adapter.searchContext({ vaultPath, query, limit });
  } catch {
    return [];
  }
};

export const readObsidianPropertyWithAdapter = async (
  vaultPath: string,
  filePath: string,
  name: string,
): Promise<string | null> => {
  const adapter = pickAdapter('property_read');
  if (!adapter?.readProperty) return null;
  try {
    return await adapter.readProperty({ vaultPath, filePath, name });
  } catch {
    return null;
  }
};

export const setObsidianPropertyWithAdapter = async (
  vaultPath: string,
  filePath: string,
  name: string,
  value: string,
): Promise<boolean> => {
  const adapter = pickAdapter('set_property');
  if (!adapter?.setProperty) return false;
  try {
    return await adapter.setProperty({ vaultPath, filePath, name, value });
  } catch {
    return false;
  }
};

export const listObsidianFilesWithAdapter = async (
  vaultPath: string,
  folder?: string,
  extension?: string,
): Promise<ObsidianFileInfo[]> => {
  const adapter = pickAdapter('files_list');
  if (!adapter?.listFiles) return [];
  try {
    return await adapter.listFiles({ vaultPath, folder, extension });
  } catch {
    return [];
  }
};

export const appendObsidianContentWithAdapter = async (
  vaultPath: string,
  filePath: string,
  content: string,
): Promise<boolean> => {
  const adapter = pickAdapter('append_content');
  if (!adapter?.appendContent) return false;
  try {
    return await adapter.appendContent({ vaultPath, filePath, content });
  } catch {
    return false;
  }
};
