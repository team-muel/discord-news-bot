/**
 * Central MCP Skill Router
 *
 * Replaces static env-var-based worker URL lookup with a health-aware,
 * centralized routing layer. Features:
 *
 * 1. Worker registry with auto-discovery via /tools/discover probes
 * 2. Health-aware routing — skip unhealthy workers, prefer lowest-latency
 * 3. Capability-based skill→worker resolution (multiple workers can serve same skill)
 * 4. Background health sweep for proactive failure detection
 *
 * All existing callers continue using getMcpWorkerUrl(kind) from mcpDelegate.ts;
 * this module adds an overlay that enriches routing decisions.
 */

import {
  MCP_SKILL_ROUTER_ENABLED,
  MCP_HEALTH_SWEEP_INTERVAL_MS,
  MCP_PROBE_TIMEOUT_MS,
  MCP_HEALTH_TTL_MS,
} from '../config';
import logger from '../logger';
import { TtlCache } from '../utils/ttlCache';
import { getErrorMessage } from '../utils/errorMessage';

// ──── Config ────────────────────────────────────────────────────────────────────

const ROUTER_ENABLED = MCP_SKILL_ROUTER_ENABLED;
const HEALTH_SWEEP_INTERVAL_MS = MCP_HEALTH_SWEEP_INTERVAL_MS;
const PROBE_TIMEOUT_MS = MCP_PROBE_TIMEOUT_MS;
const HEALTH_TTL_MS = MCP_HEALTH_TTL_MS;

// ──── Types ───────────────────────────────────────────────────────────────────

export type WorkerCapability = {
  toolName: string;
  available: boolean;
};

export type RegisteredWorker = {
  id: string;
  url: string;
  capabilities: string[];
  healthy: boolean;
  lastLatencyMs: number;
  lastCheckedAt: number;
  consecutiveFailures: number;
};

export type RouteResult = {
  workerUrl: string;
  workerId: string;
  latencyMs: number;
} | null;

// ──── Worker Registry ─────────────────────────────────────────────────────────

const workers = new Map<string, RegisteredWorker>();
const capabilityIndex = new Map<string, Set<string>>(); // capability → worker ids
const MAX_WORKERS = 50;
const routeCache = new TtlCache<RouteResult>(200);
const ROUTE_CACHE_TTL_MS = 10_000;

/**
 * Register a worker by URL. Probes /tools/discover for capabilities.
 */
export const registerWorker = async (id: string, url: string): Promise<RegisteredWorker> => {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('WORKER_URL_EMPTY');
  if (workers.size >= MAX_WORKERS && !workers.has(id)) {
    throw new Error('MAX_WORKERS_EXCEEDED');
  }

  const capabilities = await probeWorkerCapabilities(base);
  const worker: RegisteredWorker = {
    id,
    url: base,
    capabilities,
    healthy: true,
    lastLatencyMs: 0,
    lastCheckedAt: Date.now(),
    consecutiveFailures: 0,
  };

  // Clean stale capability entries if re-registering an existing worker
  const existing = workers.get(id);
  if (existing) {
    for (const oldCap of existing.capabilities) {
      capabilityIndex.get(oldCap)?.delete(id);
    }
  }

  workers.set(id, worker);
  for (const cap of capabilities) {
    if (!capabilityIndex.has(cap)) capabilityIndex.set(cap, new Set());
    capabilityIndex.get(cap)!.add(id);
  }

  logger.info('[MCP-ROUTER] Registered worker id=%s url=%s caps=%s', id, base, capabilities.join(','));
  return worker;
};

/**
 * Resolve the best healthy worker for a given tool/capability name.
 * Prefers lowest-latency among healthy workers.
 */
export const resolveWorker = (toolName: string): RouteResult => {
  if (!ROUTER_ENABLED) return null;

  const cached = routeCache.get(toolName);
  if (cached !== null) return cached;

  const workerIds = capabilityIndex.get(toolName);
  if (!workerIds || workerIds.size === 0) return null;

  let best: RegisteredWorker | null = null;
  for (const wid of workerIds) {
    const w = workers.get(wid);
    if (!w || !w.healthy) continue;
    if (!best || w.lastLatencyMs < best.lastLatencyMs) {
      best = w;
    }
  }

  if (!best) return null;

  const result: RouteResult = {
    workerUrl: best.url,
    workerId: best.id,
    latencyMs: best.lastLatencyMs,
  };
  routeCache.set(toolName, result, ROUTE_CACHE_TTL_MS);
  return result;
};

/**
 * Resolve by worker kind (for backward compatibility with McpWorkerKind).
 * Worker id pattern: kind directly maps to worker id.
 */
export const resolveWorkerByKind = (kind: string): RouteResult => {
  const w = workers.get(kind);
  if (!w || !w.healthy) return null;
  return { workerUrl: w.url, workerId: w.id, latencyMs: w.lastLatencyMs };
};

// ──── Health Probing ──────────────────────────────────────────────────────────

const probeWorkerCapabilities = async (baseUrl: string): Promise<string[]> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const start = Date.now();
    const res = await fetch(`${baseUrl}/tools/discover`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return [];
    const data = await res.json() as { tools?: Array<{ name?: string; available?: boolean }> };
    return (data.tools || [])
      .filter((t) => t.available !== false)
      .map((t) => String(t.name || ''))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const probeWorkerHealth = async (worker: RegisteredWorker): Promise<void> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${worker.url}/health`, { signal: controller.signal });
    clearTimeout(timer);

    const latency = Date.now() - start;
    worker.lastLatencyMs = latency;
    worker.lastCheckedAt = Date.now();

    if (res.ok) {
      worker.healthy = true;
      worker.consecutiveFailures = 0;
    } else {
      worker.consecutiveFailures++;
      worker.healthy = worker.consecutiveFailures < 3;
    }
  } catch {
    worker.lastLatencyMs = Date.now() - start;
    worker.lastCheckedAt = Date.now();
    worker.consecutiveFailures++;
    worker.healthy = worker.consecutiveFailures < 3;
  }
};

/**
 * Run a single health sweep across all registered workers.
 */
export const runHealthSweep = async (): Promise<void> => {
  const now = Date.now();
  const staleWorkers = [...workers.values()].filter(
    (w) => now - w.lastCheckedAt >= HEALTH_TTL_MS,
  );

  if (staleWorkers.length === 0) return;

  await Promise.allSettled(staleWorkers.map((w) => probeWorkerHealth(w)));
  logger.debug('[MCP-ROUTER] Health sweep: %d workers probed', staleWorkers.length);
};

// ──── Auto-registration from env vars ─────────────────────────────────────────

let healthSweepTimer: ReturnType<typeof setInterval> | null = null;

const ENV_WORKER_MAP: Array<{ id: string; envKeys: string[] }> = [
  { id: 'architect', envKeys: ['MCP_ARCHITECT_WORKER_URL', 'MCP_OPENDEV_WORKER_URL'] },
  { id: 'review', envKeys: ['MCP_REVIEW_WORKER_URL', 'MCP_NEMOCLAW_WORKER_URL'] },
  { id: 'operate', envKeys: ['MCP_OPERATE_WORKER_URL', 'MCP_OPENJARVIS_WORKER_URL'] },
  { id: 'coordinate', envKeys: ['MCP_COORDINATE_WORKER_URL', 'MCP_LOCAL_ORCHESTRATOR_WORKER_URL'] },
  { id: 'implement', envKeys: ['MCP_IMPLEMENT_WORKER_URL', 'MCP_OPENCODE_WORKER_URL'] },
  { id: 'youtube', envKeys: ['MCP_YOUTUBE_WORKER_URL'] },
  { id: 'news', envKeys: ['MCP_NEWS_WORKER_URL'] },
  { id: 'community', envKeys: ['MCP_COMMUNITY_WORKER_URL'] },
  { id: 'web', envKeys: ['MCP_WEB_WORKER_URL'] },
];

/**
 * Initialize the skill router by auto-registering workers from env vars.
 * Should be called once during startup.
 */
export const initMcpSkillRouter = async (): Promise<void> => {
  if (!ROUTER_ENABLED) {
    logger.info('[MCP-ROUTER] Disabled via MCP_SKILL_ROUTER_ENABLED');
    return;
  }

  const registered: string[] = [];

  for (const spec of ENV_WORKER_MAP) {
    // Dynamic key lookup — keys are defined in ENV_WORKER_MAP, cannot be pre-read in config.ts
    const url = spec.envKeys
      .map((k) => String(process.env[k] || '').trim())
      .find((v) => v.length > 0);

    if (url) {
      try {
        await registerWorker(spec.id, url);
        registered.push(spec.id);
      } catch (err) {
        logger.warn('[MCP-ROUTER] Failed to register %s: %s', spec.id, getErrorMessage(err));
      }
    }
  }

  logger.info('[MCP-ROUTER] Initialized with %d workers: %s', registered.length, registered.join(', '));

  // Start background health sweep
  if (healthSweepTimer) clearInterval(healthSweepTimer);
  healthSweepTimer = setInterval(() => {
    void runHealthSweep();
  }, HEALTH_SWEEP_INTERVAL_MS);
  healthSweepTimer.unref();
};

/** Stop the background health sweep timer (for graceful shutdown or tests). */
export const stopMcpSkillRouter = (): void => {
  if (healthSweepTimer) {
    clearInterval(healthSweepTimer);
    healthSweepTimer = null;
  }
};

// ──── Diagnostics ─────────────────────────────────────────────────────────────

export type RouterSnapshot = {
  enabled: boolean;
  workerCount: number;
  workers: Array<{
    id: string;
    url: string;
    healthy: boolean;
    latencyMs: number;
    capabilities: string[];
    consecutiveFailures: number;
    lastCheckedAt: string;
  }>;
  capabilityCount: number;
};

export const getRouterSnapshot = (): RouterSnapshot => ({
  enabled: ROUTER_ENABLED,
  workerCount: workers.size,
  workers: [...workers.values()].map((w) => ({
    id: w.id,
    url: w.url,
    healthy: w.healthy,
    latencyMs: w.lastLatencyMs,
    capabilities: [...w.capabilities],
    consecutiveFailures: w.consecutiveFailures,
    lastCheckedAt: new Date(w.lastCheckedAt).toISOString(),
  })),
  capabilityCount: capabilityIndex.size,
});
