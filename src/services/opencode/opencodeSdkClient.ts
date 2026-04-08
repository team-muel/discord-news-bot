/**
 * OpenCode SDK Client — session-based HTTP client for the OpenCode headless server.
 *
 * Wraps the OpenCode `serve` HTTP API (port 4096) to provide:
 *   - Session lifecycle: create → prompt → patches → close
 *   - Structured code modification via session conversations
 *   - LSP diagnostic retrieval for QA enrichment (via shell tsc)
 *
 * Falls back gracefully when the headless server is unreachable.
 *
 * API reference: https://opencode.ai/docs/server/
 *
 * Environment:
 *   OPENCODE_SDK_ENABLED — feature flag (default: false)
 *   OPENCODE_SDK_BASE_URL — headless server base URL (e.g. http://34.56.232.61:4096)
 *   OPENCODE_SDK_TIMEOUT_MS — request timeout (default: 90000)
 *   OPENCODE_SDK_AUTH_TOKEN — optional auth token
 */

import { fetchWithTimeout } from '../../utils/network';
import { parseBooleanEnv, parseMinIntEnv, parseStringEnv, parseUrlEnv } from '../../utils/env';
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

/**
 * Health check the headless server.
 * Official endpoint: GET /global/health → { healthy, version }
 */
export const checkHealth = async (): Promise<OpenCodeHealthStatus> => {
  if (!isOpenCodeSdkAvailable()) return { ok: false };

  const { ok, data } = await request<{ healthy?: boolean; version?: string; uptime?: number }>(
    'GET',
    '/global/health',
  );
  if (!ok || !data) return { ok: false };
  return { ok: data.healthy !== false, version: data.version, uptime: data.uptime };
};

/**
 * Create a new coding session.
 * Official endpoint: POST /session → { id, ... }
 */
export const createSession = async (title?: string): Promise<OpenCodeSession | null> => {
  if (!isOpenCodeSdkAvailable()) return null;

  const body: Record<string, unknown> = {};
  if (title) body.title = title;

  const { ok, data } = await request<{ id?: string; created?: string }>(
    'POST',
    '/session',
    body,
  );
  if (!ok || !data) return null;

  const sessionId = data.id || '';
  if (!sessionId) return null;

  return { sessionId, createdAt: data.created || new Date().toISOString() };
};

/**
 * Send a coding objective to an existing session and retrieve the response.
 *
 * Official endpoint: POST /session/:id/message
 * Body: { parts: [{ type: "text", text }], model?, agent?, noReply? }
 * Returns: { info: Message, parts: Part[] }
 *
 * Patches are extracted from tool-use parts in the response.
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
    info?: { id?: string };
    parts?: Array<{
      type?: string;
      text?: string;
      // tool-use parts may contain file modifications
      toolName?: string;
      input?: Record<string, unknown>;
      content?: string;
      path?: string;
      operation?: string;
    }>;
    // Legacy fields (for backward compat with older servers)
    message?: string;
    content?: string;
    patches?: Array<{ path?: string; content?: string; operation?: string }>;
    diagnostics?: Array<{ file?: string; line?: number; severity?: string; message?: string }>;
  }>('POST', `/session/${encodeURIComponent(sessionId)}/message`, {
    parts: [{ type: 'text', text: message }],
  });

  if (!ok || !data) return fail('Message request failed');

  // Extract text from response parts
  const textParts = (data.parts || [])
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n');

  // Extract patches from response: check both legacy .patches and tool-use parts
  const patches: OpenCodePatch[] = [];

  // Legacy patches field (for backward compat with custom servers)
  if (data.patches && Array.isArray(data.patches)) {
    for (const p of data.patches) {
      if (typeof p.path === 'string' && p.path.length > 0) {
        patches.push({
          path: p.path,
          content: typeof p.content === 'string' ? p.content : '',
          operation: typeof p.operation === 'string' ? p.operation : 'modify',
        });
      }
    }
  }

  // Tool-use parts that write files (e.g. write_file, create_file from the agent)
  for (const part of (data.parts || [])) {
    if (part.type === 'tool-use' || part.type === 'tool_use') {
      const input = part.input || {};
      const filePath = typeof input.path === 'string' ? input.path : (typeof input.file_path === 'string' ? input.file_path : '');
      const fileContent = typeof input.content === 'string' ? input.content : '';
      if (filePath && fileContent) {
        patches.push({ path: filePath, content: fileContent, operation: 'modify' });
      }
    }
  }

  // Legacy diagnostics field
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
    message: textParts || data.message || data.content || '',
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
 * Run a shell command in the OpenCode session and parse tsc diagnostics.
 *
 * Official endpoint: POST /session/:id/shell
 * Body: { agent: "default", command: string }
 * Returns: { info: Message, parts: Part[] }
 *
 * Falls back gracefully if the endpoint is unavailable.
 */
export const getDiagnostics = async (
  sessionId: string,
  files: string[],
): Promise<OpenCodeDiagnostic[]> => {
  if (!isOpenCodeSdkAvailable() || !sessionId) return [];
  if (files.length === 0) return [];

  // Use the shell endpoint to run tsc --noEmit on the project
  const fileArgs = files.slice(0, 20).join(' ');
  const command = files.length <= 20
    ? `npx tsc --noEmit ${fileArgs} 2>&1 | head -50`
    : 'npx tsc --noEmit 2>&1 | head -50';

  const { ok, data } = await request<{
    info?: Record<string, unknown>;
    parts?: Array<{ type?: string; text?: string }>;
  }>('POST', `/session/${encodeURIComponent(sessionId)}/shell`, {
    agent: 'default',
    command,
  });

  if (!ok || !data) return [];

  // Parse tsc output from response parts
  const output = (data.parts || [])
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n');

  // Parse TypeScript diagnostic lines: "src/file.ts(10,5): error TS1234: message"
  const tscPattern = /^(.+?)\((\d+),\d+\):\s*(error|warning)\s+TS\d+:\s*(.+)$/gm;
  const diagnostics: OpenCodeDiagnostic[] = [];
  let match;
  while ((match = tscPattern.exec(output)) !== null) {
    diagnostics.push({
      file: match[1],
      line: parseInt(match[2], 10),
      severity: match[3] === 'error' ? 'error' : 'warning',
      message: match[4].trim(),
    });
  }

  const severityOrder = { error: 0, warning: 1, info: 2 };
  return diagnostics.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));
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
