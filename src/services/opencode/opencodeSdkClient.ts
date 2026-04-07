/**
 * OpenCode SDK Client — session-based HTTP client for the OpenCode headless server.
 *
 * Wraps the OpenCode `serve` HTTP API (port 4096) to provide:
 *   - Session lifecycle: create → chat → patches → close
 *   - Structured code modification via session conversations
 *   - LSP diagnostic retrieval for QA enrichment
 *
 * Falls back gracefully when the headless server is unreachable.
 *
 * Environment:
 *   OPENCODE_SDK_ENABLED — feature flag (default: false)
 *   OPENCODE_SDK_BASE_URL — headless server base URL (e.g. http://34.56.232.61:4096)
 *   OPENCODE_SDK_TIMEOUT_MS — request timeout (default: 90000)
 *   OPENCODE_SDK_AUTH_TOKEN — optional auth token
 */

import { fetchWithTimeout } from '../../utils/network';
import { parseBooleanEnv, parseIntegerEnv, parseMinIntEnv, parseStringEnv, parseUrlEnv } from '../../utils/env';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

// ──── Config ──────────────────────────────────────────────────────────────────

const ENABLED = parseBooleanEnv(process.env.OPENCODE_SDK_ENABLED, false);
const BASE_URL = parseUrlEnv(process.env.OPENCODE_SDK_BASE_URL, '');
const TIMEOUT_MS = parseMinIntEnv(process.env.OPENCODE_SDK_TIMEOUT_MS, 90_000, 5_000);
const AUTH_TOKEN = parseStringEnv(process.env.OPENCODE_SDK_AUTH_TOKEN, '');

// ──── Types ───────────────────────────────────────────────────────────────────

export type OpenCodeSession = {
  sessionId: string;
  createdAt: string;
};

export type OpenCodePatch = {
  path: string;
  content: string;
  /** 'create' | 'modify' | 'delete' */
  operation: string;
};

export type OpenCodeChatResult = {
  ok: boolean;
  message: string;
  patches: OpenCodePatch[];
  diagnostics: OpenCodeDiagnostic[];
};

export type OpenCodeDiagnostic = {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
};

export type OpenCodeHealthStatus = {
  ok: boolean;
  version?: string;
  uptime?: number;
};

// ──── HTTP helpers ────────────────────────────────────────────────────────────

const buildHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  return headers;
};

const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> => {
  if (!BASE_URL) {
    return { ok: false, status: 0, data: null, error: 'OPENCODE_SDK_BASE_URL not configured' };
  }

  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method,
        headers: buildHeaders(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      TIMEOUT_MS,
    );

    const text = await res.text();
    let data: T | null = null;
    try {
      data = JSON.parse(text) as T;
    } catch {
      // Non-JSON response
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data, error: `HTTP_${res.status}` };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const message = getErrorMessage(err);
    logger.debug('[OPENCODE-SDK] %s %s failed: %s', method, path, message);
    return { ok: false, status: 0, data: null, error: message };
  }
};

// ──── Public API ──────────────────────────────────────────────────────────────

/** Check if the OpenCode SDK integration is enabled and configured. */
export const isOpenCodeSdkAvailable = (): boolean => ENABLED && BASE_URL.length > 0;

/** Health check the headless server. */
export const checkHealth = async (): Promise<OpenCodeHealthStatus> => {
  if (!isOpenCodeSdkAvailable()) return { ok: false };

  const { ok, data } = await request<{ version?: string; uptime?: number }>('GET', '/health');
  if (!ok || !data) return { ok: false };
  return { ok: true, version: data.version, uptime: data.uptime };
};

/** Create a new coding session. */
export const createSession = async (): Promise<OpenCodeSession | null> => {
  if (!isOpenCodeSdkAvailable()) return null;

  const { ok, data } = await request<{ id?: string; sessionId?: string; createdAt?: string }>(
    'POST',
    '/session',
    {},
  );
  if (!ok || !data) return null;

  const sessionId = data.sessionId || data.id || '';
  if (!sessionId) return null;

  return { sessionId, createdAt: data.createdAt || new Date().toISOString() };
};

/**
 * Send a coding objective to an existing session and retrieve patches.
 *
 * The message includes:
 *   - The sprint objective
 *   - Context files (path + content)
 *   - Optional previous phase output
 */
export const chatSession = async (
  sessionId: string,
  message: string,
): Promise<OpenCodeChatResult> => {
  const fail = (error: string): OpenCodeChatResult => ({
    ok: false, message: error, patches: [], diagnostics: [],
  });

  if (!isOpenCodeSdkAvailable()) return fail('SDK not available');
  if (!sessionId) return fail('Session ID required');

  const { ok, data } = await request<{
    message?: string;
    content?: string;
    patches?: Array<{ path?: string; content?: string; operation?: string }>;
    diagnostics?: Array<{ file?: string; line?: number; severity?: string; message?: string }>;
  }>('POST', `/session/${encodeURIComponent(sessionId)}/chat`, { message });

  if (!ok || !data) return fail('Chat request failed');

  const patches: OpenCodePatch[] = (data.patches || [])
    .filter((p) => typeof p.path === 'string' && p.path.length > 0)
    .map((p) => ({
      path: p.path!,
      content: typeof p.content === 'string' ? p.content : '',
      operation: typeof p.operation === 'string' ? p.operation : 'modify',
    }));

  const diagnostics: OpenCodeDiagnostic[] = (data.diagnostics || [])
    .filter((d) => typeof d.file === 'string')
    .map((d) => ({
      file: d.file!,
      line: typeof d.line === 'number' ? d.line : 0,
      severity: (['error', 'warning', 'info'].includes(d.severity || '') ? d.severity : 'info') as OpenCodeDiagnostic['severity'],
      message: typeof d.message === 'string' ? d.message : '',
    }));

  return {
    ok: true,
    message: data.message || data.content || '',
    patches,
    diagnostics,
  };
};

/** Close a session to free server resources. */
export const closeSession = async (sessionId: string): Promise<void> => {
  if (!isOpenCodeSdkAvailable() || !sessionId) return;
  await request('DELETE', `/session/${encodeURIComponent(sessionId)}`);
};

/**
 * Request LSP diagnostics for changed files from an existing session.
 * Returns diagnostics sorted by severity (errors first).
 */
export const getDiagnostics = async (
  sessionId: string,
  files: string[],
): Promise<OpenCodeDiagnostic[]> => {
  if (!isOpenCodeSdkAvailable() || !sessionId) return [];
  if (files.length === 0) return [];

  const { ok, data } = await request<{
    diagnostics?: Array<{ file?: string; line?: number; severity?: string; message?: string }>;
  }>('POST', `/session/${encodeURIComponent(sessionId)}/diagnostics`, { files });

  if (!ok || !data) return [];

  const severityOrder = { error: 0, warning: 1, info: 2 };
  return (data.diagnostics || [])
    .filter((d) => typeof d.file === 'string')
    .map((d) => ({
      file: d.file!,
      line: typeof d.line === 'number' ? d.line : 0,
      severity: (['error', 'warning', 'info'].includes(d.severity || '') ? d.severity : 'info') as OpenCodeDiagnostic['severity'],
      message: typeof d.message === 'string' ? d.message : '',
    }))
    .sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));
};

/**
 * High-level: generate code modifications for a sprint objective.
 *
 * Wraps the full session lifecycle: create → chat → extract patches → close.
 * Used by sprintCodeWriter as an alternative to raw LLM generation.
 */
export const generateCodeViaSession = async (params: {
  objective: string;
  contextFiles: Array<{ path: string; content: string }>;
  previousPhaseOutput?: string;
}): Promise<{
  ok: boolean;
  patches: OpenCodePatch[];
  diagnostics: OpenCodeDiagnostic[];
  summary: string;
  error?: string;
  sessionId?: string;
}> => {
  const fail = (error: string) => ({ ok: false, patches: [], diagnostics: [], summary: error, error });

  if (!isOpenCodeSdkAvailable()) return fail('OpenCode SDK not available');

  // 1. Create session
  const session = await createSession();
  if (!session) return fail('Failed to create OpenCode session');

  logger.info('[OPENCODE-SDK] session created: %s', session.sessionId);

  try {
    // 2. Build message with context
    const contextSection = params.contextFiles
      .map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``)
      .join('\n\n');

    const message = [
      `## Objective\n${params.objective}`,
      contextSection ? `\n## Source Files\n${contextSection}` : '',
      params.previousPhaseOutput ? `\n## Previous Phase Output\n${params.previousPhaseOutput.slice(0, 2000)}` : '',
      '\n## Instructions\nModify the source files to achieve the objective. Return patches for all changed files.',
    ].filter(Boolean).join('\n');

    // 3. Chat and get patches
    const result = await chatSession(session.sessionId, message);
    if (!result.ok) {
      return { ...fail(`Chat failed: ${result.message}`), sessionId: session.sessionId };
    }

    if (result.patches.length === 0) {
      return {
        ok: true,
        patches: [],
        diagnostics: result.diagnostics,
        summary: 'OpenCode session produced no patches',
        sessionId: session.sessionId,
      };
    }

    logger.info('[OPENCODE-SDK] session %s produced %d patches', session.sessionId, result.patches.length);

    return {
      ok: true,
      patches: result.patches,
      diagnostics: result.diagnostics,
      summary: `OpenCode session produced ${result.patches.length} patch(es)`,
      sessionId: session.sessionId,
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { ...fail(`Session error: ${msg}`), sessionId: session.sessionId };
  } finally {
    // 4. Always close session
    await closeSession(session.sessionId).catch(() => {});
  }
};
