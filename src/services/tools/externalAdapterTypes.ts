/**
 * External tool adapter types — separate from the CLI tool adapter contract.
 * These adapters wrap external tool CLIs and HTTP APIs (OpenShell, NemoClaw,
 * OpenClaw, OpenJarvis) with capability-based discovery.
 *
 * M-15: ExternalAdapterId is now a validated string (not a closed union).
 * New adapters can register any ID matching the ADAPTER_ID_PATTERN.
 * The KNOWN_ADAPTER_IDS set preserves backward compatibility for built-in adapters.
 */

/** Adapter ID: lowercase alphanumeric + hyphens, 2-50 chars. */
export type ExternalAdapterId = string & { readonly __brand?: 'ExternalAdapterId' };

/** Pattern for valid adapter IDs. */
export const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,49}$/;

/** Built-in adapter IDs for backward compatibility. */
export const KNOWN_ADAPTER_IDS = new Set<string>([
  'openshell', 'nemoclaw', 'openclaw', 'openjarvis',
  'n8n', 'deepwiki', 'obsidian', 'render',
  'ollama', 'litellm-admin', 'mcp-indexing', 'workstation',
]);

/** Validate and narrow a string to ExternalAdapterId. Returns null on invalid. */
export const validateAdapterId = (id: unknown): ExternalAdapterId | null => {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim().toLowerCase();
  if (!ADAPTER_ID_PATTERN.test(trimmed)) return null;
  return trimmed as ExternalAdapterId;
};

export type ExternalAdapterCapability =
  | 'workstation.health'
  | 'command.exec'
  | 'browser.open'
  | 'app.launch'
  | 'app.activate'
  | 'input.text'
  | 'input.hotkey'
  | 'screen.capture'
  | 'file.list'
  | 'file.read'
  | 'file.write'
  | 'sandbox.create'
  | 'sandbox.list'
  | 'sandbox.exec'
  | 'sandbox.destroy'
  | 'policy.set'
  | 'agent.onboard'
  | 'agent.status'
  | 'agent.connect'
  | 'agent.chat'
  | 'agent.skill.create'
  | 'agent.session.relay'
  | 'code.review'
  | 'jarvis.ask'
  | 'jarvis.server.info'
  | 'jarvis.models.list'
  | 'jarvis.tools.list'
  | 'jarvis.agents.health'
  | 'jarvis.recommended-model'
  | 'jarvis.agent.list'
  | 'jarvis.agent.get'
  | 'jarvis.agent.create'
  | 'jarvis.agent.delete'
  | 'jarvis.agent.pause'
  | 'jarvis.agent.resume'
  | 'jarvis.agent.run'
  | 'jarvis.agent.recover'
  | 'jarvis.agent.message'
  | 'jarvis.agent.state'
  | 'jarvis.agent.messages.list'
  | 'jarvis.agent.tasks.list'
  | 'jarvis.agent.traces.list'
  | 'jarvis.agent.trace.get'
  | 'jarvis.serve'
  | 'jarvis.optimize'
  | 'jarvis.bench'
  | 'jarvis.feedback'
  | 'jarvis.research'
  | 'jarvis.digest'
  | 'jarvis.memory.index'
  | 'jarvis.memory.search'
  | 'jarvis.eval'
  | 'jarvis.telemetry'
  | 'jarvis.scheduler.list'
  | 'jarvis.skill.search'
  | 'workflow.execute'
  | 'workflow.list'
  | 'workflow.trigger'
  | 'workflow.status'
  | (string & {});  // allow custom capabilities from dynamic adapters

export type ExternalAdapterResult = {
  ok: boolean;
  adapterId: ExternalAdapterId;
  action: string;
  summary: string;
  output: string[];
  error?: string;
  durationMs: number;
};

export type ExternalToolAdapter = {
  id: ExternalAdapterId;
  /** Human-readable description of what this adapter does (for agent reasoning and tool catalog). */
  description?: string;
  capabilities: readonly string[];
  /** Capabilities available in lite mode (no CLI, LiteLLM proxy only). Undefined means all or none. */
  liteCapabilities?: readonly string[];
  isAvailable: () => Promise<boolean>;
  execute: (action: string, args: Record<string, unknown>) => Promise<ExternalAdapterResult>;
};

// ──── Shared adapter helpers ──────────────────────────────────────────────────

/**
 * Build a standardized ExternalAdapterResult.
 * Omits `error` key entirely when not provided (keeps serialized output clean).
 */
export const makeAdapterResult = (
  adapterId: ExternalAdapterId,
  ok: boolean,
  action: string,
  summary: string,
  output: string[],
  durationMs: number,
  error?: string,
): ExternalAdapterResult => ({
  ok,
  adapterId,
  action,
  summary,
  output,
  durationMs,
  ...(error ? { error } : {}),
});

/**
 * Evaluate the standard opt-out / legacy enable flag pair used by all adapters.
 *
 * Pattern:
 *   DISABLED env = true  → disabled (opt-out wins)
 *   ENABLED env  = false → disabled (legacy compat)
 *   Otherwise           → enabled
 */
export const isAdapterEnabled = (
  explicitlyDisabled: boolean,
  legacyEnabledRaw: string | undefined,
): boolean => !explicitlyDisabled && legacyEnabledRaw !== 'false';
