/**
 * External tool adapter types — separate from the CLI tool adapter contract.
 * These adapters wrap external tool CLIs and HTTP APIs (OpenShell, NemoClaw,
 * OpenClaw, OpenJarvis) with capability-based discovery.
 */

export type ExternalAdapterId = 'openshell' | 'nemoclaw' | 'openclaw' | 'openjarvis';

export type ExternalAdapterCapability =
  | 'sandbox.create'
  | 'sandbox.list'
  | 'policy.set'
  | 'agent.onboard'
  | 'agent.status'
  | 'agent.connect'
  | 'agent.chat'
  | 'agent.skill.create'
  | 'code.review'
  | 'jarvis.ask'
  | 'jarvis.serve'
  | 'jarvis.optimize'
  | 'jarvis.bench'
  | 'jarvis.trace';

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
  capabilities: readonly ExternalAdapterCapability[];
  isAvailable: () => Promise<boolean>;
  execute: (action: string, args: Record<string, unknown>) => Promise<ExternalAdapterResult>;
};
