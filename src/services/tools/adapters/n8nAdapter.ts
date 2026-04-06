/**
 * n8n External Adapter — REST API integration with self-hosted n8n.
 *
 * Capabilities:
 * - workflow.execute: Execute a workflow by ID with input data
 * - workflow.list: List available workflows
 * - workflow.trigger: Trigger a webhook-based workflow
 * - workflow.status: Get execution status
 *
 * Follows hybrid architecture: "body is n8n, brain is ours"
 * n8n handles external execution (RSS, API calls, SNS posting)
 * while the pipeline engine handles judgment (chaining, branching, replanning).
 */
import { parseBooleanEnv, parseIntegerEnv } from '../../../utils/env';
import { fetchWithTimeout } from '../../../utils/network';
import type { ExternalToolAdapter, ExternalAdapterResult, ExternalAdapterId } from '../externalAdapterTypes';
import logger from '../../../logger';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.N8N_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.N8N_ENABLED;
const isNotDisabled = (): boolean => !EXPLICITLY_DISABLED && LEGACY_ENABLED_RAW !== 'false';

const N8N_BASE_URL = String(process.env.N8N_BASE_URL || 'http://localhost:5678').trim().replace(/\/+$/, '');
const N8N_API_KEY = String(process.env.N8N_API_KEY || '').trim();
const N8N_TIMEOUT_MS = Math.max(5_000, parseIntegerEnv(process.env.N8N_TIMEOUT_MS, 30_000));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADAPTER_ID: ExternalAdapterId = 'n8n' as ExternalAdapterId;

const makeResult = (
  ok: boolean,
  action: string,
  summary: string,
  output: string[],
  startMs: number,
  error?: string,
): ExternalAdapterResult => ({
  ok,
  adapterId: ADAPTER_ID,
  action,
  summary,
  output,
  error,
  durationMs: Date.now() - startMs,
});

const buildHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (N8N_API_KEY) {
    headers['X-N8N-API-KEY'] = N8N_API_KEY;
  }
  return headers;
};

const safeJson = async (resp: Response): Promise<unknown> => {
  try {
    return await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    return { raw: text };
  }
};

// ─── Adapter Implementation ───────────────────────────────────────────────────

export const n8nAdapter: ExternalToolAdapter = {
  id: ADAPTER_ID,
  capabilities: [
    'workflow.execute',
    'workflow.list',
    'workflow.trigger',
    'workflow.status',
  ],
  liteCapabilities: ['workflow.list', 'workflow.status'],

  isAvailable: async (): Promise<boolean> => {
    if (!isNotDisabled() || !N8N_BASE_URL) return false;
    try {
      const resp = await fetchWithTimeout(
        `${N8N_BASE_URL}/healthz`,
        { method: 'GET', headers: buildHeaders() },
        5_000,
      );
      return resp.ok;
    } catch {
      // Try alternative health endpoint
      try {
        const resp = await fetchWithTimeout(
          `${N8N_BASE_URL}/api/v1/workflows?limit=1`,
          { method: 'GET', headers: buildHeaders() },
          5_000,
        );
        return resp.ok || resp.status === 401; // 401 means n8n is running but key is wrong
      } catch {
        return false;
      }
    }
  },

  execute: async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    const start = Date.now();

    if (!isNotDisabled()) {
      return makeResult(false, action, 'n8n adapter is disabled', [], start, 'N8N_DISABLED');
    }

    switch (action) {
      // ── Execute workflow by ID ──────────────────────────────────────────
      case 'workflow.execute': {
        const workflowId = String(args.workflowId || '').trim();
        if (!workflowId) {
          return makeResult(false, action, 'workflowId is required', [], start, 'MISSING_WORKFLOW_ID');
        }

        try {
          const body = args.data != null ? JSON.stringify(args.data) : '{}';
          const resp = await fetchWithTimeout(
            `${N8N_BASE_URL}/api/v1/executions`,
            {
              method: 'POST',
              headers: buildHeaders(),
              body: JSON.stringify({ workflowId, data: JSON.parse(body) }),
            },
            N8N_TIMEOUT_MS,
          );
          const data = await safeJson(resp);
          const output = [JSON.stringify(data)];

          if (!resp.ok) {
            logger.warn('[N8N] workflow.execute failed: status=%d workflowId=%s', resp.status, workflowId);
            return makeResult(false, action, `Workflow execution failed (HTTP ${resp.status})`, output, start, `HTTP_${resp.status}`);
          }

          logger.info('[N8N] workflow.execute ok: workflowId=%s durationMs=%d', workflowId, Date.now() - start);
          return makeResult(true, action, `Workflow ${workflowId} executed`, output, start);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('[N8N] workflow.execute error: %s', msg);
          return makeResult(false, action, `workflow.execute failed: ${msg}`, [], start, 'EXECUTION_ERROR');
        }
      }

      // ── List workflows ──────────────────────────────────────────────────
      case 'workflow.list': {
        const limit = Math.min(100, Math.max(1, Number(args.limit) || 25));
        try {
          const resp = await fetchWithTimeout(
            `${N8N_BASE_URL}/api/v1/workflows?limit=${limit}&active=true`,
            { method: 'GET', headers: buildHeaders() },
            N8N_TIMEOUT_MS,
          );
          const data = await safeJson(resp);
          const output = [JSON.stringify(data)];

          if (!resp.ok) {
            return makeResult(false, action, `List workflows failed (HTTP ${resp.status})`, output, start, `HTTP_${resp.status}`);
          }

          return makeResult(true, action, 'Workflows listed', output, start);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return makeResult(false, action, `workflow.list failed: ${msg}`, [], start, 'LIST_ERROR');
        }
      }

      // ── Trigger webhook workflow ────────────────────────────────────────
      case 'workflow.trigger': {
        const webhookPath = String(args.webhookPath || args.path || '').trim();
        if (!webhookPath) {
          return makeResult(false, action, 'webhookPath is required', [], start, 'MISSING_WEBHOOK_PATH');
        }

        // Sanitize webhook path: only allow alphanumeric, hyphens, slashes
        const sanitized = webhookPath.replace(/[^a-zA-Z0-9\-\/]/g, '');
        if (sanitized !== webhookPath) {
          return makeResult(false, action, 'Invalid webhook path', [], start, 'INVALID_WEBHOOK_PATH');
        }

        try {
          const body = args.data != null ? JSON.stringify(args.data) : '{}';
          const method = String(args.method || 'POST').toUpperCase();
          if (method !== 'GET' && method !== 'POST') {
            return makeResult(false, action, 'Only GET/POST methods supported', [], start, 'INVALID_METHOD');
          }

          const url = `${N8N_BASE_URL}/webhook/${sanitized}`;
          const init: RequestInit = {
            method,
            headers: buildHeaders(),
          };
          if (method === 'POST') {
            init.body = body;
          }

          const resp = await fetchWithTimeout(url, init, N8N_TIMEOUT_MS);
          const data = await safeJson(resp);
          const output = [JSON.stringify(data)];

          if (!resp.ok) {
            return makeResult(false, action, `Webhook trigger failed (HTTP ${resp.status})`, output, start, `HTTP_${resp.status}`);
          }

          logger.info('[N8N] workflow.trigger ok: path=%s durationMs=%d', sanitized, Date.now() - start);
          return makeResult(true, action, `Webhook ${sanitized} triggered`, output, start);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return makeResult(false, action, `workflow.trigger failed: ${msg}`, [], start, 'TRIGGER_ERROR');
        }
      }

      // ── Get execution status ────────────────────────────────────────────
      case 'workflow.status': {
        const executionId = String(args.executionId || '').trim();
        if (!executionId) {
          return makeResult(false, action, 'executionId is required', [], start, 'MISSING_EXECUTION_ID');
        }

        try {
          const resp = await fetchWithTimeout(
            `${N8N_BASE_URL}/api/v1/executions/${encodeURIComponent(executionId)}`,
            { method: 'GET', headers: buildHeaders() },
            N8N_TIMEOUT_MS,
          );
          const data = await safeJson(resp);
          const output = [JSON.stringify(data)];

          if (!resp.ok) {
            return makeResult(false, action, `Status check failed (HTTP ${resp.status})`, output, start, `HTTP_${resp.status}`);
          }

          return makeResult(true, action, `Execution ${executionId} status retrieved`, output, start);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return makeResult(false, action, `workflow.status failed: ${msg}`, [], start, 'STATUS_ERROR');
        }
      }

      default:
        return makeResult(false, action, `Unknown n8n action: ${action}`, [], start, 'UNKNOWN_ACTION');
    }
  },
};
