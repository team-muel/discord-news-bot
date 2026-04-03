import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';
import logger from '../../../logger';

export type BenchResult = {
  benchScore: number | null;
  latencyMs: number | null;
  throughput: number | null;
  schemaVersion: string | null;
  raw: string[];
};

/** Known jarvis bench --json schema versions. Future versions may change output shape. */
const SUPPORTED_BENCH_SCHEMA_VERSIONS = ['1', '1.0', '1.1'];

/**
 * Parse `jarvis bench --json` stdout into a structured BenchResult.
 * Tolerant: returns null score on malformed/empty output.
 * Version-guarded: logs a warning if schema_version field is unrecognized.
 */
export const parseBenchResult = (output: string[]): BenchResult => {
  const raw = output.slice(0, 20);
  const joined = output.join('\n').trim();
  if (!joined) return { benchScore: null, latencyMs: null, throughput: null, schemaVersion: null, raw };
  try {
    const parsed = JSON.parse(joined) as Record<string, unknown>;
    const schemaVersion = typeof parsed.schema_version === 'string' ? parsed.schema_version
      : typeof parsed.version === 'string' ? parsed.version : null;
    if (schemaVersion && !SUPPORTED_BENCH_SCHEMA_VERSIONS.includes(schemaVersion)) {
      logger.warn('[OPENJARVIS] bench schema_version=%s is not in supported set [%s]; parsing may be inaccurate',
        schemaVersion, SUPPORTED_BENCH_SCHEMA_VERSIONS.join(','));
    }
    const score = typeof parsed.score === 'number' && Number.isFinite(parsed.score) ? parsed.score : null;
    const latency = typeof parsed.latency_ms === 'number' && Number.isFinite(parsed.latency_ms) ? parsed.latency_ms : null;
    const throughput = typeof parsed.throughput === 'number' && Number.isFinite(parsed.throughput) ? parsed.throughput : null;
    return { benchScore: score, latencyMs: latency, throughput, schemaVersion, raw };
  } catch {
    // Fallback: try to extract score from first line like "score: 0.85"
    const scoreMatch = joined.match(/score[:\s]+([0-9]+(?:\.[0-9]+)?)/i);
    const benchScore = scoreMatch ? Number(scoreMatch[1]) : null;
    return { benchScore: Number.isFinite(benchScore) ? benchScore : null, latencyMs: null, throughput: null, schemaVersion: null, raw };
  }
};

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30_000;
const ENABLED = parseBooleanEnv(process.env.OPENJARVIS_ENABLED, false);
const SERVE_URL = String(process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000').trim();
const MODEL = String(process.env.OPENJARVIS_MODEL || 'qwen2.5:7b-instruct').trim();
const LITELLM_BASE_URL = String(process.env.LITELLM_BASE_URL || '').trim().replace(/\/+$/, '');
const LITELLM_MASTER_KEY = String(process.env.LITELLM_MASTER_KEY || process.env.OPENCLAW_API_KEY || '').trim();
const LITELLM_MODEL = String(process.env.LITELLM_MODEL || 'muel-balanced').trim();

/**
 * Lite mode: when jarvis CLI is not installed but LiteLLM proxy is available,
 * jarvis.ask can still function via LiteLLM HTTP fallback.
 */
let cliAvailable: boolean | null = null;

// Cache health check results to avoid redundant probes when multiple actions run in quick succession
let cachedServeHealth: { ok: boolean; at: number } | null = null;
const SERVE_HEALTH_CACHE_TTL_MS = 10_000;

const checkServeHealth = async (): Promise<boolean> => {
  if (cachedServeHealth && Date.now() - cachedServeHealth.at < SERVE_HEALTH_CACHE_TTL_MS) {
    return cachedServeHealth.ok;
  }
  const resp = await fetch(`${SERVE_URL}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  const ok = !!resp?.ok;
  cachedServeHealth = { ok, at: Date.now() };
  return ok;
};

const stripShellMeta = (s: string): string => s.replace(/[|&;$`<>(){}\[\]!#"'\\\n\r]/g, '');

const runCli = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync('jarvis', args, {
    timeout: TIMEOUT_MS,
    windowsHide: true,
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
  } catch (fetchErr) {
    logger.debug('[OPENJARVIS] httpPost %s failed: %s', path, fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
    return { ok: false, data: null };
  }
};

export const openjarvisAdapter: ExternalToolAdapter = {
  id: 'openjarvis',
  capabilities: ['jarvis.ask', 'jarvis.serve', 'jarvis.optimize', 'jarvis.bench', 'jarvis.trace'],
  liteCapabilities: ['jarvis.ask'],

  isAvailable: async () => {
    if (!ENABLED) return false;
    try {
      await runCli(['--version']);
      cliAvailable = true;
      return true;
    } catch {
      cliAvailable = false;
      // Lite mode: LiteLLM proxy available → jarvis.ask only
      return LITELLM_BASE_URL.length > 0;
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
          const serveOk = await checkServeHealth();
          if (serveOk) {
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
          if (cliAvailable !== false) {
            try {
              const { stdout } = await runCli(['ask', stripShellMeta(question), '--quiet']);
              return makeResult(true, 'Response via jarvis CLI', stdout.trim().split('\n').slice(0, 20));
            } catch {
              // CLI failed — try LiteLLM fallback below
            }
          }

          // LiteLLM proxy fallback (lite mode or CLI failure)
          if (LITELLM_BASE_URL) {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (LITELLM_MASTER_KEY) {
              headers['Authorization'] = `Bearer ${LITELLM_MASTER_KEY}`;
            }
            const llmResp = await fetch(`${LITELLM_BASE_URL}/v1/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: LITELLM_MODEL,
                messages: [{ role: 'user', content: question }],
              }),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            }).catch(() => null);
            if (llmResp?.ok) {
              const data = (await llmResp.json()) as { choices?: Array<{ message?: { content?: string } }> };
              const content = data.choices?.[0]?.message?.content || '';
              if (content) {
                const mode = cliAvailable === false ? ' (lite mode)' : '';
                return makeResult(true, `Response via LiteLLM proxy${mode}`, content.split('\n').slice(0, 20));
              }
            }
          }

          return makeResult(false, 'No inference endpoint available', [], 'INFERENCE_UNAVAILABLE');
        }

        case 'jarvis.serve': {
          // Check if serve is already running
          const serveOk = await checkServeHealth();
          if (serveOk) {
            return makeResult(true, `jarvis serve already running at ${SERVE_URL}`, ['status: running']);
          }
          return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
        }

        case 'jarvis.optimize': {
          if (cliAvailable === false) return makeResult(false, 'jarvis optimize requires CLI', [], 'CLI_REQUIRED');
          const { stdout } = await runCli(['optimize', '--json']);
          return makeResult(true, 'Optimization completed', stdout.trim().split('\n').slice(0, 20));
        }

        case 'jarvis.bench': {
          if (cliAvailable === false) return makeResult(false, 'jarvis bench requires CLI', [], 'CLI_REQUIRED');
          const { stdout } = await runCli(['bench', '--json']);
          return makeResult(true, 'Benchmark completed', stdout.trim().split('\n').slice(0, 20));
        }

        case 'jarvis.trace': {
          const tracePayload = args.trace as Record<string, unknown> | undefined;
          if (!tracePayload || typeof tracePayload !== 'object') {
            return makeResult(false, 'Trace payload required', [], 'MISSING_TRACE');
          }

          // Prefer HTTP POST if serve is running
          const serveOk = await checkServeHealth();
          if (serveOk) {
            const { ok } = await httpPost('/v1/traces', tracePayload);
            if (ok) {
              return makeResult(true, 'Trace stored via jarvis serve', [`run_id=${String(tracePayload.run_id || 'unknown')}`]);
            }
          }

          // Fallback: write trace via CLI stdin pipe
          if (cliAvailable === false) {
            return makeResult(false, 'jarvis trace requires CLI or serve endpoint', [], 'CLI_REQUIRED');
          }
          const traceJson = JSON.stringify(tracePayload);
          const { stdout } = await runCli(['trace', 'store', '--json', traceJson]);
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
