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
import { parseBooleanEnv, parseMinIntEnv, parseStringEnv } from '../../../utils/env';
import { fetchWithTimeout } from '../../../utils/network';
import type { ExternalToolAdapter, ExternalAdapterResult, ExternalAdapterId } from '../externalAdapterTypes';
import logger from '../../../logger';
import { getErrorMessage } from '../../../utils/errorMessage';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.N8N_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.N8N_ENABLED;
const isNotDisabled = (): boolean => !EXPLICITLY_DISABLED && LEGACY_ENABLED_RAW !== 'false';

const N8N_BASE_URL = parseStringEnv(process.env.N8N_BASE_URL, 'http://localhost:5678').replace(/\/+$/, '');
const N8N_API_KEY = parseStringEnv(process.env.N8N_API_KEY, '');
const N8N_TIMEOUT_MS = parseMinIntEnv(process.env.N8N_TIMEOUT_MS, 30_000, 5_000);

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

const buildHeaders = (includeApiKey = true): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (includeApiKey && N8N_API_KEY) {
    headers['X-N8N-API-KEY'] = N8N_API_KEY;
  }
  return headers;
};

const sanitizeWebhookPath = (value: string): string => value.replace(/[^a-zA-Z0-9\-\/]/g, '');

const extractWorkflowData = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object') {
    const nested = value as Record<string, unknown>;
    if (nested.data && typeof nested.data === 'object' && !Array.isArray(nested.data)) {
      return nested.data as Record<string, unknown>;
    }
    return nested;
  }
  return null;
};

const resolveWebhookExecutionTarget = (workflowData: unknown): { webhookPath: string; method: 'GET' | 'POST' } | null => {
  const workflow = extractWorkflowData(workflowData);
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      continue;
    }
    const typedNode = node as { type?: unknown; parameters?: unknown };
    const nodeType = String(typedNode.type || '').trim();
    if (!nodeType.endsWith('.webhook')) {
      continue;
    }
    const parameters = typedNode.parameters && typeof typedNode.parameters === 'object'
      ? typedNode.parameters as Record<string, unknown>
      : {};
    const rawWebhookPath = String(parameters.path || '').trim();
    if (!rawWebhookPath) {
      continue;
    }
    const sanitized = sanitizeWebhookPath(rawWebhookPath);
    if (sanitized !== rawWebhookPath) {
      continue;
    }
    const method = String(parameters.httpMethod || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
    return { webhookPath: sanitized, method };
  }
  return null;
};

const executeWorkflowViaWebhookFallback = async (
  action: string,
  workflowId: string,
  inputData: Record<string, unknown>,
  startMs: number,
): Promise<ExternalAdapterResult> => {
  try {
    const detailsResp = await fetchWithTimeout(
      `${N8N_BASE_URL}/api/v1/workflows/${encodeURIComponent(workflowId)}`,
      {
        method: 'GET',
        headers: buildHeaders(),
      },
      N8N_TIMEOUT_MS,
    );
    const detailsData = await safeJson(detailsResp);
    if (!detailsResp.ok) {
      return makeResult(false, action, `Workflow execution fallback lookup failed (HTTP ${detailsResp.status})`, [JSON.stringify(detailsData)], startMs, `HTTP_${detailsResp.status}`);
    }

    const webhookTarget = resolveWebhookExecutionTarget(detailsData);
    if (!webhookTarget) {
      return makeResult(false, action, 'Workflow execution fallback requires a webhook node path', [JSON.stringify(detailsData).slice(0, 3000)], startMs, 'UNSUPPORTED_WEBHOOK_FALLBACK');
    }

    const webhookResp = await fetchWithTimeout(
      `${N8N_BASE_URL}/webhook/${webhookTarget.webhookPath}`,
      {
        method: webhookTarget.method,
        headers: buildHeaders(false),
        body: webhookTarget.method === 'POST' ? JSON.stringify(inputData) : undefined,
      },
      N8N_TIMEOUT_MS,
    );
    const webhookData = await safeJson(webhookResp);
    if (!webhookResp.ok) {
      return makeResult(false, action, `Workflow execution fallback failed (HTTP ${webhookResp.status})`, [JSON.stringify(webhookData)], startMs, `HTTP_${webhookResp.status}`);
    }

    return makeResult(true, action, `Workflow ${workflowId} executed via webhook fallback`, [JSON.stringify(webhookData)], startMs);
  } catch (err) {
    const msg = getErrorMessage(err);
    logger.warn('[N8N] workflow.execute webhook fallback error: %s', msg);
    return makeResult(false, action, `workflow.execute fallback failed: ${msg}`, [], startMs, 'EXECUTION_ERROR');
  }
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
  description: 'n8n workflow automation — execute, list, trigger, and monitor automation workflows for data pipeline orchestration.',
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
          const inputData = args.data && typeof args.data === 'object'
            ? args.data as Record<string, unknown>
            : {};
          const resp = await fetchWithTimeout(
            `${N8N_BASE_URL}/api/v1/executions`,
            {
              method: 'POST',
              headers: buildHeaders(),
              body: JSON.stringify({ workflowId, data: inputData }),
            },
            N8N_TIMEOUT_MS,
          );
          const data = await safeJson(resp);
          const output = [JSON.stringify(data)];

          if (!resp.ok) {
            if (resp.status === 404 || resp.status === 405) {
              logger.info('[N8N] workflow.execute switching to webhook fallback: workflowId=%s status=%d', workflowId, resp.status);
              return executeWorkflowViaWebhookFallback(action, workflowId, inputData, start);
            }
            logger.warn('[N8N] workflow.execute failed: status=%d workflowId=%s', resp.status, workflowId);
            return makeResult(false, action, `Workflow execution failed (HTTP ${resp.status})`, output, start, `HTTP_${resp.status}`);
          }

          logger.info('[N8N] workflow.execute ok: workflowId=%s durationMs=%d', workflowId, Date.now() - start);
          return makeResult(true, action, `Workflow ${workflowId} executed`, output, start);
        } catch (err) {
          const msg = getErrorMessage(err);
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
          const msg = getErrorMessage(err);
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
          const msg = getErrorMessage(err);
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
          const msg = getErrorMessage(err);
          return makeResult(false, action, `workflow.status failed: ${msg}`, [], start, 'STATUS_ERROR');
        }
      }

      default:
        return makeResult(false, action, `Unknown n8n action: ${action}`, [], start, 'UNKNOWN_ACTION');
    }
  },
};
