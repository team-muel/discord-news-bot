import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';

const execAsync = promisify(exec);
const TIMEOUT_MS = 30_000;
const IS_WINDOWS = process.platform === 'win32';
const ENABLED = parseBooleanEnv(process.env.OPENJARVIS_ENABLED, false);
const SERVE_URL = String(process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000').trim();
const MODEL = String(process.env.OPENJARVIS_MODEL || 'qwen2.5:7b-instruct').trim();

const runCli = async (args: string): Promise<{ stdout: string; stderr: string }> => {
  return execAsync(`jarvis ${args}`, {
    timeout: TIMEOUT_MS,
    windowsHide: true,
    ...(IS_WINDOWS ? { shell: 'cmd.exe' } : {}),
  });
};

const httpPost = async (path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(`${SERVE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await resp.json();
    return { ok: resp.ok, data };
  } catch {
    return { ok: false, data: null };
  }
};

export const openjarvisAdapter: ExternalToolAdapter = {
  id: 'openjarvis',
  capabilities: ['jarvis.ask', 'jarvis.serve', 'jarvis.optimize', 'jarvis.bench', 'jarvis.trace'],

  isAvailable: async () => {
    if (!ENABLED) return false;
    try {
      await runCli('--version');
      return true;
    } catch {
      return false;
    }
  },

  execute: async (action, args) => {
    const start = Date.now();
    const makeResult = (ok: boolean, summary: string, output: string[], error?: string): ExternalAdapterResult => ({
      ok,
      adapterId: 'openjarvis',
      action,
      summary,
      output,
      error,
      durationMs: Date.now() - start,
    });

    try {
      switch (action) {
        case 'jarvis.ask': {
          const question = String(args.question || '').slice(0, 2000);
          if (!question) return makeResult(false, 'Question required', [], 'MISSING_QUESTION');

          // Prefer HTTP if serve is running, otherwise fall back to CLI
          const health = await fetch(`${SERVE_URL}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
          if (health?.ok) {
            const { ok, data } = await httpPost('/v1/chat/completions', {
              model: args.model || MODEL,
              messages: [{ role: 'user', content: question }],
            });
            if (ok && data) {
              const resp = data as { choices?: Array<{ message?: { content?: string } }> };
              const content = resp.choices?.[0]?.message?.content || '';
              return makeResult(true, 'Response via jarvis serve', content.split('\n').slice(0, 20));
            }
          }

          // Fallback to CLI
          const { stdout } = await runCli(`ask "${question.replace(/"/g, '\\"')}" --quiet`);
          return makeResult(true, 'Response via jarvis CLI', stdout.trim().split('\n').slice(0, 20));
        }

        case 'jarvis.serve': {
          // Check if serve is already running
          const health = await fetch(`${SERVE_URL}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
          if (health?.ok) {
            return makeResult(true, `jarvis serve already running at ${SERVE_URL}`, ['status: running']);
          }
          return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
        }

        case 'jarvis.optimize': {
          const { stdout } = await runCli('optimize --json');
          return makeResult(true, 'Optimization completed', stdout.trim().split('\n').slice(0, 20));
        }

        case 'jarvis.bench': {
          const { stdout } = await runCli('bench --json');
          return makeResult(true, 'Benchmark completed', stdout.trim().split('\n').slice(0, 20));
        }

        case 'jarvis.trace': {
          const tracePayload = args.trace as Record<string, unknown> | undefined;
          if (!tracePayload || typeof tracePayload !== 'object') {
            return makeResult(false, 'Trace payload required', [], 'MISSING_TRACE');
          }

          // Prefer HTTP POST if serve is running
          const health = await fetch(`${SERVE_URL}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
          if (health?.ok) {
            const { ok } = await httpPost('/v1/traces', tracePayload);
            if (ok) {
              return makeResult(true, 'Trace stored via jarvis serve', [`run_id=${String(tracePayload.run_id || 'unknown')}`]);
            }
          }

          // Fallback: write trace via CLI stdin pipe
          const traceJson = JSON.stringify(tracePayload);
          const escaped = traceJson.replace(/"/g, '\\"');
          const { stdout } = await runCli(`trace store --json "${escaped}"`);
          return makeResult(true, 'Trace stored via jarvis CLI', stdout.trim().split('\n').slice(0, 20));
        }

        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(false, `openjarvis ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};
