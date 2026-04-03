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
export const KNOWN_ADAPTER_IDS = new Set<string>(['openshell', 'nemoclaw', 'openclaw', 'openjarvis']);

/** Validate and narrow a string to ExternalAdapterId. Returns null on invalid. */
export const validateAdapterId = (id: unknown): ExternalAdapterId | null => {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim().toLowerCase();
  if (!ADAPTER_ID_PATTERN.test(trimmed)) return null;
  return trimmed as ExternalAdapterId;
};

export type ExternalAdapterCapability =
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
  | 'jarvis.serve'
  | 'jarvis.optimize'
  | 'jarvis.bench'
  | 'jarvis.trace'
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
  capabilities: readonly string[];
  /** Capabilities available in lite mode (no CLI, LiteLLM proxy only). Undefined means all or none. */
  liteCapabilities?: readonly string[];
  isAvailable: () => Promise<boolean>;
  execute: (action: string, args: Record<string, unknown>) => Promise<ExternalAdapterResult>;
};
