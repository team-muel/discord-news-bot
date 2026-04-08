import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseStringEnv } from '../../../utils/env';
import { fetchWithTimeout } from '../../../utils/network';
import {
  OPENJARVIS_ENABLED as CONFIG_OPENJARVIS_ENABLED,
  OPENJARVIS_DISABLED as CONFIG_OPENJARVIS_DISABLED,
  OPENJARVIS_SERVE_URL as CONFIG_OPENJARVIS_SERVE_URL,
  OPENJARVIS_MODEL as CONFIG_OPENJARVIS_MODEL,
} from '../../../config';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';
import logger from '../../../logger';
import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { getErrorMessage } from '../../../utils/errorMessage';

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
const ENABLED = CONFIG_OPENJARVIS_ENABLED;
const EXPLICITLY_DISABLED = CONFIG_OPENJARVIS_DISABLED;
const SERVE_URL = CONFIG_OPENJARVIS_SERVE_URL;
const MODEL = CONFIG_OPENJARVIS_MODEL || 'qwen2.5:7b-instruct';
const SERVE_API_KEY = parseStringEnv(process.env.OPENJARVIS_API_KEY, '');

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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (SERVE_API_KEY) headers.Authorization = `Bearer ${SERVE_API_KEY}`;
    const resp = await fetchWithTimeout(`${SERVE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, TIMEOUT_MS);
    const data = await resp.json();
    return { ok: resp.ok, data };
  } catch (fetchErr) {
    logger.debug('[OPENJARVIS] httpPost %s failed: %s', path, getErrorMessage(fetchErr));
    return { ok: false, data: null };
  }
};

const httpGet = async (path: string): Promise<{ ok: boolean; data: unknown }> => {
  try {
    const headers: Record<string, string> = {};
    if (SERVE_API_KEY) headers.Authorization = `Bearer ${SERVE_API_KEY}`;
    const resp = await fetchWithTimeout(`${SERVE_URL}${path}`, {
      method: 'GET',
      headers,
    }, TIMEOUT_MS);
    const data = await resp.json();
    return { ok: resp.ok, data };
  } catch (fetchErr) {
    logger.debug('[OPENJARVIS] httpGet %s failed: %s', path, getErrorMessage(fetchErr));
    return { ok: false, data: null };
  }
};

export const openjarvisAdapter: ExternalToolAdapter = {
  id: 'openjarvis',
  capabilities: [
    'jarvis.ask', 'jarvis.serve', 'jarvis.optimize', 'jarvis.bench', 'jarvis.feedback',
    'jarvis.research', 'jarvis.digest', 'jarvis.memory.index', 'jarvis.memory.search',
    'jarvis.eval', 'jarvis.telemetry', 'jarvis.scheduler.list', 'jarvis.skill.search',
  ],
  liteCapabilities: ['jarvis.ask'],

  isAvailable: async () => {
    if (EXPLICITLY_DISABLED || !ENABLED) return false;
    try {
      await runCli(['--version']);
      cliAvailable = true;
      return true;
    } catch {
      cliAvailable = false;
      // Lite mode: any LLM configured → jarvis.ask only
      return isAnyLlmConfigured();
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
              const { stdout } = await runCli(['ask', stripShellMeta(question), '--no-stream']);
              return makeResult(true, 'Response via jarvis CLI', stdout.trim().split('\n').slice(0, 20));
            } catch {
              // CLI failed — try LiteLLM fallback below
            }
          }

          // Central LLM fallback (lite mode or CLI failure)
          if (isAnyLlmConfigured()) {
            try {
              const content = await generateText({
                system: 'You are a helpful AI assistant.',
                user: question,
                actionName: 'jarvis.ask',
              });
              if (content) {
                const mode = cliAvailable === false ? ' (lite mode)' : '';
                return makeResult(true, `Response via LLM${mode}`, content.split('\n').slice(0, 20));
              }
            } catch {
              // LLM call failed — fall through to unavailable
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
          const optimizeArgs = ['optimize', 'run'];
          if (args.benchmark) optimizeArgs.push('--benchmark', stripShellMeta(String(args.benchmark)));
          const { stdout } = await runCli(optimizeArgs);
          return makeResult(true, 'Optimization completed', stdout.trim().split('\n').slice(0, 20));
        }

        case 'jarvis.bench': {
          if (cliAvailable === false) return makeResult(false, 'jarvis bench requires CLI', [], 'CLI_REQUIRED');
          const { stdout } = await runCli(['bench', 'run', '--json']);
          return makeResult(true, 'Benchmark completed', stdout.trim().split('\n').slice(0, 20));
        }

        case 'jarvis.feedback': {
          const traceId = String(args.trace_id || args.traceId || '').trim();
          const score = Number(args.score);
          if (!traceId) {
            return makeResult(false, 'trace_id required', [], 'MISSING_TRACE_ID');
          }
          if (!Number.isFinite(score) || score < 0 || score > 1) {
            return makeResult(false, 'score must be a number between 0 and 1', [], 'INVALID_SCORE');
          }

          // Prefer HTTP POST if serve is running
          const serveOk = await checkServeHealth();
          if (serveOk) {
            const { ok } = await httpPost('/v1/feedback', { trace_id: traceId, score });
            if (ok) {
              return makeResult(true, 'Feedback recorded via jarvis serve', [`trace_id=${traceId}`, `score=${score}`]);
            }
          }

          // Fallback: record feedback via CLI
          if (cliAvailable === false) {
            return makeResult(false, 'jarvis feedback requires CLI or serve endpoint', [], 'CLI_REQUIRED');
          }
          const { stdout } = await runCli(['feedback', 'score', traceId, '-s', String(score)]);
          return makeResult(true, 'Feedback recorded via jarvis CLI', stdout.trim().split('\n').slice(0, 20));
        }

        // ── Deep Research Agent ──
        case 'jarvis.research': {
          const query = String(args.query || '').slice(0, 4000);
          if (!query) return makeResult(false, 'Research query required', [], 'MISSING_QUERY');
          const researchAgentId = String(args.agentId || 'deep_research');

          // Prefer HTTP serve agent endpoint: POST /v1/agents/{agent_id}/message
          const serveOk = await checkServeHealth();
          if (serveOk) {
            const { ok, data } = await httpPost(`/v1/agents/${encodeURIComponent(researchAgentId)}/message`, {
              input: query,
            });
            if (ok && data) {
              const resp = data as { output?: string; content?: string; citations?: string[] };
              const text = resp.output || resp.content || '';
              const lines = text.split('\n').slice(0, 30);
              if (resp.citations?.length) lines.push('', `Citations: ${resp.citations.length}`);
              return makeResult(true, 'Deep research completed via serve', lines);
            }
          }

          // CLI fallback: jarvis agents ask <agent_id> <message>
          if (cliAvailable === false) return makeResult(false, 'jarvis research requires CLI or serve', [], 'CLI_REQUIRED');
          const { stdout: researchOut } = await runCli(['agents', 'ask', researchAgentId, stripShellMeta(query)]);
          return makeResult(true, 'Deep research completed via CLI', researchOut.trim().split('\n').slice(0, 30));
        }

        // ── Morning Digest ──
        case 'jarvis.digest': {
          const digestAgentId = String(args.agentId || 'morning_digest');
          const digestTopic = String(args.topic || 'daily briefing');

          // Prefer HTTP serve: POST /v1/agents/{agent_id}/message
          const serveOk = await checkServeHealth();
          if (serveOk) {
            const { ok, data } = await httpPost(`/v1/agents/${encodeURIComponent(digestAgentId)}/message`, {
              input: digestTopic,
            });
            if (ok && data) {
              const resp = data as { output?: string; content?: string };
              const text = resp.output || resp.content || '';
              return makeResult(true, 'Digest generated via serve', text.split('\n').slice(0, 30));
            }
          }

          // CLI fallback: jarvis agents ask <agent_id> <message>
          if (cliAvailable === false) return makeResult(false, 'jarvis digest requires CLI or serve', [], 'CLI_REQUIRED');
          const { stdout: digestOut } = await runCli(['agents', 'ask', digestAgentId, stripShellMeta(digestTopic)]);
          return makeResult(true, 'Digest generated via CLI', digestOut.trim().split('\n').slice(0, 30));
        }

        // ── Memory: Index documents ──
        case 'jarvis.memory.index': {
          const indexPath = String(args.path || '').trim();
          if (!indexPath) return makeResult(false, 'Path required for memory index', [], 'MISSING_PATH');
          if (cliAvailable === false) return makeResult(false, 'jarvis memory index requires CLI', [], 'CLI_REQUIRED');
          const { stdout: indexOut } = await runCli(['memory', 'index', stripShellMeta(indexPath)]);
          return makeResult(true, `Indexed: ${indexPath}`, indexOut.trim().split('\n').slice(0, 20));
        }

        // ── Memory: Search knowledge base ──
        case 'jarvis.memory.search': {
          const searchQuery = String(args.query || '').slice(0, 2000);
          if (!searchQuery) return makeResult(false, 'Search query required', [], 'MISSING_QUERY');

          // Prefer HTTP serve
          const serveOk = await checkServeHealth();
          if (serveOk) {
            const { ok, data } = await httpPost('/v1/memory/search', {
              query: searchQuery,
              limit: Math.min(20, Math.max(1, Number(args.limit) || 5)),
            });
            if (ok && data) {
              const resp = data as { results?: Array<{ content?: string; score?: number }> };
              const lines = (resp.results || []).map((r, i) =>
                `[${i + 1}] (score=${r.score?.toFixed(3) ?? '?'}) ${(r.content || '').slice(0, 200)}`);
              return makeResult(true, `Found ${lines.length} results`, lines);
            }
          }

          // CLI fallback
          if (cliAvailable === false) return makeResult(false, 'jarvis memory search requires CLI or serve', [], 'CLI_REQUIRED');
          const { stdout: searchOut } = await runCli(['memory', 'search', stripShellMeta(searchQuery)]);
          return makeResult(true, 'Memory search completed', searchOut.trim().split('\n').slice(0, 20));
        }

        // ── Eval: Run evaluation benchmarks ──
        case 'jarvis.eval': {
          if (cliAvailable === false) return makeResult(false, 'jarvis eval requires CLI', [], 'CLI_REQUIRED');
          const benchmark = String(args.benchmark || args.dataset || 'supergpqa').trim();
          const evalArgs = ['eval', 'run', '--benchmark', stripShellMeta(benchmark), '--json'];
          if (args.limit || args.maxSamples) evalArgs.push('--max-samples', String(Math.min(100, Number(args.limit || args.maxSamples) || 10)));
          const { stdout: evalOut } = await runCli(evalArgs);
          return makeResult(true, `Eval completed: ${benchmark}`, evalOut.trim().split('\n').slice(0, 20));
        }

        // ── Telemetry: Aggregated statistics ──
        case 'jarvis.telemetry': {
          // Prefer HTTP serve telemetry endpoint: GET /v1/telemetry/stats
          const serveOk = await checkServeHealth();
          if (serveOk) {
            const { ok, data } = await httpGet('/v1/telemetry/stats');
            if (ok && data) {
              const resp = data as Record<string, unknown>;
              const lines = Object.entries(resp).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).slice(0, 20);
              return makeResult(true, 'Telemetry stats retrieved', lines);
            }
          }

          // CLI fallback: jarvis telemetry stats
          if (cliAvailable === false) return makeResult(false, 'jarvis telemetry requires CLI or serve', [], 'CLI_REQUIRED');
          const { stdout: telOut } = await runCli(['telemetry', 'stats']);
          return makeResult(true, 'Telemetry stats via CLI', telOut.trim().split('\n').slice(0, 20));
        }

        // ── Scheduler: List scheduled tasks ──
        case 'jarvis.scheduler.list': {
          // CLI only: jarvis scheduler list
          if (cliAvailable === false) return makeResult(false, 'jarvis scheduler requires CLI', [], 'CLI_REQUIRED');
          const { stdout: schedOut } = await runCli(['scheduler', 'list']);
          return makeResult(true, 'Scheduler tasks listed', schedOut.trim().split('\n').slice(0, 20));
        }

        // ── Skill Search: search available skills ──
        case 'jarvis.skill.search': {
          const skillQuery = String(args.query || '').slice(0, 200);

          // Prefer HTTP serve: GET /v1/skills
          const serveOk = await checkServeHealth();
          if (serveOk) {
            const { ok, data } = await httpGet('/v1/skills');
            if (ok && data) {
              const skills = Array.isArray(data) ? data : ((data as Record<string, unknown>).skills as unknown[]) || [];
              const lines = skills.slice(0, 20).map((s, i) => {
                const skill = s as Record<string, unknown>;
                return `[${i + 1}] ${skill.name || 'unnamed'} — ${(String(skill.description || '')).slice(0, 150)}`;
              });
              return makeResult(true, `Found ${lines.length} skills`, lines);
            }
          }

          // CLI fallback: jarvis skill search [query]
          if (cliAvailable === false) return makeResult(false, 'jarvis skill search requires CLI or serve', [], 'CLI_REQUIRED');
          const skillArgs = ['skill', 'search'];
          if (skillQuery) skillArgs.push(stripShellMeta(skillQuery));
          const { stdout: skillOut } = await runCli(skillArgs);
          return makeResult(true, 'Skill search completed', skillOut.trim().split('\n').slice(0, 20));
        }

        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = getErrorMessage(err);
      return makeResult(false, `openjarvis ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};
