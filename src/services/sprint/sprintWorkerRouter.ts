/**
 * Sprint worker health cache + adapter circuit breaker.
 * Extracted from sprintOrchestrator to reduce file size.
 */
import logger from '../../logger';
import { CircuitBreaker } from '../../utils/circuitBreaker';
import { TtlCache } from '../../utils/ttlCache';
import { readLocalCache } from '../localStateCache';
import type { SprintPhase } from './sprintOrchestrator';
import type { McpWorkerKind } from '../skills/actions/mcpDelegate';

// Phase → MCP worker kind
export const PHASE_WORKER_KIND: Partial<Record<SprintPhase, McpWorkerKind>> = {
  plan: 'architect',
  implement: 'implement',
  review: 'review',
  'security-audit': 'review',
  'ops-validate': 'operate',
  ship: 'operate',
  retro: 'architect',
};

// Phase → external adapter fallback for when MCP workers are absent
// Multi-adapter chain: primary adapter + optional secondary for deeper analysis
export type PhaseAdapterMapping = {
  adapterId: string;
  action: string;
  /** Optional secondary adapter for composite phase execution */
  secondary?: { adapterId: string; action: string };
};

export const PHASE_EXTERNAL_ADAPTER: Partial<Record<SprintPhase, PhaseAdapterMapping>> = {
  plan: { adapterId: 'deepwiki', action: 'wiki.ask', secondary: { adapterId: 'openjarvis', action: 'jarvis.research' } },
  review: { adapterId: 'review', action: 'code.review', secondary: { adapterId: 'deepwiki', action: 'wiki.diagnose' } },
  qa: { adapterId: 'openjarvis', action: 'jarvis.ask', secondary: { adapterId: 'openshell', action: 'sandbox.exec' } },
  'security-audit': { adapterId: 'review', action: 'code.review', secondary: { adapterId: 'openjarvis', action: 'jarvis.memory.search' } },
  'ops-validate': { adapterId: 'openjarvis', action: 'jarvis.telemetry', secondary: { adapterId: 'openjarvis', action: 'jarvis.ask' } },
  retro: { adapterId: 'deepwiki', action: 'wiki.ask', secondary: { adapterId: 'openjarvis', action: 'jarvis.digest' } },
};

export const getPhaseExternalAdapterMap = () => ({ ...PHASE_EXTERNAL_ADAPTER });

// ── Worker health cache (uses shared TtlCache utility) ──
const WORKER_HEALTH_CACHE_TTL_MS = 60_000;
const workerHealthCache = new TtlCache<boolean>(50);

export const isWorkerKnownDead = (workerUrl: string): boolean => {
  const healthy = workerHealthCache.get(workerUrl);
  if (healthy === null) return false;
  return !healthy;
};

export const recordWorkerHealth = (workerUrl: string, healthy: boolean): void => {
  workerHealthCache.set(workerUrl, healthy, WORKER_HEALTH_CACHE_TTL_MS);
};

export const getWorkerHealthCacheSnapshot = (): Record<string, unknown> => {
  return { size: workerHealthCache.size() };
};

// ── Adapter circuit breaker ──
const adapterCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  cooldownMs: 60_000,
  failureWindowMs: 120_000,
  maxEntries: 100,
  onTrip: (key, failures) => logger.warn('[SPRINT-CB] adapter %s circuit OPEN after %d failures', key, failures),
});

export const isAdapterCircuitOpen = (adapterId: string): boolean => adapterCircuitBreaker.isOpen(adapterId);

export const recordAdapterResult = (adapterId: string, success: boolean): void => {
  if (success) adapterCircuitBreaker.recordSuccess(adapterId);
  else adapterCircuitBreaker.recordFailure(adapterId);
};

export const getAdapterCircuitBreakerSnapshot = () => adapterCircuitBreaker.getSnapshot();

// ── External adapter args builder ──
export const buildExternalAdapterArgs = (
  phase: SprintPhase,
  pipeline: { sprintId: string; objective: string; changedFiles: string[]; codeChanges?: Array<{ filePath: string; newContent?: string }> },
): Record<string, unknown> => {
  // Lazy resolution: prefer full diffs from local cache (no truncation),
  // fall back to pipeline.codeChanges (in-memory), then changed file names only
  const cachedDiffs = readLocalCache<Array<{ filePath: string; newContent: string }>>(
    `sprint-${pipeline.sprintId}-diffs`,
  );
  const codeSnippet = (cachedDiffs ?? pipeline.codeChanges)?.map((c) => `--- ${c.filePath} ---\n${c.newContent || ''}`).join('\n\n') || pipeline.changedFiles.join('\n');

  switch (phase) {
    case 'plan':
      return {
        repo: 'team-muel/discord-news-bot',
        question: `Architecture analysis for: ${pipeline.objective}. Files: ${pipeline.changedFiles.join(', ')}`,
      };
    case 'qa':
      return {
        question: `Analyze test coverage gaps and suggest missing test cases for: ${pipeline.objective}. Changed files: ${pipeline.changedFiles.join(', ')}\n\nCode:\n${codeSnippet.slice(0, 4000)}`,
        agent: 'orchestrator',
      };
    case 'review':
      return { code: codeSnippet, goal: pipeline.objective };
    case 'security-audit':
      return {
        code: codeSnippet,
        goal: `Security audit: ${pipeline.objective}. Check OWASP Top 10, injection, auth bypass, secret exposure.`,
      };
    case 'ops-validate':
      return { window: '1h' };
    case 'retro':
      return {
        repo: 'team-muel/discord-news-bot',
        question: `Retrospective: what worked, what broke, lessons learned for: ${pipeline.objective}`,
      };
    default:
      return {
        code: codeSnippet,
        goal: pipeline.objective,
        question: `Sprint phase "${phase}" objective: ${pipeline.objective}. Changed files: ${pipeline.changedFiles.join(', ')}`,
      };
  }
};

/** Build args for secondary adapter call (composite phase execution). */
export const buildSecondaryAdapterArgs = (
  phase: SprintPhase,
  pipeline: { sprintId: string; objective: string; changedFiles: string[]; codeChanges?: Array<{ filePath: string; newContent?: string }> },
  primaryOutput: string,
): Record<string, unknown> => {
  const cachedDiffs = readLocalCache<Array<{ filePath: string; newContent: string }>>(
    `sprint-${pipeline.sprintId}-diffs`,
  );
  const codeSnippet = (cachedDiffs ?? pipeline.codeChanges)?.map((c) => `--- ${c.filePath} ---\n${c.newContent || ''}`).join('\n\n') || pipeline.changedFiles.join('\n');

  switch (phase) {
    case 'plan':
      // jarvis.research: deep dive based on wiki findings
      return { query: `Based on codebase analysis, research best practices for: ${pipeline.objective}\n\nContext:\n${primaryOutput.slice(0, 2000)}` };
    case 'review':
      return {
        repo: 'team-muel/discord-news-bot',
        phase: 'review',
        objective: pipeline.objective,
        changedFiles: pipeline.changedFiles,
        primaryOutput: primaryOutput.slice(0, 2_000),
      };
    case 'qa':
      // openshell.sandbox.exec: run tests in isolation
      return { sandboxId: 'default', command: `cd /workspace && npx vitest run --reporter=verbose 2>&1 | head -50`, mode: 'read_only' };
    case 'security-audit':
      // jarvis.memory.search: find related security issues from knowledge base
      return { query: `security vulnerabilities: ${pipeline.objective}`, limit: 5 };
    case 'ops-validate':
      // jarvis.ask: interpret telemetry results
      return {
        question: `Interpret these operational metrics and identify risks:\n${primaryOutput.slice(0, 2000)}\n\nObjective: ${pipeline.objective}`,
        agent: 'orchestrator',
      };
    case 'retro':
      // jarvis.digest: auto-generate sprint summary
      return { topic: `Sprint retro: ${pipeline.objective}`, sources: ['traces'] };
    default:
      return { question: primaryOutput.slice(0, 2000) };
  }
};
