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
import { isAnyLlmConfigured } from '../../llmClient';
import { getErrorMessage } from '../../../utils/errorMessage';
import { runAdapterLlmFallback } from './llmFallback';

export type BenchResult = {
  benchScore: number | null;
  latencyMs: number | null;
  throughput: number | null;
  schemaVersion: string | null;
  raw: string[];
};

/** Known jarvis bench run --json schema versions. Future versions may change output shape. */
const SUPPORTED_BENCH_SCHEMA_VERSIONS = ['1', '1.0', '1.1'];

/**
 * Parse `jarvis bench run --json` stdout into a structured BenchResult.
 * Tolerant: returns null score on malformed/empty output.
 * Version-guarded: logs a warning if schema_version field is unrecognized.
 */
export const parseBenchResult = (output: string[]): BenchResult => {
  const raw = output.slice(0, 20);
  const joined = output.join('\n').trim();
  if (!joined) return { benchScore: null, latencyMs: null, throughput: null, schemaVersion: null, raw };
  try {
    const jsonStart = joined.indexOf('{');
    const jsonEnd = joined.lastIndexOf('}');
    const candidate = jsonStart >= 0 && jsonEnd > jsonStart ? joined.slice(jsonStart, jsonEnd + 1) : joined;
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const schemaVersion = typeof parsed.schema_version === 'string' ? parsed.schema_version
      : typeof parsed.version === 'string' ? parsed.version : null;
    if (schemaVersion && !SUPPORTED_BENCH_SCHEMA_VERSIONS.includes(schemaVersion)) {
      logger.warn('[OPENJARVIS] bench schema_version=%s is not in supported set [%s]; parsing may be inaccurate',
        schemaVersion, SUPPORTED_BENCH_SCHEMA_VERSIONS.join(','));
    }
    const score = typeof parsed.score === 'number' && Number.isFinite(parsed.score) ? parsed.score : null;
    const firstBenchmark = Array.isArray(parsed.benchmarks) && parsed.benchmarks[0] && typeof parsed.benchmarks[0] === 'object'
      ? parsed.benchmarks[0] as { metrics?: Record<string, unknown> }
      : null;
    const metrics = firstBenchmark?.metrics && typeof firstBenchmark.metrics === 'object' ? firstBenchmark.metrics : null;
    const latency = typeof parsed.latency_ms === 'number' && Number.isFinite(parsed.latency_ms)
      ? parsed.latency_ms
      : typeof metrics?.p95_latency === 'number' && Number.isFinite(metrics.p95_latency)
        ? metrics.p95_latency
        : typeof metrics?.mean_latency === 'number' && Number.isFinite(metrics.mean_latency)
          ? metrics.mean_latency
          : null;
    const throughput = typeof parsed.throughput === 'number' && Number.isFinite(parsed.throughput)
      ? parsed.throughput
      : typeof metrics?.throughput === 'number' && Number.isFinite(metrics.throughput)
        ? metrics.throughput
        : null;
    return { benchScore: score, latencyMs: latency, throughput, schemaVersion, raw };
  } catch {
    // Fallback: try to extract score from first line like "score: 0.85"
    const scoreMatch = joined.match(/score[:\s]+([0-9]+(?:\.[0-9]+)?)/i);
    const latencyMatch = joined.match(/(?:p95_latency|mean_latency|latency_ms)[:\s]+([0-9]+(?:\.[0-9]+)?)/i);
    const benchScore = scoreMatch ? Number(scoreMatch[1]) : null;
    const latencyMs = latencyMatch ? Number(latencyMatch[1]) : null;
    return {
      benchScore: Number.isFinite(benchScore) ? benchScore : null,
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
      throughput: null,
      schemaVersion: null,
      raw,
    };
  }
};

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBooleanFlag = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
};

const resolveJarvisAskAgentName = (args: Record<string, unknown>): string => {
  const raw = String(args.agent ?? args.agentName ?? '').trim();
  return raw ? stripShellMeta(raw) : '';
};

const resolveJarvisToolNames = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => stripShellMeta(entry.trim()))
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => stripShellMeta(entry.trim()))
      .filter(Boolean);
  }
  return [];
};

const resolveJarvisToolDefinitions = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => (
    Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
  )).map((entry) => ({ ...entry }));
};

const resolveJarvisChatMessages = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    const role = typeof candidate.role === 'string' ? candidate.role.trim() : '';
    if (!role) return [];
    const message: Record<string, unknown> = {
      role,
      content: typeof candidate.content === 'string' ? candidate.content : '',
    };
    if (typeof candidate.name === 'string' && candidate.name.trim()) {
      message.name = candidate.name.trim();
    }
    if (Array.isArray(candidate.tool_calls)) {
      message.tool_calls = candidate.tool_calls;
    }
    if (typeof candidate.tool_call_id === 'string' && candidate.tool_call_id.trim()) {
      message.tool_call_id = candidate.tool_call_id.trim();
    }
    return [message];
  });
};

const resolveJarvisAskNoContext = (args: Record<string, unknown>): boolean => {
  const noContext = parseBooleanFlag(args.noContext) ?? parseBooleanFlag(args.disableContext);
  if (noContext === true) return true;
  return parseBooleanFlag(args.context) === false;
};

const resolveJarvisSystemPrompt = (args: Record<string, unknown>): string => {
  const raw = args.systemPrompt ?? args.system;
  return typeof raw === 'string' ? raw.trim() : '';
};

const resolveJarvisServeToolChoice = (args: Record<string, unknown>): string | Record<string, unknown> | null => {
  const toolChoice = args.toolChoice ?? args.tool_choice;
  if (typeof toolChoice === 'string' && toolChoice.trim()) {
    return toolChoice.trim();
  }
  if (toolChoice && typeof toolChoice === 'object' && !Array.isArray(toolChoice)) {
    return { ...(toolChoice as Record<string, unknown>) };
  }
  return null;
};

const resolvePlainObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
};

const resolveManagedAgentName = (args: Record<string, unknown>): string => {
  const raw = String(args.name ?? args.agentName ?? '').trim();
  return raw ? stripShellMeta(raw) : '';
};

const resolveManagedAgentType = (args: Record<string, unknown>): string => {
  const raw = String(args.agentType ?? args.type ?? 'monitor_operative').trim();
  return raw ? stripShellMeta(raw) : 'monitor_operative';
};

const resolveManagedAgentId = (args: Record<string, unknown>): string => {
  const raw = String(args.agentId ?? args.id ?? '').trim();
  return raw ? stripShellMeta(raw) : '';
};

const resolveManagedAgentMessageMode = (args: Record<string, unknown>): 'immediate' | 'queued' => {
  const raw = String(args.mode ?? '').trim().toLowerCase();
  return raw === 'queued' ? 'queued' : 'immediate';
};

const resolveManagedAgentTraceId = (args: Record<string, unknown>): string => {
  const raw = String(args.traceId ?? args.trace_id ?? '').trim();
  return raw ? stripShellMeta(raw) : '';
};

const resolveManagedAgentTaskStatus = (args: Record<string, unknown>): string => {
  const raw = String(args.status ?? '').trim().toLowerCase();
  return raw ? stripShellMeta(raw) : '';
};

const resolveManagedAgentLimit = (
  args: Record<string, unknown>,
  fallback = 20,
  max = 50,
): number => {
  const parsed = parsePositiveInteger(args.limit);
  if (parsed === null) return fallback;
  return Math.min(parsed, max);
};

const buildManagedAgentPath = (agentId: string, suffix = ''): string => (
  `/v1/managed-agents/${encodeURIComponent(agentId)}${suffix}`
);

const buildManagedAgentQueryPath = (pathname: string, params: URLSearchParams): string => {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

export const buildJarvisManagedAgentCreatePayload = (args: Record<string, unknown>): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    name: resolveManagedAgentName(args),
    agent_type: resolveManagedAgentType(args),
  };
  const config = resolvePlainObject(args.config);
  const templateId = String(args.templateId ?? args.template_id ?? '').trim();
  if (config) payload.config = config;
  if (templateId) payload.template_id = stripShellMeta(templateId);
  return payload;
};

export const buildJarvisManagedAgentMessagePayload = (args: Record<string, unknown>): Record<string, unknown> => ({
  content: String(args.content ?? args.message ?? args.question ?? '').trim(),
  mode: resolveManagedAgentMessageMode(args),
  stream: false,
});

export const buildJarvisManagedAgentTasksPath = (args: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  const status = resolveManagedAgentTaskStatus(args);
  if (status) params.set('status', status);
  return buildManagedAgentQueryPath(buildManagedAgentPath(resolveManagedAgentId(args), '/tasks'), params);
};

export const buildJarvisManagedAgentTracesPath = (args: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  params.set('limit', String(resolveManagedAgentLimit(args)));
  return buildManagedAgentQueryPath(buildManagedAgentPath(resolveManagedAgentId(args), '/traces'), params);
};

export const buildJarvisManagedAgentTracePath = (args: Record<string, unknown>): string => {
  const agentId = resolveManagedAgentId(args);
  const traceId = resolveManagedAgentTraceId(args);
  return buildManagedAgentPath(agentId, `/traces/${encodeURIComponent(traceId)}`);
};

export const buildJarvisAskCliArgs = (args: Record<string, unknown>): string[] => {
  const cliArgs = ['ask', '--no-stream'];
  const engine = stripShellMeta(String(args.engine || '').trim());
  const model = stripShellMeta(String(args.model || '').trim());
  const agentName = resolveJarvisAskAgentName(args);
  const toolNames = resolveJarvisToolNames(args.toolNames ?? args.tools);
  const temperature = parseFiniteNumber(args.temperature);
  const maxTokens = parsePositiveInteger(args.maxTokens ?? args.max_tokens);
  const question = stripShellMeta(String(args.question || '').trim());

  if (engine) cliArgs.push('--engine', engine);
  if (model) cliArgs.push('--model', model);
  if (temperature !== null) cliArgs.push('--temperature', String(temperature));
  if (maxTokens !== null) cliArgs.push('--max-tokens', String(maxTokens));
  if (agentName) cliArgs.push('--agent', agentName);
  if (toolNames.length > 0) cliArgs.push('--tools', toolNames.join(','));
  if (resolveJarvisAskNoContext(args)) cliArgs.push('--no-context');
  if (question) cliArgs.push(question);

  return cliArgs;
};

export const buildJarvisServeChatPayload = (args: Record<string, unknown>): Record<string, unknown> => {
  const systemPrompt = resolveJarvisSystemPrompt(args);
  const explicitMessages = resolveJarvisChatMessages(args.messages);
  const question = String(args.question || '').trim();
  const messages = explicitMessages.length > 0
    ? explicitMessages
    : [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: question },
    ];

  const payload: Record<string, unknown> = {
    model: String(args.model || MODEL).trim() || MODEL,
    messages,
  };

  const temperature = parseFiniteNumber(args.temperature);
  const maxTokens = parsePositiveInteger(args.maxTokens ?? args.max_tokens);
  const toolDefinitions = resolveJarvisToolDefinitions(args.toolDefinitions ?? args.tools);
  const toolChoice = resolveJarvisServeToolChoice(args);

  if (temperature !== null) payload.temperature = temperature;
  if (maxTokens !== null) payload.max_tokens = maxTokens;
  if (toolDefinitions.length > 0) {
    payload.tools = toolDefinitions;
    if (toolChoice !== null) payload.tool_choice = toolChoice;
  }

  return payload;
};

export const buildJarvisAgentMessagePayload = (message: string): Record<string, string> => ({
  message,
});

export const buildOptimizeCliArgs = (args: Record<string, unknown>): string[] => {
  const optimizeArgs = ['optimize', 'run'];
  const config = stripShellMeta(String(args.config || args.configPath || '').trim());
  const benchmark = stripShellMeta(String(args.benchmark || '').trim());
  const optimizerModel = stripShellMeta(String(args.optimizerModel || args.model || '').trim());
  const optimizerEngine = stripShellMeta(String(args.optimizerEngine || args.engine || '').trim());
  const judgeModel = stripShellMeta(String(args.judgeModel || '').trim());
  const judgeEngine = stripShellMeta(String(args.judgeEngine || '').trim());
  const outputDir = stripShellMeta(String(args.outputDir || '').trim());
  const trials = parsePositiveInteger(args.trials);
  const maxSamples = parsePositiveInteger(args.maxSamples || args.samples);

  if (config) {
    optimizeArgs.push('--config', config);
  } else if (benchmark) {
    optimizeArgs.push('--benchmark', benchmark);
  }

  if (trials !== null) optimizeArgs.push('--trials', String(trials));
  if (maxSamples !== null) optimizeArgs.push('--max-samples', String(maxSamples));
  if (optimizerModel) optimizeArgs.push('--optimizer-model', optimizerModel);
  if (optimizerEngine) optimizeArgs.push('--optimizer-engine', optimizerEngine);
  if (judgeModel) optimizeArgs.push('--judge-model', judgeModel);
  if (judgeEngine) optimizeArgs.push('--judge-engine', judgeEngine);
  if (outputDir) optimizeArgs.push('--output-dir', outputDir);

  return optimizeArgs;
};

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30_000;
const ENABLED = CONFIG_OPENJARVIS_ENABLED;
const EXPLICITLY_DISABLED = CONFIG_OPENJARVIS_DISABLED;
const SERVE_URL = CONFIG_OPENJARVIS_SERVE_URL;
const MODEL = CONFIG_OPENJARVIS_MODEL || 'qwen2.5:7b-instruct';
const SERVE_API_KEY = parseStringEnv(process.env.OPENJARVIS_API_KEY, '');
const IS_WINDOWS = process.platform === 'win32';

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
  if (IS_WINDOWS) {
    return execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'jarvis', ...args], {
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
  }
  return execFileAsync('jarvis', args, {
    timeout: TIMEOUT_MS,
    windowsHide: true,
  });
};

const readResponseData = async (resp: Response): Promise<unknown> => {
  const text = await resp.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
    const data = await readResponseData(resp);
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
    const data = await readResponseData(resp);
    return { ok: resp.ok, data };
  } catch (fetchErr) {
    logger.debug('[OPENJARVIS] httpGet %s failed: %s', path, getErrorMessage(fetchErr));
    return { ok: false, data: null };
  }
};

const httpDelete = async (path: string): Promise<{ ok: boolean; data: unknown }> => {
  try {
    const headers: Record<string, string> = {};
    if (SERVE_API_KEY) headers.Authorization = `Bearer ${SERVE_API_KEY}`;
    const resp = await fetchWithTimeout(`${SERVE_URL}${path}`, {
      method: 'DELETE',
      headers,
    }, TIMEOUT_MS);
    const data = await readResponseData(resp);
    return { ok: resp.ok, data };
  } catch (fetchErr) {
    logger.debug('[OPENJARVIS] httpDelete %s failed: %s', path, getErrorMessage(fetchErr));
    return { ok: false, data: null };
  }
};

const clipSingleLine = (value: unknown, limit = 160): string => (
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
);

const formatManagedAgentSummaryLines = (agent: Record<string, unknown>): string[] => {
  const config = resolvePlainObject(agent.config);
  const lines = [
    `id: ${String(agent.id || 'unknown')}`,
    `name: ${String(agent.name || 'unnamed')}`,
    `agent_type: ${String(agent.agent_type || 'unknown')}`,
    `status: ${String(agent.status || 'unknown')}`,
  ];

  const scheduleType = String(agent.schedule_type || '').trim();
  if (scheduleType) lines.push(`schedule_type: ${scheduleType}`);

  const lastRunAt = String(agent.last_run_at || '').trim();
  if (lastRunAt) lines.push(`last_run_at: ${lastRunAt}`);

  if (config) {
    const keys = Object.keys(config);
    lines.push(`config_keys: ${keys.length > 0 ? keys.slice(0, 8).join(', ') : 'none'}`);
  }

  const summaryMemory = clipSingleLine(agent.summary_memory);
  if (summaryMemory) lines.push(`summary: ${summaryMemory}`);

  return lines;
};

const formatManagedAgentStateLines = (state: Record<string, unknown>): string[] => {
  const agent = resolvePlainObject(state.agent);
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const channels = Array.isArray(state.channels) ? state.channels : [];
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const lines = agent ? formatManagedAgentSummaryLines(agent) : ['agent: unavailable'];

  lines.push(`tasks: ${tasks.length}`);
  lines.push(`channels: ${channels.length}`);
  lines.push(`messages: ${messages.length}`);
  lines.push(`checkpoint: ${state.checkpoint ? 'present' : 'none'}`);
  return lines;
};

export const openjarvisAdapter: ExternalToolAdapter = {
  id: 'openjarvis',
  description: 'Stanford OpenJarvis — local-first personal AI framework. Q&A, server inventory, managed agent lifecycle, state and traces, optimization, benchmarks, memory, evaluation, and telemetry.',
  capabilities: [
    'jarvis.ask', 'jarvis.server.info', 'jarvis.models.list', 'jarvis.tools.list',
    'jarvis.agents.health', 'jarvis.recommended-model',
    'jarvis.agent.list', 'jarvis.agent.get', 'jarvis.agent.create', 'jarvis.agent.delete',
    'jarvis.agent.pause', 'jarvis.agent.resume', 'jarvis.agent.run', 'jarvis.agent.recover',
    'jarvis.agent.message', 'jarvis.agent.state', 'jarvis.agent.messages.list',
    'jarvis.agent.tasks.list', 'jarvis.agent.traces.list', 'jarvis.agent.trace.get',
    'jarvis.serve', 'jarvis.optimize', 'jarvis.bench', 'jarvis.feedback',
    'jarvis.research', 'jarvis.digest', 'jarvis.memory.index', 'jarvis.memory.search',
    'jarvis.eval', 'jarvis.telemetry', 'jarvis.scheduler.list', 'jarvis.skill.search',
  ],
  liteCapabilities: [
    'jarvis.ask',
    'jarvis.server.info',
    'jarvis.models.list',
    'jarvis.tools.list',
    'jarvis.agents.health',
    'jarvis.recommended-model',
    'jarvis.agent.list',
    'jarvis.memory.search',
    'jarvis.telemetry',
    'jarvis.scheduler.list',
    'jarvis.skill.search',
  ],

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
          if (!question.trim()) return makeResult(false, 'Question required', [], 'MISSING_QUESTION');

          const agentName = resolveJarvisAskAgentName(args);
          const toolNames = resolveJarvisToolNames(args.toolNames ?? args.tools);
          const wantsNoContext = resolveJarvisAskNoContext(args);
          const preferCli = Boolean(agentName) || toolNames.length > 0 || wantsNoContext;

          // Prefer serve for direct chat. Upstream does not support per-request agent selection
          // on /v1/chat/completions, so agent/tools/no-context routes through the documented CLI.
          if (!preferCli) {
            const serveOk = await checkServeHealth();
            if (serveOk) {
              const { ok, data } = await httpPost('/v1/chat/completions', buildJarvisServeChatPayload({
                ...args,
                question,
              }));
              if (ok && data) {
                const resp = data as {
                  choices?: Array<{
                    message?: {
                      content?: string;
                      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
                    };
                  }>;
                };
                const message = resp.choices?.[0]?.message;
                const content = typeof message?.content === 'string' ? message.content : '';
                const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
                const output = content
                  ? content.split('\n').slice(0, 20)
                  : toolCalls.slice(0, 10).map((toolCall, index) => {
                    const fn = toolCall.function;
                    return `[${index + 1}] ${fn?.name || 'tool'} ${fn?.arguments || '{}'}`;
                  });
                return makeResult(true, 'Response via jarvis serve', output);
              }
            }
          }

          // Fallback to CLI
          if (cliAvailable !== false) {
            try {
              const { stdout } = await runCli(buildJarvisAskCliArgs({ ...args, question }));
              const cliSummary = agentName
                ? `Response via jarvis CLI (${agentName})`
                : 'Response via jarvis CLI';
              return makeResult(true, cliSummary, stdout.trim().split('\n').slice(0, 20));
            } catch {
              // CLI failed — try LiteLLM fallback below
            }
          }

          // Central LLM fallback (lite mode or CLI failure)
          const fallbackLines = await runAdapterLlmFallback({
            actionName: 'jarvis.ask',
            system: 'You are a helpful AI assistant.',
            user: question,
            lineLimit: 20,
            debugLabel: '[OPENJARVIS]',
          });
          if (fallbackLines) {
            const mode = cliAvailable === false ? ' (lite mode)' : '';
            const degraded = preferCli ? ' (agent/tools/no-context unavailable)' : '';
            return makeResult(true, `Response via LLM${mode}${degraded}`, fallbackLines);
          }

          return makeResult(false, 'No inference endpoint available', [], 'INFERENCE_UNAVAILABLE');
        }

        case 'jarvis.server.info': {
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet('/v1/info');
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve server info', [], 'API_UNAVAILABLE');
          }
          const info = data as Record<string, unknown>;
          return makeResult(true, 'Server info retrieved', [
            `engine: ${String(info.engine || 'unknown')}`,
            `model: ${String(info.model || 'unknown')}`,
            `agent: ${String(info.agent || 'none')}`,
          ]);
        }

        case 'jarvis.models.list': {
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet('/v1/models');
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve models', [], 'API_UNAVAILABLE');
          }
          const response = data as { data?: Array<{ id?: string; owned_by?: string }> };
          const models = Array.isArray(response.data) ? response.data : [];
          const lines = models.slice(0, 30).map((model, index) => (
            `[${index + 1}] ${String(model.id || 'unknown')} — ${String(model.owned_by || 'openjarvis')}`
          ));
          return makeResult(true, `Found ${models.length} models`, lines);
        }

        case 'jarvis.tools.list': {
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet('/v1/tools');
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve tools', [], 'API_UNAVAILABLE');
          }
          const response = data as {
            tools?: Array<{ name?: string; description?: string; category?: string; source?: string; configured?: boolean }>;
          };
          const tools = Array.isArray(response.tools) ? response.tools : [];
          const lines = tools.slice(0, 30).map((tool, index) => (
            `[${index + 1}] ${String(tool.name || 'unnamed')} (${String(tool.category || 'uncategorized')}/${String(tool.source || 'unknown')})${tool.configured === false ? ' [unconfigured]' : ''} — ${String(tool.description || '').slice(0, 120)}`
          ));
          return makeResult(true, `Found ${tools.length} tools`, lines);
        }

        case 'jarvis.agents.health': {
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet('/v1/agents/health');
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve agent health', [], 'API_UNAVAILABLE');
          }
          const health = data as { total?: number; by_status?: Record<string, unknown> };
          const byStatus = health.by_status && typeof health.by_status === 'object'
            ? Object.entries(health.by_status)
            : [];
          const lines = [`total: ${String(health.total ?? byStatus.length)}`];
          lines.push(...byStatus.map(([status, count]) => `${status}: ${String(count)}`));
          return makeResult(true, 'Managed agent health retrieved', lines);
        }

        case 'jarvis.recommended-model': {
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet('/v1/recommended-model');
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve recommended model', [], 'API_UNAVAILABLE');
          }
          const response = data as Record<string, unknown>;
          return makeResult(true, 'Recommended model retrieved', [
            `model: ${String(response.model || 'unknown')}`,
            `reason: ${clipSingleLine(response.reason, 200) || 'none'}`,
          ]);
        }

        case 'jarvis.agent.list': {
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet('/v1/managed-agents');
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve managed agents', [], 'API_UNAVAILABLE');
          }
          const response = data as {
            agents?: Array<{ id?: string; name?: string; agent_type?: string; status?: string }>;
          };
          const agents = Array.isArray(response.agents) ? response.agents : [];
          const lines = agents.slice(0, 30).map((agent, index) => (
            `[${index + 1}] ${String(agent.id || 'unknown')} ${String(agent.name || 'unnamed')} — ${String(agent.agent_type || 'unknown')} [${String(agent.status || 'unknown')}]`
          ));
          return makeResult(true, `Found ${agents.length} managed agents`, lines);
        }

        case 'jarvis.agent.get': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet(buildManagedAgentPath(agentId));
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve managed agent', [], 'API_UNAVAILABLE');
          }
          return makeResult(true, 'Managed agent retrieved', formatManagedAgentSummaryLines(data as Record<string, unknown>));
        }

        case 'jarvis.agent.create': {
          const payload = buildJarvisManagedAgentCreatePayload(args);
          if (!String(payload.name || '').trim()) {
            return makeResult(false, 'Agent name required', [], 'MISSING_AGENT_NAME');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpPost('/v1/managed-agents', payload);
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to create managed agent', [], 'API_UNAVAILABLE');
          }
          const agent = data as Record<string, unknown>;
          return makeResult(true, 'Managed agent created', [
            `id: ${String(agent.id || 'unknown')}`,
            `name: ${String(agent.name || payload.name)}`,
            `agent_type: ${String(agent.agent_type || payload.agent_type || 'unknown')}`,
            `status: ${String(agent.status || 'unknown')}`,
          ]);
        }

        case 'jarvis.agent.message': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const payload = buildJarvisManagedAgentMessagePayload(args);
          if (!String(payload.content || '').trim()) {
            return makeResult(false, 'content required', [], 'MISSING_CONTENT');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpPost(`/v1/managed-agents/${encodeURIComponent(agentId)}/messages`, payload);
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to send message to managed agent', [], 'API_UNAVAILABLE');
          }
          const message = data as Record<string, unknown>;
          return makeResult(true, 'Managed agent message accepted', [
            `agent_id: ${String(message.agent_id || agentId)}`,
            `message_id: ${String(message.id || 'unknown')}`,
            `mode: ${String(message.mode || payload.mode)}`,
            `status: ${String(message.status || 'accepted')}`,
            `content: ${String(message.content || payload.content).slice(0, 200)}`,
          ]);
        }

        case 'jarvis.agent.delete': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpDelete(buildManagedAgentPath(agentId));
          if (!ok) {
            return makeResult(false, 'Failed to archive managed agent', [], 'API_UNAVAILABLE');
          }
          const response = data && typeof data === 'object' ? data as Record<string, unknown> : {};
          return makeResult(true, 'Managed agent archived', [
            `id: ${agentId}`,
            `status: ${String(response.status || 'archived')}`,
          ]);
        }

        case 'jarvis.agent.pause': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpPost(buildManagedAgentPath(agentId, '/pause'), {});
          if (!ok) {
            return makeResult(false, 'Failed to pause managed agent', [], 'API_UNAVAILABLE');
          }
          const response = data && typeof data === 'object' ? data as Record<string, unknown> : {};
          return makeResult(true, 'Managed agent paused', [
            `id: ${agentId}`,
            `status: ${String(response.status || 'paused')}`,
          ]);
        }

        case 'jarvis.agent.resume': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpPost(buildManagedAgentPath(agentId, '/resume'), {});
          if (!ok) {
            return makeResult(false, 'Failed to resume managed agent', [], 'API_UNAVAILABLE');
          }
          const response = data && typeof data === 'object' ? data as Record<string, unknown> : {};
          return makeResult(true, 'Managed agent resumed', [
            `id: ${agentId}`,
            `status: ${String(response.status || 'idle')}`,
          ]);
        }

        case 'jarvis.agent.run': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpPost(buildManagedAgentPath(agentId, '/run'), {});
          if (!ok) {
            return makeResult(false, 'Failed to run managed agent', [], 'API_UNAVAILABLE');
          }
          const response = data && typeof data === 'object' ? data as Record<string, unknown> : {};
          return makeResult(true, 'Managed agent run triggered', [
            `id: ${agentId}`,
            `status: ${String(response.status || 'running')}`,
          ]);
        }

        case 'jarvis.agent.recover': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpPost(buildManagedAgentPath(agentId, '/recover'), {});
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to recover managed agent', [], 'API_UNAVAILABLE');
          }
          const response = data as Record<string, unknown>;
          return makeResult(true, 'Managed agent recovered', [
            `id: ${agentId}`,
            `recovered: ${String(response.recovered ?? true)}`,
            `checkpoint: ${response.checkpoint ? 'present' : 'none'}`,
          ]);
        }

        case 'jarvis.agent.state': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet(buildManagedAgentPath(agentId, '/state'));
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve managed agent state', [], 'API_UNAVAILABLE');
          }
          return makeResult(true, 'Managed agent state retrieved', formatManagedAgentStateLines(data as Record<string, unknown>));
        }

        case 'jarvis.agent.messages.list': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet(buildManagedAgentPath(agentId, '/messages'));
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve managed agent messages', [], 'API_UNAVAILABLE');
          }
          const response = data as { messages?: Array<Record<string, unknown>> };
          const messages = Array.isArray(response.messages) ? response.messages : [];
          const lines = messages.slice(-20).map((message, index) => (
            `[${index + 1}] ${String(message.direction || 'unknown')} [${String(message.status || 'unknown')}/${String(message.mode || 'unknown')}] ${clipSingleLine(message.content) || '(empty)'}`
          ));
          return makeResult(true, `Found ${messages.length} managed agent messages`, lines);
        }

        case 'jarvis.agent.tasks.list': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet(buildJarvisManagedAgentTasksPath(args));
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve managed agent tasks', [], 'API_UNAVAILABLE');
          }
          const response = data as { tasks?: Array<Record<string, unknown>> };
          const tasks = Array.isArray(response.tasks) ? response.tasks : [];
          const lines = tasks.slice(0, 20).map((task, index) => (
            `[${index + 1}] ${String(task.id || 'unknown')} [${String(task.status || 'unknown')}] ${clipSingleLine(task.description) || '(no description)'}`
          ));
          return makeResult(true, `Found ${tasks.length} managed agent tasks`, lines);
        }

        case 'jarvis.agent.traces.list': {
          const agentId = resolveManagedAgentId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet(buildJarvisManagedAgentTracesPath(args));
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve managed agent traces', [], 'API_UNAVAILABLE');
          }
          const response = data as { traces?: Array<Record<string, unknown>> };
          const traces = Array.isArray(response.traces) ? response.traces : [];
          const lines = traces.slice(0, 20).map((trace, index) => (
            `[${index + 1}] ${String(trace.id || 'unknown')} [${String(trace.outcome || 'unknown')}] duration=${String(trace.duration || '?')} steps=${String(trace.steps || 0)}`
          ));
          return makeResult(true, `Found ${traces.length} managed agent traces`, lines);
        }

        case 'jarvis.agent.trace.get': {
          const agentId = resolveManagedAgentId(args);
          const traceId = resolveManagedAgentTraceId(args);
          if (!agentId) {
            return makeResult(false, 'agentId required', [], 'MISSING_AGENT_ID');
          }
          if (!traceId) {
            return makeResult(false, 'traceId required', [], 'MISSING_TRACE_ID');
          }
          const serveOk = await checkServeHealth();
          if (!serveOk) {
            return makeResult(false, 'jarvis serve not running', [`Start with: jarvis serve --port 8000`], 'NOT_RUNNING');
          }
          const { ok, data } = await httpGet(buildJarvisManagedAgentTracePath(args));
          if (!ok || !data || typeof data !== 'object') {
            return makeResult(false, 'Failed to retrieve managed agent trace', [], 'API_UNAVAILABLE');
          }
          const trace = data as Record<string, unknown>;
          const steps = Array.isArray(trace.steps) ? trace.steps as Array<Record<string, unknown>> : [];
          const lines = [
            `id: ${String(trace.id || traceId)}`,
            `agent: ${String(trace.agent || agentId)}`,
            `outcome: ${String(trace.outcome || 'unknown')}`,
            `duration: ${String(trace.duration || '?')}`,
            `started_at: ${String(trace.started_at || 'unknown')}`,
            `steps: ${steps.length}`,
          ];
          lines.push(...steps.slice(0, 10).map((step, index) => (
            `[step ${index + 1}] ${String(step.step_type || 'unknown')} duration=${String(step.duration || '?')} ${clipSingleLine(step.output) || '(no output)'}`
          )));
          return makeResult(true, 'Managed agent trace retrieved', lines);
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
          const optimizeArgs = buildOptimizeCliArgs(args);
          if (optimizeArgs.length === 2) {
            return makeResult(false, 'benchmark or config required', [], 'MISSING_BENCHMARK_OR_CONFIG');
          }
          const { stdout, stderr } = await runCli(optimizeArgs);
          const text = String(stdout || stderr || '').trim();
          return makeResult(true, 'Optimization completed', text.split('\n').slice(0, 20));
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
              ...buildJarvisAgentMessagePayload(query),
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
              ...buildJarvisAgentMessagePayload(digestTopic),
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
