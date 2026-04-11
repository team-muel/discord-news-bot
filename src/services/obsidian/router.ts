import path from 'node:path';
import { parseBooleanEnv, parseCsvList } from '../../utils/env';
import logger from '../../logger';
import { nativeCliObsidianAdapter } from './adapters/nativeCliAdapter.ts';
import { scriptCliObsidianAdapter } from './adapters/scriptCliAdapter.ts';
import { localFsObsidianAdapter } from './adapters/localFsAdapter.ts';
import {
  getRemoteMcpAdapterDiagnostics,
  probeRemoteMcpAdapter,
  remoteMcpObsidianAdapter,
  type RemoteMcpAdapterDiagnostics,
} from './adapters/remoteMcpAdapter.ts';
import { logOutcomeSignal, type OutcomeSignal } from '../observability/outcomeSignal';
import { buildObsidianFrontmatter, hasObsidianFrontmatter } from './obsidianDocBuilder';
import { sanitizeForObsidianWrite } from './obsidianSanitizationWorker';
import type {
  ObsidianFrontmatterValue,
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
import { getErrorMessage } from '../../utils/errorMessage';
import { getObsidianVaultRuntimeInfo, type ObsidianVaultRuntimeInfo } from '../../utils/obsidianEnv';

const DEFAULT_ORDER = ['remote-mcp', 'native-cli', 'script-cli', 'local-fs'];
const REMOTE_MCP_DEPRIORITIZE_AFTER_FAILURES = 2;
const REMOTE_MCP_DEPRIORITIZE_WINDOW_MS = 90_000;

const ADAPTER_ORDER = parseCsvList(process.env.OBSIDIAN_ADAPTER_ORDER || DEFAULT_ORDER.join(','));

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
  [remoteMcpObsidianAdapter.id]: remoteMcpObsidianAdapter,
  [nativeCliObsidianAdapter.id]: nativeCliObsidianAdapter,
  [scriptCliObsidianAdapter.id]: scriptCliObsidianAdapter,
  [localFsObsidianAdapter.id]: localFsObsidianAdapter,
};

const CORE_CAPABILITIES: ObsidianCapability[] = ['read_lore', 'search_vault', 'read_file', 'graph_metadata', 'write_note', 'daily_note', 'task_management'];
const DIRECT_VAULT_ADAPTER_IDS = new Set(['native-cli', 'script-cli', 'local-fs']);

export type ObsidianVaultAccessPosture = {
  mode: 'shared-remote-ingress' | 'direct-vault-primary' | 'mixed-routing' | 'disconnected';
  summary: string;
  primaryWriteAdapter: string | null;
  primaryReadAdapter: string | null;
  primarySearchAdapter: string | null;
  remoteHttpIngressActive: boolean;
  directVaultPathActive: boolean;
  canonicalSharedIngressConfigured: boolean;
};

export type ObsidianAdapterRuntimeStatus = {
  strictMode: boolean;
  configuredOrder: string[];
  configuredOrderByCapability: Record<string, string[]>;
  effectiveOrderByCapability: Record<string, string[]>;
  adapters: Array<{ id: string; available: boolean; capabilities: ReadonlyArray<ObsidianCapability>; deprioritized: boolean }>;
  selectedByCapability: Record<string, string | null>;
  routingState: { remoteMcpCircuitOpen: boolean; remoteMcpCircuitReason: string | null };
  remoteMcp: RemoteMcpAdapterDiagnostics;
  vault: ObsidianVaultRuntimeInfo;
  accessPosture: ObsidianVaultAccessPosture;
};

const parseIsoMs = (value: string | null): number => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const isDirectVaultAdapter = (adapterId: string | null | undefined): boolean => {
  return Boolean(adapterId && DIRECT_VAULT_ADAPTER_IDS.has(adapterId));
};

const buildObsidianVaultAccessPosture = (params: {
  selectedByCapability: Record<string, string | null>;
  remoteMcp: RemoteMcpAdapterDiagnostics;
  vault: ObsidianVaultRuntimeInfo;
}): ObsidianVaultAccessPosture => {
  const { selectedByCapability, remoteMcp, vault } = params;
  const primaryWriteAdapter = selectedByCapability.write_note ?? null;
  const primarySearchAdapter = selectedByCapability.search_vault ?? null;
  const primaryReadAdapter = selectedByCapability.read_file ?? selectedByCapability.read_lore ?? null;
  const activeAdapters = [...new Set([
    primaryWriteAdapter,
    primaryReadAdapter,
    primarySearchAdapter,
  ].filter((value): value is string => Boolean(value)))];
  const remoteHttpIngressActive = activeAdapters.includes('remote-mcp');
  const directVaultPathActive = activeAdapters.some((adapterId) => isDirectVaultAdapter(adapterId));

  if (activeAdapters.length === 0) {
    return {
      mode: 'disconnected',
      summary: 'No Obsidian read/write/search adapter is active',
      primaryWriteAdapter,
      primaryReadAdapter,
      primarySearchAdapter,
      remoteHttpIngressActive: false,
      directVaultPathActive: false,
      canonicalSharedIngressConfigured: remoteMcp.usesCanonicalSharedIngress,
    };
  }

  if (remoteHttpIngressActive && directVaultPathActive) {
    return {
      mode: 'mixed-routing',
      summary: `Remote MCP and direct vault adapters are mixed across capabilities (write=${primaryWriteAdapter || 'none'}, read=${primaryReadAdapter || 'none'}, search=${primarySearchAdapter || 'none'})`,
      primaryWriteAdapter,
      primaryReadAdapter,
      primarySearchAdapter,
      remoteHttpIngressActive,
      directVaultPathActive,
      canonicalSharedIngressConfigured: remoteMcp.usesCanonicalSharedIngress,
    };
  }

  if (remoteHttpIngressActive) {
    return {
      mode: 'shared-remote-ingress',
      summary: remoteMcp.usesCanonicalSharedIngress
        ? 'Remote MCP over the canonical shared ingress is the primary Obsidian path'
        : 'Remote MCP is the primary Obsidian path',
      primaryWriteAdapter,
      primaryReadAdapter,
      primarySearchAdapter,
      remoteHttpIngressActive,
      directVaultPathActive,
      canonicalSharedIngressConfigured: remoteMcp.usesCanonicalSharedIngress,
    };
  }

  return {
    mode: 'direct-vault-primary',
    summary: vault.looksLikeDesktopVault
      ? 'Direct vault adapters are primary; this can represent either local-only access or shared-host direct vault access'
      : 'Direct vault adapters are primary',
    primaryWriteAdapter,
    primaryReadAdapter,
    primarySearchAdapter,
    remoteHttpIngressActive,
    directVaultPathActive,
    canonicalSharedIngressConfigured: remoteMcp.usesCanonicalSharedIngress,
  };
};

const getRemoteMcpRoutingState = (): { remoteMcpCircuitOpen: boolean; remoteMcpCircuitReason: string | null } => {
  const diagnostics = getRemoteMcpAdapterDiagnostics();
  const now = Date.now();
  const lastErrorMs = parseIsoMs(diagnostics.lastErrorAt);
  const lastSuccessMs = parseIsoMs(diagnostics.lastSuccessAt);
  const lastProbeMs = parseIsoMs(diagnostics.lastProbeAt);

  const recentToolFailures = diagnostics.consecutiveFailures >= REMOTE_MCP_DEPRIORITIZE_AFTER_FAILURES
    && lastErrorMs > 0
    && now - lastErrorMs <= REMOTE_MCP_DEPRIORITIZE_WINDOW_MS
    && lastErrorMs >= lastSuccessMs;

  if (recentToolFailures) {
    return {
      remoteMcpCircuitOpen: true,
      remoteMcpCircuitReason: `recent_tool_failures:${diagnostics.consecutiveFailures}`,
    };
  }

  const recentProbeFailure = lastProbeMs > 0
    && now - lastProbeMs <= REMOTE_MCP_DEPRIORITIZE_WINDOW_MS
    && (
      diagnostics.lastProbe.reachable === false
      || diagnostics.lastProbe.authValid === false
      || diagnostics.lastProbe.toolDiscoveryOk === false
      || diagnostics.lastProbe.remoteObsidianStatusOk === false
    );

  if (recentProbeFailure) {
    return {
      remoteMcpCircuitOpen: true,
      remoteMcpCircuitReason: diagnostics.lastProbe.error || 'recent_probe_failure',
    };
  }

  return {
    remoteMcpCircuitOpen: false,
    remoteMcpCircuitReason: null,
  };
};

const getAdapterOrderForCapability = (capability: ObsidianCapability): string[] => {
  const capabilityOrder = parseCsvList(ORDER_ENV_BY_CAPABILITY[capability]);
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

  const routingState = getRemoteMcpRoutingState();
  if (routingState.remoteMcpCircuitOpen && ordered.length > 1) {
    const degraded = ordered.filter((adapter) => adapter.id === 'remote-mcp');
    if (degraded.length > 0 && degraded.length < ordered.length) {
      return [...ordered.filter((adapter) => adapter.id !== 'remote-mcp'), ...degraded];
    }
  }

  if (ordered.length > 0) {
    return ordered;
  }

  return [remoteMcpObsidianAdapter, nativeCliObsidianAdapter, scriptCliObsidianAdapter];
};

const hasRequestedVaultPath = (vaultPath?: string): boolean => String(vaultPath || '').trim().length > 0;

const isAdapterAvailableForCapability = (
  adapter: ObsidianVaultAdapter,
  capability: ObsidianCapability,
  vaultPath?: string,
): boolean => {
  if (!supportsCapability(adapter, capability)) {
    return false;
  }
  if (adapter.isAvailable()) {
    return true;
  }
  if (adapter.id === 'local-fs' && hasRequestedVaultPath(vaultPath)) {
    return true;
  }
  return false;
};

const pickAdapter = (capability: ObsidianCapability, vaultPath?: string): ObsidianVaultAdapter | null => {
  for (const adapter of getOrderedAdapters(capability)) {
    if (!isAdapterAvailableForCapability(adapter, capability, vaultPath)) {
      continue;
    }
    return adapter;
  }
  return null;
};

export const isObsidianCapabilityAvailable = (capability: ObsidianCapability): boolean => {
  return pickAdapter(capability) !== null;
};

export const getObsidianAdapterRuntimeStatus = (): ObsidianAdapterRuntimeStatus => {
  const routingState = getRemoteMcpRoutingState();
  const adapters = getOrderedAdapters().map((adapter) => ({
    id: adapter.id,
    available: adapter.isAvailable(),
    capabilities: adapter.capabilities,
    deprioritized: routingState.remoteMcpCircuitOpen && adapter.id === 'remote-mcp',
  }));

  const selectedByCapability = Object.fromEntries(
    CORE_CAPABILITIES.map((capability) => [capability, pickAdapter(capability)?.id ?? null]),
  );
  const configuredOrderByCapability = Object.fromEntries(
    CORE_CAPABILITIES.map((capability) => [capability, getAdapterOrderForCapability(capability)]),
  );
  const effectiveOrderByCapability = Object.fromEntries(
    CORE_CAPABILITIES.map((capability) => [
      capability,
      getOrderedAdapters(capability)
        .filter((adapter) => adapter.isAvailable() && supportsCapability(adapter, capability))
        .map((adapter) => adapter.id),
    ]),
  );
  const remoteMcp = getRemoteMcpAdapterDiagnostics();
  const vault = getObsidianVaultRuntimeInfo();
  const accessPosture = buildObsidianVaultAccessPosture({
    selectedByCapability,
    remoteMcp,
    vault,
  });

  return {
    strictMode: OBSIDIAN_ADAPTER_STRICT,
    configuredOrder: [...ADAPTER_ORDER],
    configuredOrderByCapability,
    effectiveOrderByCapability,
    adapters,
    selectedByCapability,
    routingState,
    remoteMcp,
    vault,
    accessPosture,
  };
};

const deriveFrontmatterTitle = (content: string, fileName: string): string => {
  const heading = String(content || '')
    .split('\n')
    .find((line) => /^#\s+/.test(line));
  if (heading) {
    return heading.replace(/^#\s+/, '').trim();
  }

  const normalizedFileName = String(fileName || '').replace(/\\/g, '/');
  return path.posix.basename(normalizedFileName, '.md') || 'Untitled';
};

const ensureObsidianWriteProperties = (params: ObsidianNoteWriteInput): Record<string, ObsidianFrontmatterValue> => {
  const properties: Record<string, ObsidianFrontmatterValue> = {};
  for (const [key, value] of Object.entries(params.properties || {})) {
    if (value === null || value === undefined) continue;
    properties[key] = value;
  }

  if (!String(properties.title || '').trim()) {
    properties.title = deriveFrontmatterTitle(params.content, params.fileName);
  }
  if (!String(properties.created || '').trim()) {
    properties.created = new Date().toISOString();
  }
  if (!String(properties.source || '').trim()) {
    properties.source = 'obsidian-router';
  }
  if (!String(properties.guild_id || '').trim()) {
    properties.guild_id = params.guildId || 'system';
  }

  return properties;
};

const ensureObsidianWriteFrontmatter = (params: ObsidianNoteWriteInput): string => {
  const normalizedContent = String(params.content || '').trimEnd();
  if (hasObsidianFrontmatter(normalizedContent)) {
    return normalizedContent.endsWith('\n') ? normalizedContent : `${normalizedContent}\n`;
  }

  const frontmatter = buildObsidianFrontmatter({
    properties: ensureObsidianWriteProperties(params),
    tags: params.tags,
  });
  return `${frontmatter}\n\n${normalizedContent}\n`;
};

export const readObsidianLoreWithAdapter = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const adapter = pickAdapter('read_lore', params.vaultPath);
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
    logger.warn('[OBSIDIAN-ADAPTER] read_lore failed on %s: %s', adapter.id, getErrorMessage(error));
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
    if (fallback.id === adapter.id || !fallback.readLore) {
      continue;
    }
    if (!isAdapterAvailableForCapability(fallback, 'read_lore', params.vaultPath)) {
      continue;
    }
    try {
      const fallbackHints = await fallback.readLore(params);
      if (fallbackHints.length > 0) {
        logAdapterSignal({ capability: 'read_lore', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: 'fallback_hit' });
        return fallbackHints;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] readLore fallback=%s failed: %s', fallback.id, getErrorMessage(err));
      // Continue fallback chain.
    }
  }

  logAdapterSignal({ capability: 'read_lore', outcome: 'failure', primary: adapter.id, detail: 'all_empty' });
  return [];
};

const maybeCompileKnowledgeArtifacts = async (params: {
  guildId: string;
  vaultPath: string;
  filePath: string;
  content: string;
  properties?: Record<string, ObsidianFrontmatterValue | null>;
  skipKnowledgeCompilation?: boolean;
}): Promise<void> => {
  if (params.skipKnowledgeCompilation) {
    return;
  }

  try {
    const { runKnowledgeCompilationForNote } = await import('./knowledgeCompilerService.ts');
    await runKnowledgeCompilationForNote({
      guildId: params.guildId,
      vaultPath: params.vaultPath,
      filePath: params.filePath,
      content: params.content,
      properties: params.properties,
    });
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] knowledge compilation failed for %s: %s', params.filePath, getErrorMessage(error));
  }
};

export const writeObsidianNoteWithAdapter = async (params: ObsidianNoteWriteInput & { trustedSource?: boolean; skipKnowledgeCompilation?: boolean; allowHighLinkDensity?: boolean }): Promise<{ path: string } | null> => {
  const sanitized = sanitizeForObsidianWrite({
    content: params.content,
    trustedSource: params.trustedSource,
    allowHighLinkDensity: params.allowHighLinkDensity,
  });
  if (sanitized.blocked) {
    logger.warn('[OBSIDIAN-ADAPTER] write_note blocked by sanitizer: %s (file: %s)', sanitized.reasons.join(', '), params.fileName);
    logAdapterSignal({ capability: 'write_note', outcome: 'failure', primary: null, detail: `sanitizer_blocked:${sanitized.reasons.join(',')}` });
    return null;
  }
  const ensuredProperties = ensureObsidianWriteProperties({ ...params, content: sanitized.cleaned.content });
  const sanitizedParams: ObsidianNoteWriteInput = {
    ...params,
    content: ensureObsidianWriteFrontmatter({
      ...params,
      content: sanitized.cleaned.content,
      properties: ensuredProperties,
    }),
    properties: ensuredProperties,
  };

  const adapter = pickAdapter('write_note', params.vaultPath);
  if (!adapter || !adapter.writeNote) {
    logAdapterSignal({ capability: 'write_note', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return null;
  }

  try {
    const primary = await adapter.writeNote(sanitizedParams);
    await maybeCompileKnowledgeArtifacts({
      guildId: sanitizedParams.guildId,
      vaultPath: sanitizedParams.vaultPath,
      filePath: primary.path || sanitizedParams.fileName,
      content: sanitizedParams.content,
      properties: sanitizedParams.properties,
      skipKnowledgeCompilation: params.skipKnowledgeCompilation,
    });
    logAdapterSignal({ capability: 'write_note', outcome: 'success', primary: adapter.id, detail: 'primary_write_ok' });
    return primary;
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] write_note failed on %s: %s', adapter.id, getErrorMessage(error));
    logAdapterSignal({
      capability: 'write_note',
      outcome: 'failure',
      primary: adapter.id,
      detail: OBSIDIAN_ADAPTER_STRICT ? 'strict_primary_error' : 'primary_error_no_fallback',
    });
    return null;
  }
};

export const searchObsidianVaultWithAdapter = async (params: ObsidianSearchQuery): Promise<ObsidianSearchResult[]> => {
  const adapter = pickAdapter('search_vault', params.vaultPath);
  if (!adapter || !adapter.searchVault) {
    logAdapterSignal({ capability: 'search_vault', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return [];
  }

  let primaryResults: ObsidianSearchResult[] = [];
  let primaryFailed = false;
  try {
    primaryResults = await adapter.searchVault(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] search_vault failed on %s: %s', adapter.id, getErrorMessage(error));
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
    if (fallback.id === adapter.id || !fallback.searchVault) {
      continue;
    }
    if (!isAdapterAvailableForCapability(fallback, 'search_vault', params.vaultPath)) {
      continue;
    }
    try {
      const fallbackResults = await fallback.searchVault(params);
      if (fallbackResults.length > 0) {
        logAdapterSignal({ capability: 'search_vault', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: primaryFailed ? 'primary_error_fallback_hit' : 'fallback_hit' });
        return fallbackResults;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] searchVault fallback=%s failed: %s', fallback.id, getErrorMessage(err));
      // Continue fallback chain.
    }
  }

  logAdapterSignal({ capability: 'search_vault', outcome: 'failure', primary: adapter.id, detail: primaryFailed ? 'primary_error_all_fallback_empty' : 'all_empty' });
  return [];
};

export const readObsidianFileWithAdapter = async (params: ObsidianReadFileQuery): Promise<string | null> => {
  const adapter = pickAdapter('read_file', params.vaultPath);
  if (!adapter || !adapter.readFile) {
    logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return null;
  }

  let primaryContent: string | null = null;
  let primaryFailed = false;
  try {
    primaryContent = await adapter.readFile(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] read_file failed on %s: %s', adapter.id, getErrorMessage(error));
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
    if (fallback.id === adapter.id || !fallback.readFile) {
      continue;
    }
    if (!isAdapterAvailableForCapability(fallback, 'read_file', params.vaultPath)) {
      continue;
    }
    try {
      const fallbackContent = await fallback.readFile(params);
      if (fallbackContent !== null) {
        logAdapterSignal({ capability: 'read_file', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: primaryFailed ? 'primary_error_fallback_hit' : 'fallback_hit' });
        return fallbackContent;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] readFile fallback=%s failed: %s', fallback.id, getErrorMessage(err));
      // Continue fallback chain.
    }
  }

  logAdapterSignal({ capability: 'read_file', outcome: 'failure', primary: adapter.id, detail: primaryFailed ? 'primary_error_all_fallback_empty' : 'all_empty' });
  return null;
};

export const getObsidianGraphMetadataWithAdapter = async (params: { vaultPath: string }): Promise<Record<string, ObsidianNode>> => {
  const adapter = pickAdapter('graph_metadata', params.vaultPath);
  if (!adapter || !adapter.getGraphMetadata) {
    logAdapterSignal({ capability: 'graph_metadata', outcome: 'failure', primary: null, detail: 'no_adapter' });
    return {};
  }

  let primaryResult: Record<string, ObsidianNode> = {};
  let primaryFailed = false;
  try {
    primaryResult = await adapter.getGraphMetadata(params);
  } catch (error) {
    logger.warn('[OBSIDIAN-ADAPTER] graph_metadata failed on %s: %s', adapter.id, getErrorMessage(error));
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
    if (fallback.id === adapter.id || !fallback.getGraphMetadata) {
      continue;
    }
    if (!isAdapterAvailableForCapability(fallback, 'graph_metadata', params.vaultPath)) {
      continue;
    }
    try {
      const fallbackMetadata = await fallback.getGraphMetadata(params);
      if (Object.keys(fallbackMetadata).length > 0) {
        logAdapterSignal({ capability: 'graph_metadata', outcome: 'degraded', primary: adapter.id, fallback: fallback.id, detail: primaryFailed ? 'primary_error_fallback_hit' : 'fallback_hit' });
        return fallbackMetadata;
      }
    } catch (err) {
      logger.debug('[OBSIDIAN-ROUTER] graphMetadata fallback=%s failed: %s', fallback.id, getErrorMessage(err));
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
    .filter((adapter) => {
      if (typeof adapter.warmup !== 'function') {
        return false;
      }
      return adapter.isAvailable() || (adapter.id === 'local-fs' && hasRequestedVaultPath(safeVaultPath));
    })
    .map(async (adapter) => {
      try {
        await adapter.warmup?.({ vaultPath: safeVaultPath });
      } catch (error) {
        logger.warn('[OBSIDIAN-ADAPTER] warmup failed on %s: %s', adapter.id, getErrorMessage(error));
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
    logger.warn('[OBSIDIAN-ADAPTER] daily_note append failed on %s: %s', adapter.id, getErrorMessage(error));
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
    logger.warn('[OBSIDIAN-ADAPTER] daily_note read failed on %s: %s', adapter.id, getErrorMessage(error));
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
    logger.warn('[OBSIDIAN-ADAPTER] task_management list failed on %s: %s', adapter.id, getErrorMessage(error));
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
    logger.warn('[OBSIDIAN-ADAPTER] task_management toggle failed on %s: %s', adapter.id, getErrorMessage(error));
    logAdapterSignal({ capability: 'task_management', outcome: 'failure', primary: adapter.id, detail: 'exception' });
    return false;
  }
};

export type ObsidianVaultHealthStatus = {
  healthy: boolean;
  issues: string[];
  adapterStatus: ObsidianAdapterRuntimeStatus;
  writeCapable: boolean;
  readCapable: boolean;
  searchCapable: boolean;
  remoteMcp: RemoteMcpAdapterDiagnostics;
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

  if (adapterStatus.accessPosture.mode === 'mixed-routing') {
    issues.push(
      adapterStatus.accessPosture.summary,
    );
  }

  return {
    healthy: issues.length === 0,
    issues,
    adapterStatus,
    writeCapable,
    readCapable,
    searchCapable,
    remoteMcp: adapterStatus.remoteMcp,
  };
};

export const getObsidianVaultLiveHealthStatus = async (): Promise<ObsidianVaultHealthStatus> => {
  const base = getObsidianVaultHealthStatus();
  const remoteRelevant = base.adapterStatus.accessPosture.mode === 'shared-remote-ingress'
    || base.adapterStatus.accessPosture.mode === 'mixed-routing';

  if (!remoteRelevant) {
    return base;
  }

  const remoteMcp = await probeRemoteMcpAdapter();
  const issues = new Set(base.issues);

  if (remoteMcp.lastProbe.reachable === false) {
    issues.add('Remote MCP server is unreachable — GCP vault path is currently disconnected');
  }
  if (remoteMcp.lastProbe.authValid === false) {
    issues.add('Remote MCP auth failed — OBSIDIAN_REMOTE_MCP_TOKEN may not match MCP_WORKER_AUTH_TOKEN');
  }
  if (remoteMcp.lastProbe.toolDiscoveryOk === false) {
    issues.add('Remote MCP is reachable but tool discovery failed — obsidian tools may not be exposed on the VM');
  }
  if (remoteMcp.lastProbe.remoteObsidianStatusOk === false) {
    issues.add('Remote MCP is reachable but the remote obsidian adapter status probe failed — vault may be locked or unavailable');
  }
  if (remoteMcp.lastError) {
    issues.add(`Recent remote MCP error: ${remoteMcp.lastError}`);
  }

  return {
    ...base,
    healthy: issues.size === 0,
    issues: [...issues],
    remoteMcp,
  };
};

// ── New capability routers ────────────────────────────────────────────────────

export const getObsidianOutlineWithAdapter = async (
  vaultPath: string,
  filePath: string,
): Promise<ObsidianOutlineHeading[]> => {
  const adapter = pickAdapter('outline', vaultPath);
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
  const adapter = pickAdapter('search_context', vaultPath);
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
  const adapter = pickAdapter('property_read', vaultPath);
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
  const adapter = pickAdapter('set_property', vaultPath);
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
  const adapter = pickAdapter('files_list', vaultPath);
  if (!adapter?.listFiles) return [];
  try {
    const files = await adapter.listFiles({ vaultPath, folder, extension });
    return Array.isArray(files) ? files : [];
  } catch {
    return [];
  }
};

export const appendObsidianContentWithAdapter = async (
  vaultPath: string,
  filePath: string,
  content: string,
): Promise<boolean> => {
  const adapter = pickAdapter('append_content', vaultPath);
  if (!adapter?.appendContent) return false;
  try {
    return await adapter.appendContent({ vaultPath, filePath, content });
  } catch {
    return false;
  }
};
