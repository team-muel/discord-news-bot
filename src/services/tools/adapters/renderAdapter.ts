/**
 * Render MCP Tool Adapter — exposes Render platform management as an ExternalToolAdapter.
 *
 * Provides service management, deploy monitoring, log retrieval, metrics analysis,
 * and Postgres querying via the Render hosted MCP server (https://mcp.render.com/mcp)
 * or REST API (https://api.render.com/v1).
 *
 * Capabilities:
 *   - service.list: list services in current workspace
 *   - service.details: get service details by ID
 *   - deploy.list: list deploy history for a service
 *   - deploy.details: get specific deploy details
 *   - log.query: query service logs with filters
 *   - metrics.get: get service performance metrics
 *   - env.list: list environment variables for a service
 *   - env.update: update environment variables (destructive — requires confirmation)
 *   - postgres.query: run read-only SQL against Render Postgres
 *
 * Environment:
 *   RENDER_API_KEY — Render API key (required)
 *   RENDER_API_BASE_URL — default https://api.render.com/v1
 *   RENDER_TIMEOUT_MS — default 15000
 *   RENDER_ADAPTER_DISABLED — set true to force-disable
 *   RENDER_WORKSPACE_ID — optional default workspace
 */

import logger from '../../../logger';
import { parseBooleanEnv, parseMinIntEnv, parseStringEnv, parseUrlEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';
import { getErrorMessage } from '../../../utils/errorMessage';

const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.RENDER_ADAPTER_DISABLED, false);
const API_KEY = parseStringEnv(process.env.RENDER_API_KEY, '');
const BASE_URL = parseUrlEnv(process.env.RENDER_API_BASE_URL, 'https://api.render.com/v1');
const TIMEOUT_MS = parseMinIntEnv(process.env.RENDER_TIMEOUT_MS, 15_000, 5_000);
const DEFAULT_WORKSPACE = parseStringEnv(process.env.RENDER_WORKSPACE_ID, '');

// ──── Helpers ─────────────────────────────────────────────────────────────────

const ADAPTER_ID = 'render' as ExternalAdapterId;

const makeResult = (
  ok: boolean,
  action: string,
  summary: string,
  output: string[],
  durationMs: number,
  error?: string,
): ExternalAdapterResult => ({
  ok,
  adapterId: ADAPTER_ID,
  action,
  summary,
  output,
  durationMs,
  ...(error ? { error } : {}),
});

/** Validate Render resource IDs to prevent path injection. */
const RENDER_ID_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;

const validateId = (id: unknown, label: string): string | null => {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!RENDER_ID_PATTERN.test(trimmed)) {
    logger.warn('[RENDER-ADAPTER] invalid %s: %s', label, trimmed.slice(0, 50));
    return null;
  }
  return trimmed;
};

const fetchRender = async (
  path: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        ...options?.headers,
      },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
};

// ──── Actions ─────────────────────────────────────────────────────────────────

const listServices = async (limit?: number): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const clampedLimit = Math.min(Math.max(1, limit || 20), 100);
  try {
    const { ok, body, status } = await fetchRender(`/services?limit=${clampedLimit}`);
    if (!ok) return makeResult(false, 'service.list', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);

    const services = Array.isArray(body) ? body : [];
    const summaries = services.map((s: Record<string, unknown>) => {
      const svc = (s as Record<string, unknown>).service as Record<string, unknown> | undefined ?? s;
      return `${svc.name || svc.id || 'unknown'} (${svc.type || '?'}) — ${svc.serviceDetails && typeof svc.serviceDetails === 'object' ? (svc.serviceDetails as Record<string, unknown>).url || '' : ''}`.trim();
    });

    return makeResult(true, 'service.list', `${summaries.length} services`, summaries, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'service.list', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const getServiceDetails = async (serviceId: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const id = validateId(serviceId, 'serviceId');
  if (!id) return makeResult(false, 'service.details', 'Invalid service ID', [], 0, 'INVALID_ID');

  try {
    const { ok, body, status } = await fetchRender(`/services/${id}`);
    if (!ok) return makeResult(false, 'service.details', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    return makeResult(true, 'service.details', `Service ${id}`, [JSON.stringify(body, null, 2).slice(0, 6000)], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'service.details', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const listDeploys = async (serviceId: string, limit?: number): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const id = validateId(serviceId, 'serviceId');
  if (!id) return makeResult(false, 'deploy.list', 'Invalid service ID', [], 0, 'INVALID_ID');

  const clampedLimit = Math.min(Math.max(1, limit || 10), 50);
  try {
    const { ok, body, status } = await fetchRender(`/services/${id}/deploys?limit=${clampedLimit}`);
    if (!ok) return makeResult(false, 'deploy.list', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);

    const deploys = Array.isArray(body) ? body : [];
    const summaries = deploys.map((d: Record<string, unknown>) => {
      const dep = (d as Record<string, unknown>).deploy as Record<string, unknown> | undefined ?? d;
      return `${dep.id || '?'} — ${dep.status || '?'} (${dep.finishedAt || dep.createdAt || ''})`;
    });

    return makeResult(true, 'deploy.list', `${summaries.length} deploys`, summaries, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'deploy.list', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const getDeployDetails = async (serviceId: string, deployId: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sId = validateId(serviceId, 'serviceId');
  const dId = validateId(deployId, 'deployId');
  if (!sId || !dId) return makeResult(false, 'deploy.details', 'Invalid ID', [], 0, 'INVALID_ID');

  try {
    const { ok, body, status } = await fetchRender(`/services/${sId}/deploys/${dId}`);
    if (!ok) return makeResult(false, 'deploy.details', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    return makeResult(true, 'deploy.details', `Deploy ${dId}`, [JSON.stringify(body, null, 2).slice(0, 6000)], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'deploy.details', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const queryLogs = async (serviceId: string, filters?: Record<string, unknown>): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const id = validateId(serviceId, 'serviceId');
  if (!id) return makeResult(false, 'log.query', 'Invalid service ID', [], 0, 'INVALID_ID');

  // Render API v1 exposes service events (not raw logs). Use /events endpoint.
  const params = new URLSearchParams();
  const limit = Math.min(Math.max(1, Number(filters?.limit) || 20), 100);
  params.set('limit', String(limit));

  try {
    const qs = params.toString();
    const { ok, body, status } = await fetchRender(`/services/${id}/events${qs ? `?${qs}` : ''}`);
    if (!ok) return makeResult(false, 'log.query', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);

    const events = Array.isArray(body) ? body : [];
    const lines = events.slice(0, 100).map((e: Record<string, unknown>) => {
      const evt = (e as Record<string, unknown>).event as Record<string, unknown> | undefined ?? e;
      const details = evt.details as Record<string, unknown> | undefined;
      const deployStatus = details?.deployStatus || details?.status || '';
      const reason = details?.reason ? JSON.stringify(details.reason) : '';
      return `[${evt.timestamp || ''}] ${evt.type || 'event'}: deploy=${details?.deployId || '?'} status=${deployStatus}${reason && reason !== '{}' ? ` reason=${reason}` : ''}`;
    });

    return makeResult(true, 'log.query', `${lines.length} events`, lines, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'log.query', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const getMetrics = async (serviceId: string, _args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const id = validateId(serviceId, 'serviceId');
  if (!id) return makeResult(false, 'metrics.get', 'Invalid service ID', [], 0, 'INVALID_ID');

  // Render starter plan has no metrics API. Derive deploy health from events.
  try {
    const { ok, body, status } = await fetchRender(`/services/${id}/events?limit=50`);
    if (!ok) return makeResult(false, 'metrics.get', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);

    const events = Array.isArray(body) ? body : [];
    let succeeded = 0;
    let failed = 0;
    let total = 0;
    for (const e of events) {
      const evt = (e as Record<string, unknown>).event as Record<string, unknown> | undefined ?? e;
      const details = evt.details as Record<string, unknown> | undefined;
      const deployStatus = String(details?.deployStatus || '');
      if (deployStatus) {
        total++;
        if (deployStatus === 'succeeded' || deployStatus === 'live') succeeded++;
        else if (deployStatus === 'build_failed' || deployStatus === 'update_failed') failed++;
      }
    }
    const successRate = total > 0 ? Math.round((succeeded / total) * 100) : 'N/A';

    const output = [
      `Deploy health (last ${events.length} events):`,
      `  Total deploys: ${total}`,
      `  Succeeded: ${succeeded}`,
      `  Failed: ${failed}`,
      `  Success rate: ${successRate}%`,
    ];

    return makeResult(true, 'metrics.get', `Deploy health for ${id}`, output, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'metrics.get', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const listEnvVars = async (serviceId: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const id = validateId(serviceId, 'serviceId');
  if (!id) return makeResult(false, 'env.list', 'Invalid service ID', [], 0, 'INVALID_ID');

  try {
    const { ok, body, status } = await fetchRender(`/services/${id}/env-vars`);
    if (!ok) return makeResult(false, 'env.list', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);

    const vars = Array.isArray(body) ? body : [];
    const summaries = vars.map((v: Record<string, unknown>) => {
      const envVar = (v as Record<string, unknown>).envVar as Record<string, unknown> | undefined ?? v;
      // Redact values — only show keys
      return `${envVar.key || '?'} = ${envVar.value ? '[SET]' : '[EMPTY]'}`;
    });

    return makeResult(true, 'env.list', `${summaries.length} env vars`, summaries, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'env.list', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const updateEnvVars = async (serviceId: string, vars: unknown): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const id = validateId(serviceId, 'serviceId');
  if (!id) return makeResult(false, 'env.update', 'Invalid service ID', [], 0, 'INVALID_ID');

  if (!Array.isArray(vars) || vars.length === 0) {
    return makeResult(false, 'env.update', 'vars must be a non-empty array of {key, value}', [], 0, 'INVALID_VARS');
  }

  // Validate each var entry
  const sanitized = vars.slice(0, 50).map((v: unknown) => {
    const entry = v as Record<string, unknown>;
    return {
      key: String(entry.key || '').trim().slice(0, 200),
      value: String(entry.value ?? '').slice(0, 10_000),
    };
  }).filter((v) => v.key.length > 0);

  if (sanitized.length === 0) {
    return makeResult(false, 'env.update', 'No valid vars after sanitization', [], 0, 'INVALID_VARS');
  }

  try {
    const { ok, body, status } = await fetchRender(`/services/${id}/env-vars`, {
      method: 'PUT',
      body: JSON.stringify(sanitized),
    });
    if (!ok) return makeResult(false, 'env.update', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);

    const updated = Array.isArray(body) ? body.length : 0;
    return makeResult(true, 'env.update', `Updated ${updated} env vars on ${id}`, [`${sanitized.length} vars applied`], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'env.update', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const queryPostgres = async (databaseId: string, sql: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const id = validateId(databaseId, 'databaseId');
  if (!id) return makeResult(false, 'postgres.query', 'Invalid database ID', [], 0, 'INVALID_ID');

  const sanitizedSql = String(sql || '').trim().slice(0, 10_000);
  if (!sanitizedSql) {
    return makeResult(false, 'postgres.query', 'Empty SQL query', [], 0, 'EMPTY_SQL');
  }

  // Safety: only allow SELECT / WITH / EXPLAIN (read-only)
  const firstWord = sanitizedSql.split(/\s+/)[0]?.toUpperCase() || '';
  if (!['SELECT', 'WITH', 'EXPLAIN'].includes(firstWord)) {
    return makeResult(false, 'postgres.query', 'Only read-only queries (SELECT/WITH/EXPLAIN) allowed', [], 0, 'WRITE_BLOCKED');
  }

  try {
    const { ok, body, status } = await fetchRender(`/postgres/${id}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql: sanitizedSql }),
    });
    if (!ok) return makeResult(false, 'postgres.query', `Render API ${status}`, [], Date.now() - start, `HTTP_${status}`);

    const result = body as Record<string, unknown> | null;
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const output = rows.length > 0
      ? [JSON.stringify(rows.slice(0, 100), null, 2).slice(0, 8000)]
      : ['No rows returned'];

    return makeResult(true, 'postgres.query', `${rows.length} rows`, output, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'postgres.query', 'Render unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

// ──── Adapter Export ──────────────────────────────────────────────────────────

export const renderAdapter: ExternalToolAdapter = {
  id: ADAPTER_ID,
  capabilities: [
    'service.list',
    'service.details',
    'deploy.list',
    'deploy.details',
    'log.query',
    'metrics.get',
    'env.list',
    'env.update',
    'postgres.query',
  ],
  liteCapabilities: [
    'service.list',
    'service.details',
    'deploy.list',
    'log.query',
    'metrics.get',
  ],

  isAvailable: async () => {
    if (EXPLICITLY_DISABLED || !API_KEY) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch(`${BASE_URL}/services?limit=1`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
        });
        return res.status < 500;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  },

  execute: async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    const serviceId = String(args.serviceId || args.service_id || args.id || DEFAULT_WORKSPACE || '');
    const deployId = String(args.deployId || args.deploy_id || '');
    const databaseId = String(args.databaseId || args.database_id || '');
    const limit = typeof args.limit === 'number' ? args.limit : undefined;

    switch (action) {
      case 'service.list':
        return listServices(limit);
      case 'service.details':
        return getServiceDetails(serviceId);
      case 'deploy.list':
        return listDeploys(serviceId, limit);
      case 'deploy.details':
        return getDeployDetails(serviceId, deployId);
      case 'log.query':
        return queryLogs(serviceId, args);
      case 'metrics.get':
        return getMetrics(serviceId, args);
      case 'env.list':
        return listEnvVars(serviceId);
      case 'env.update':
        return updateEnvVars(serviceId, args.vars || args.envVars);
      case 'postgres.query':
        return queryPostgres(databaseId, String(args.sql || args.query || ''));
      default:
        return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
    }
  },
};
