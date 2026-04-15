import 'dotenv/config';

/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import { resolveN8nLocalStatus } from './bootstrap-n8n-local.mjs';
import { readLatestWorkflowState } from './openjarvis-workflow-state.mjs';

const ROOT = process.cwd();
const REPO_ENV_PATH = path.join(ROOT, '.env');
const TMP_DIR = path.join(ROOT, 'tmp', 'local-ai-stack');
const PROCESS_DIR = path.join(TMP_DIR, 'processes');
const MANIFEST_PATH = path.join(TMP_DIR, 'manifest.json');
const DEFAULT_PROFILE = 'local-nemoclaw-max-delegation';
const DEFAULT_RUNTIME_LANE = String(process.env.OPENJARVIS_RUNTIME_LANE || 'operator-personal').trim() || 'operator-personal';
const DEFAULT_MEMORY_SUMMARY_PATH = path.join(ROOT, 'tmp', 'openjarvis-memory-feed', 'summary.json');
const DIRECT_VAULT_ADAPTERS = new Set(['local-fs', 'native-cli', 'script-cli']);
const fileName = fileURLToPath(import.meta.url);

const compact = (value) => String(value || '').trim();

export const parseCsvList = (raw) => String(raw || '')
  .split(',')
  .map((entry) => compact(entry).toLowerCase())
  .filter(Boolean);

export const parseBoolLike = (value, fallback = false) => {
  const normalized = compact(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

export const parseEmbeddedJsonPayload = (raw, fallback = null) => {
  const text = String(raw || '').trim();
  if (!text) {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Fall through to mixed-output parsing.
  }

  let lastParsed = fallback;
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      if (depth > 0) {
        depth -= 1;
      }
      if (depth === 0 && startIndex >= 0) {
        const candidate = text.slice(startIndex, index + 1);
        try {
          lastParsed = JSON.parse(candidate);
        } catch {
          // Keep the latest valid JSON payload only.
        }
        startIndex = -1;
      }
    }
  }

  return lastParsed;
};

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const writeJsonFile = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseEnvAssignments = (text) => {
  const env = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (!/^[A-Z0-9_]+$/i.test(key)) {
      continue;
    }
    env[key] = value;
  }
  return env;
};

const hydrateProcessEnvFromFile = (filePath) => {
  const env = parseEnvAssignments(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  return env;
};

const normalizeUrl = (value, fallback = '') => {
  const raw = compact(value || fallback);
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

const isLocalHostname = (hostname) => ['127.0.0.1', 'localhost'].includes(compact(hostname).toLowerCase());

export const isLocalUrl = (value) => {
  const parsed = normalizeUrl(value);
  return Boolean(parsed && isLocalHostname(parsed.hostname));
};

const timedFetch = async (url, init = {}, timeoutMs = 5_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const runCommandProbe = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0;
};

const isJarvisCliAvailable = () => {
  if (process.platform === 'win32') {
    return runCommandProbe(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'where', 'jarvis']);
  }
  return runCommandProbe('jarvis', ['--help']);
};

const runNodeScriptSync = (scriptRelativePath, args = []) => {
  const scriptPath = path.join(ROOT, scriptRelativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
};

const runNpmScriptSync = (scriptName) => {
  if (process.platform === 'win32') {
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', 'run', '-s', scriptName], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: process.env,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
    };
  }

  const result = spawnSync('npm', ['run', '-s', scriptName], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
};

const readManifest = () => readJsonFile(MANIFEST_PATH) || { processes: [] };

const writeManifestEntry = (entry) => {
  const manifest = readManifest();
  const processes = Array.isArray(manifest.processes) ? manifest.processes : [];
  const next = [
    entry,
    ...processes.filter((item) => compact(item?.id) !== compact(entry.id)),
  ].slice(0, 10);
  writeJsonFile(MANIFEST_PATH, {
    updatedAt: new Date().toISOString(),
    processes: next,
  });
};

const waitForHealth = async (probe, attempts = 8, delayMs = 1_500) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = await probe();
    if (status.reachable) {
      return { ready: true, attempts: attempt, status };
    }
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
  return { ready: false, attempts, status: await probe() };
};

export const deriveObsidianAccessPosture = (env = {}) => {
  const defaultOrder = parseCsvList(env.OBSIDIAN_ADAPTER_ORDER || 'remote-mcp,native-cli,script-cli,local-fs');
  const readOrder = parseCsvList(env.OBSIDIAN_ADAPTER_ORDER_READ_FILE || env.OBSIDIAN_ADAPTER_ORDER_READ_LORE || defaultOrder.join(','));
  const searchOrder = parseCsvList(env.OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT || defaultOrder.join(','));
  const writeOrder = parseCsvList(env.OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE || defaultOrder.join(','));
  const primaryReadAdapter = readOrder[0] || null;
  const primarySearchAdapter = searchOrder[0] || null;
  const primaryWriteAdapter = writeOrder[0] || null;
  const activeAdapters = [...new Set([primaryReadAdapter, primarySearchAdapter, primaryWriteAdapter].filter(Boolean))];
  const remoteHttpIngressActive = activeAdapters.includes('remote-mcp');
  const directVaultPathActive = activeAdapters.some((adapterId) => DIRECT_VAULT_ADAPTERS.has(adapterId));

  if (activeAdapters.length === 0) {
    return {
      mode: 'disconnected',
      summary: 'No Obsidian adapter is active',
      primaryReadAdapter,
      primarySearchAdapter,
      primaryWriteAdapter,
    };
  }

  if (remoteHttpIngressActive && directVaultPathActive) {
    return {
      mode: 'mixed-routing',
      summary: `Remote MCP and direct vault adapters are mixed across capabilities (read=${primaryReadAdapter || 'none'}, search=${primarySearchAdapter || 'none'}, write=${primaryWriteAdapter || 'none'})`,
      primaryReadAdapter,
      primarySearchAdapter,
      primaryWriteAdapter,
    };
  }

  if (directVaultPathActive) {
    return {
      mode: 'direct-vault-primary',
      summary: `Direct vault adapters are primary (read=${primaryReadAdapter || 'none'}, search=${primarySearchAdapter || 'none'}, write=${primaryWriteAdapter || 'none'})`,
      primaryReadAdapter,
      primarySearchAdapter,
      primaryWriteAdapter,
    };
  }

  return {
    mode: 'shared-remote-ingress',
    summary: `Remote MCP is primary for Obsidian access (read=${primaryReadAdapter || 'none'}, search=${primarySearchAdapter || 'none'}, write=${primaryWriteAdapter || 'none'})`,
    primaryReadAdapter,
    primarySearchAdapter,
    primaryWriteAdapter,
  };
};

const loadEffectiveObsidianAccessPosture = () => {
  const fallback = {
    ...deriveObsidianAccessPosture(process.env),
    source: 'heuristic',
  };

  const inlineScript = [
    'void (async () => {',
    "  const { getObsidianAdapterRuntimeStatus } = await import('./src/services/obsidian/router.ts');",
    '  const status = getObsidianAdapterRuntimeStatus();',
    '  console.log(JSON.stringify(status.accessPosture));',
    '})().catch((error) => {',
    '  console.error(error instanceof Error ? error.message : String(error));',
    '  process.exit(1);',
    '});',
  ].join('\n');

  const result = spawnSync(process.execPath, ['--import', 'dotenv/config', '--import', 'tsx', '--eval', inlineScript], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  });

  if (result.status !== 0) {
    return fallback;
  }

  const parsed = parseEmbeddedJsonPayload(result.stdout, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallback;
  }

  return {
    ...parsed,
    source: 'runtime',
  };
};

export const buildManagedServicePlan = (env = {}) => {
  const litellmBaseUrl = compact(env.LITELLM_BASE_URL || 'http://127.0.0.1:4000');
  const n8nBaseUrl = compact(env.N8N_BASE_URL || 'http://127.0.0.1:5678');
  const openjarvisServeUrl = compact(env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000');
  const workerUrl = compact(env.MCP_IMPLEMENT_WORKER_URL || env.MCP_OPENCODE_WORKER_URL || '');
  const openjarvisEngine = compact(env.OPENJARVIS_ENGINE || '').toLowerCase();
  const provider = compact(env.AI_PROVIDER || '').toLowerCase();
  const litellmEnabled = parseBoolLike(env.LITELLM_ENABLED, openjarvisEngine === 'litellm');

  return {
    litellm: litellmEnabled && isLocalUrl(litellmBaseUrl),
    n8n: !parseBoolLike(env.N8N_DISABLED, false) && parseBoolLike(env.N8N_ENABLED, true) && isLocalUrl(n8nBaseUrl),
    openjarvis: parseBoolLike(env.OPENJARVIS_ENABLED, false) && isLocalUrl(openjarvisServeUrl),
    opencodeWorker: Boolean(workerUrl) && isLocalUrl(workerUrl),
    requiresOllama: provider === 'ollama' || openjarvisEngine === 'ollama' || litellmEnabled,
  };
};

const probeOllama = async () => {
  const baseUrl = compact(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  const model = compact(process.env.OLLAMA_MODEL || process.env.LOCAL_LLM_MODEL || '');
  const tagsUrl = `${baseUrl.replace(/\/+$/, '')}/api/tags`;

  try {
    const response = await timedFetch(tagsUrl, { method: 'GET' }, 5_000);
    const body = await response.text();
    let listed = false;
    try {
      const payload = JSON.parse(body || '{}');
      const models = Array.isArray(payload.models) ? payload.models : [];
      listed = Boolean(model) && models.some((item) => compact(item?.name).toLowerCase() === model.toLowerCase());
    } catch {
      listed = false;
    }

    return {
      baseUrl,
      model: model || null,
      reachable: response.ok,
      status: response.status,
      modelListed: model ? listed : null,
    };
  } catch (error) {
    return {
      baseUrl,
      model: model || null,
      reachable: false,
      status: 0,
      modelListed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const probeLiteLlm = async () => {
  const baseUrl = compact(process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000');
  const healthUrl = `${baseUrl.replace(/\/+$/, '')}/health/liveliness`;
  try {
    const response = await timedFetch(healthUrl, { method: 'GET' }, 5_000);
    return {
      baseUrl,
      reachable: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      baseUrl,
      reachable: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const probeOpenJarvis = async () => {
  const baseUrl = compact(process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000');
  const apiKey = compact(process.env.OPENJARVIS_API_KEY || process.env.OPENJARVIS_SERVE_API_KEY || '');
  const engine = compact(process.env.OPENJARVIS_ENGINE || '');
  const model = compact(process.env.OPENJARVIS_MODEL || '');
  const modelsUrl = `${baseUrl.replace(/\/+$/, '')}/v1/models`;

  if (!apiKey) {
    return {
      baseUrl,
      reachable: false,
      status: 0,
      authConfigured: false,
      engine: engine || null,
      model: model || null,
      error: 'OPENJARVIS_SERVE_API_KEY_OR_OPENJARVIS_API_KEY_MISSING',
    };
  }

  try {
    const response = await timedFetch(modelsUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    }, 20_000);
    return {
      baseUrl,
      reachable: response.ok,
      status: response.status,
      authConfigured: true,
      engine: engine || null,
      model: model || null,
    };
  } catch (error) {
    return {
      baseUrl,
      reachable: false,
      status: 0,
      authConfigured: true,
      engine: engine || null,
      model: model || null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const probeWorker = async () => {
  const baseUrl = compact(process.env.MCP_IMPLEMENT_WORKER_URL || process.env.MCP_OPENCODE_WORKER_URL || '');
  const allowWrite = parseBoolLike(process.env.OPENCODE_LOCAL_WORKER_ALLOW_WRITE, false);
  if (!baseUrl) {
    return {
      baseUrl: null,
      reachable: false,
      status: 0,
      allowWrite,
      error: 'MCP_IMPLEMENT_WORKER_URL_MISSING',
    };
  }

  const healthTargets = [
    baseUrl,
    `${baseUrl.replace(/\/+$/, '')}/health`,
  ];

  for (const target of healthTargets) {
    try {
      const response = await timedFetch(target, { method: 'GET' }, 5_000);
      if (response.ok) {
        return {
          baseUrl,
          reachable: true,
          status: response.status,
          allowWrite,
        };
      }
    } catch {
      // Try the next target.
    }
  }

  return {
    baseUrl,
    reachable: false,
    status: 0,
    allowWrite,
    error: 'WORKER_HEALTH_UNREACHABLE',
  };
};

const loadMemoryProjectionSummary = () => {
  const summary = readJsonFile(DEFAULT_MEMORY_SUMMARY_PATH);
  if (!summary || typeof summary !== 'object') {
    return {
      present: false,
      fresh: false,
      generatedAt: null,
      indexedStatus: null,
      totalDocs: 0,
      path: path.relative(ROOT, DEFAULT_MEMORY_SUMMARY_PATH).replace(/\\/g, '/'),
    };
  }

  const generatedAt = compact(summary.generatedAt || '');
  const generatedMs = Date.parse(generatedAt);
  const fresh = Number.isFinite(generatedMs) && (Date.now() - generatedMs) <= 24 * 60 * 60 * 1000;

  return {
    present: true,
    fresh,
    generatedAt: generatedAt || null,
    indexedStatus: compact(summary.memoryIndex?.status || '') || null,
    totalDocs: Number(summary.counts?.total || 0) || 0,
    path: path.relative(ROOT, DEFAULT_MEMORY_SUMMARY_PATH).replace(/\\/g, '/'),
  };
};

const loadWorkflowStateSummary = async (runtimeLane) => {
  try {
    const latest = await readLatestWorkflowState({ runtimeLane });
    if (!latest?.ok || !latest.session) {
      return {
        available: false,
        source: latest?.source || 'unavailable',
        sessionId: null,
        status: null,
        objective: null,
        runtimeLane,
      };
    }

    return {
      available: true,
      source: latest.source || 'unknown',
      sessionId: compact(latest.session.session_id || '') || null,
      status: compact(latest.session.status || '') || null,
      objective: compact(latest.session.metadata?.objective || '') || null,
      runtimeLane: compact(latest.session.metadata?.runtime_lane || runtimeLane) || runtimeLane,
      sessionPath: latest.sessionPath ? path.relative(ROOT, latest.sessionPath).replace(/\\/g, '/') : null,
    };
  } catch (error) {
    return {
      available: false,
      source: 'unavailable',
      sessionId: null,
      status: null,
      objective: null,
      runtimeLane,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const buildManualLanes = () => ({
  openclawEnabled: parseBoolLike(process.env.OPENCLAW_ENABLED, false),
  nemoclawEnabled: parseBoolLike(process.env.NEMOCLAW_ENABLED, false),
  openshellEnabled: parseBoolLike(process.env.OPENSHELL_ENABLED, false),
  note: 'OpenClaw, NemoClaw, and OpenShell remain operator-managed or WSL-managed lanes; this control surface auto-starts only deterministic local services.',
});

const ensureUniqueSteps = (steps) => [...new Set(steps.filter(Boolean))];

const buildDoctorReport = async ({ profile = DEFAULT_PROFILE } = {}) => {
  const runtimeLane = compact(process.env.OPENJARVIS_RUNTIME_LANE || DEFAULT_RUNTIME_LANE) || DEFAULT_RUNTIME_LANE;
  const plan = buildManagedServicePlan(process.env);
  const obsidian = loadEffectiveObsidianAccessPosture();
  const manualLanes = buildManualLanes();
  const [ollama, litellm, openjarvis, worker, n8n, workflowState] = await Promise.all([
    probeOllama(),
    probeLiteLlm(),
    probeOpenJarvis(),
    probeWorker(),
    resolveN8nLocalStatus({ baseUrl: compact(process.env.N8N_BASE_URL || 'http://127.0.0.1:5678') }),
    loadWorkflowStateSummary(runtimeLane),
  ]);
  const memoryProjection = loadMemoryProjectionSummary();

  const failures = [];
  const warnings = [];
  const nextSteps = [];

  if (plan.requiresOllama && !ollama.reachable) {
    failures.push('Local Ollama is required by the current stack profile but /api/tags is unreachable.');
    nextSteps.push(`ollama serve or verify ${ollama.baseUrl}`);
  } else if (plan.requiresOllama && ollama.model && ollama.modelListed === false) {
    warnings.push(`Ollama is reachable but model '${ollama.model}' is not listed locally.`);
    nextSteps.push(`ollama pull ${ollama.model}`);
  }

  if (plan.litellm && !litellm.reachable) {
    failures.push('Local LiteLLM sidecar is expected by the current profile but /health/liveliness is unreachable.');
    nextSteps.push('npm run docker:local:infra:up');
  }

  if (plan.openjarvis && !openjarvis.authConfigured) {
    failures.push('Local OpenJarvis serve is enabled but OPENJARVIS_SERVE_API_KEY or OPENJARVIS_API_KEY is missing.');
  } else if (plan.openjarvis && !openjarvis.reachable) {
    failures.push('Local OpenJarvis serve is enabled but /v1/models is unreachable with auth.');
    nextSteps.push('npm run openjarvis:serve:local');
  }

  if (plan.opencodeWorker && !worker.reachable) {
    failures.push('Local implement worker is expected by the current profile but /health is unreachable.');
    nextSteps.push('npm run worker:opencode:local');
  }

  if (plan.n8n && !n8n.reachable) {
    failures.push('Local n8n delegation is enabled but the local n8n base URL is unreachable.');
    nextSteps.push('npm run n8n:local:start');
  } else if (plan.n8n && !n8n.composeExists) {
    warnings.push('Local n8n delegation is enabled but the bootstrap files do not exist yet.');
    nextSteps.push('npm run n8n:local:bootstrap');
  }

  if (obsidian.mode !== 'direct-vault-primary') {
    warnings.push(`Obsidian is not in direct-vault-primary mode (${obsidian.mode}).`);
  }

  if (parseBoolLike(process.env.OPENJARVIS_MEMORY_SYNC_ENABLED, false) || parseBoolLike(process.env.OPENJARVIS_LEARNING_LOOP_ENABLED, false)) {
    if (!memoryProjection.present) {
      warnings.push('OpenJarvis memory projection summary is missing.');
      nextSteps.push('npm run openjarvis:memory:sync');
    } else if (!memoryProjection.fresh) {
      warnings.push('OpenJarvis memory projection exists but is stale.');
      nextSteps.push('npm run openjarvis:memory:sync');
    } else if (memoryProjection.indexedStatus === 'failed') {
      warnings.push('OpenJarvis memory projection recorded a failed index run.');
      nextSteps.push('npm run openjarvis:memory:sync');
    }
  }

  if (!workflowState.available) {
    warnings.push('No recent OpenJarvis workflow session was found for the current runtime lane.');
    nextSteps.push('npm run openjarvis:goal:status');
  }

  if (manualLanes.openclawEnabled || manualLanes.nemoclawEnabled || manualLanes.openshellEnabled) {
    warnings.push('Interactive external lanes are enabled, but this control surface does not auto-start WSL or dashboard-managed runtimes.');
  }

  return {
    ok: failures.length === 0,
    action: 'doctor',
    checkedAt: new Date().toISOString(),
    profile: {
      requested: profile,
      applyCommand: `npm run env:profile:${profile}`,
    },
    plan,
    failures,
    warnings,
    nextSteps: ensureUniqueSteps(nextSteps),
    services: {
      ollama,
      litellm,
      openjarvis,
      opencodeWorker: worker,
      n8n,
    },
    obsidian,
    workflowState,
    memoryProjection,
    manualLanes,
  };
};

const applyProfile = ({ profile, dryRun }) => {
  if (dryRun) {
    return {
      ok: true,
      skipped: true,
      reason: 'dry-run',
      profile,
    };
  }

  const result = runNodeScriptSync(path.join('scripts', 'apply-env-profile.mjs'), [profile]);
  if (result.ok) {
    hydrateProcessEnvFromFile(path.join(ROOT, '.env'));
  }
  return {
    ok: result.ok,
    skipped: false,
    reason: result.ok ? 'applied' : 'failed',
    profile,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const ensureDetachedNodeScript = async ({ id, scriptRelativePath, probe, preflight = null, dryRun = false, attempts = 8, delayMs = 1_500 }) => {
  const before = await probe();
  if (before.reachable) {
    return {
      ok: true,
      id,
      started: false,
      alreadyRunning: true,
      ready: true,
      logPath: null,
      pid: null,
      status: before,
    };
  }

  const relativeScriptPath = scriptRelativePath.replace(/\\/g, '/');
  const logPath = path.join(PROCESS_DIR, `${id}.log`);

  if (dryRun) {
    return {
      ok: true,
      id,
      started: false,
      alreadyRunning: false,
      ready: false,
      dryRun: true,
      logPath: path.relative(ROOT, logPath).replace(/\\/g, '/'),
      command: `${process.execPath} ${relativeScriptPath}`,
    };
  }

  if (preflight) {
    const preflightResult = await preflight();
    if (!preflightResult.ok) {
      return {
        ok: false,
        id,
        started: false,
        alreadyRunning: false,
        ready: false,
        logPath: null,
        pid: null,
        error: preflightResult.error,
      };
    }
  }

  fs.mkdirSync(PROCESS_DIR, { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, relativeScriptPath)], {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(fd);

  writeManifestEntry({
    id,
    pid: child.pid || null,
    script: relativeScriptPath,
    logPath: path.relative(ROOT, logPath).replace(/\\/g, '/'),
    startedAt: new Date().toISOString(),
  });

  const health = await waitForHealth(probe, attempts, delayMs);
  return {
    ok: health.ready,
    id,
    started: true,
    alreadyRunning: false,
    ready: health.ready,
    attempts: health.attempts,
    logPath: path.relative(ROOT, logPath).replace(/\\/g, '/'),
    pid: child.pid || null,
    status: health.status,
  };
};

const ensureCommandStart = async ({ id, scriptName, probe, dryRun = false }) => {
  const before = await probe();
  if (before.reachable) {
    return {
      ok: true,
      id,
      started: false,
      alreadyRunning: true,
      ready: true,
      status: before,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      id,
      started: false,
      dryRun: true,
      command: `npm run ${scriptName}`,
    };
  }

  const result = runNpmScriptSync(scriptName);
  const health = await waitForHealth(probe, 6, 1_000);
  return {
    ok: result.ok && health.ready,
    id,
    started: result.ok,
    alreadyRunning: false,
    ready: health.ready,
    status: health.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const runUp = async ({ profile = DEFAULT_PROFILE, applyProfileFirst = true, dryRun = false }) => {
  const operations = [];

  if (applyProfileFirst) {
    operations.push({
      step: 'apply-profile',
      ...(applyProfile({ profile, dryRun })),
    });
  }

  const plan = buildManagedServicePlan(process.env);

  if (plan.litellm) {
    operations.push({
      step: 'start-litellm-sidecar',
      ...(await ensureCommandStart({
        id: 'litellm-sidecar',
        scriptName: 'docker:local:infra:up',
        probe: probeLiteLlm,
        dryRun,
      })),
    });
  }

  if (plan.n8n) {
    operations.push({
      step: 'start-n8n-local',
      ...(await ensureCommandStart({
        id: 'n8n-local',
        scriptName: 'n8n:local:start',
        probe: async () => {
          const status = await resolveN8nLocalStatus({ baseUrl: compact(process.env.N8N_BASE_URL || 'http://127.0.0.1:5678') });
          return {
            reachable: status.reachable,
            status: status.healthzStatus || status.workflowApiStatus || 0,
          };
        },
        dryRun,
      })),
    });
  }

  if (plan.opencodeWorker) {
    operations.push({
      step: 'start-opencode-worker',
      ...(await ensureDetachedNodeScript({
        id: 'opencode-worker',
        scriptRelativePath: path.join('scripts', 'opencode-local-worker.mjs'),
        probe: probeWorker,
        dryRun,
      })),
    });
  }

  if (plan.openjarvis) {
    operations.push({
      step: 'start-openjarvis-serve',
      ...(await ensureDetachedNodeScript({
        id: 'openjarvis-serve',
        scriptRelativePath: path.join('scripts', 'start-openjarvis-serve.mjs'),
        probe: probeOpenJarvis,
        attempts: 24,
        delayMs: 2_500,
        preflight: async () => {
          const apiKey = compact(process.env.OPENJARVIS_API_KEY || process.env.OPENJARVIS_SERVE_API_KEY || '');
          if (!apiKey) {
            return { ok: false, error: 'OPENJARVIS_SERVE_API_KEY or OPENJARVIS_API_KEY is required before auto-starting local OpenJarvis.' };
          }
          const jarvisAvailable = isJarvisCliAvailable();
          if (!jarvisAvailable) {
            return { ok: false, error: 'jarvis CLI is not available on PATH.' };
          }
          return { ok: true };
        },
        dryRun,
      })),
    });
  }

  const doctor = await buildDoctorReport({ profile });
  return {
    ok: dryRun ? operations.every((operation) => operation.ok !== false) : doctor.ok,
    action: 'up',
    profile,
    dryRun,
    operations,
    doctor,
    checkedAt: new Date().toISOString(),
  };
};

async function main() {
  if (fs.existsSync(REPO_ENV_PATH)) {
    hydrateProcessEnvFromFile(REPO_ENV_PATH);
  }

  const action = compact(parseArg('action', 'doctor')).toLowerCase() || 'doctor';
  const profile = compact(parseArg('profile', DEFAULT_PROFILE)) || DEFAULT_PROFILE;
  const applyProfileFirst = parseBool(parseArg('applyProfile', action === 'up' ? 'true' : 'false'), action === 'up');
  const dryRun = parseBool(parseArg('dryRun', 'false'), false);

  if (action === 'up') {
    const result = await runUp({ profile, applyProfileFirst, dryRun });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (action === 'doctor' || action === 'status') {
    if (applyProfileFirst) {
      const profileResult = applyProfile({ profile, dryRun });
      if (!profileResult.ok) {
        console.log(JSON.stringify({
          ok: false,
          action,
          error: 'PROFILE_APPLY_FAILED',
          profile: profileResult,
        }, null, 2));
        process.exitCode = 1;
        return;
      }
    }

    const report = await buildDoctorReport({ profile });
    console.log(JSON.stringify({
      ...report,
      action,
    }, null, 2));
    process.exitCode = action === 'doctor' && !report.ok ? 1 : 0;
    return;
  }

  console.error(JSON.stringify({
    ok: false,
    error: 'Unsupported --action. Use doctor, status, or up.',
  }, null, 2));
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileName) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}