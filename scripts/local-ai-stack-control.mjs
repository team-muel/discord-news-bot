import 'dotenv/config';

/* eslint-disable no-console */
import fs from 'node:fs';
import os from 'node:os';
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

const resolveCommandPath = (commandName) => {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'where', commandName], {
      encoding: 'utf8',
      windowsHide: true,
    })
    : spawnSync('which', [commandName], {
      encoding: 'utf8',
      windowsHide: true,
    });

  const lines = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean);

  return {
    available: result.status === 0 && lines.length > 0,
    path: lines[0] || null,
  };
};

const runCommandCapture = (command, args, { cwd = ROOT, env = process.env, timeoutMs = 20_000 } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
  });

  return {
    ok: result.status === 0,
    status: typeof result.status === 'number' ? result.status : -1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error instanceof Error ? result.error.message : (result.error ? String(result.error) : null),
  };
};

const runCliCommand = (commandName, args, options = {}) => {
  if (process.platform === 'win32') {
    return runCommandCapture(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandName, ...args], options);
  }
  return runCommandCapture(commandName, args, options);
};

const runRepoScriptSync = ({ scriptRelativePath, args = [], useDotenv = false, useTsx = false, timeoutMs = 20_000 }) => {
  const nodeArgs = [];
  if (useDotenv) {
    nodeArgs.push('--import', 'dotenv/config');
  }
  if (useTsx) {
    nodeArgs.push('--import', 'tsx');
  }
  nodeArgs.push(path.join(ROOT, scriptRelativePath), ...args);
  return runCommandCapture(process.execPath, nodeArgs, { timeoutMs });
};

const parseCommandJsonOutput = (capture, fallback = null) => {
  return parseEmbeddedJsonPayload([capture.stdout, capture.stderr].filter(Boolean).join('\n'), fallback);
};

const buildCommandPreview = (capture, maxLength = 240) => {
  return [capture.stdout, capture.stderr, capture.error]
    .filter(Boolean)
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength) || null;
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

const toControlPlaneStatus = ({ ready = false, available = false }) => {
  if (ready) {
    return 'ready';
  }
  if (available) {
    return 'partial';
  }
  return 'blocked';
};

const probeMulticaControlPlane = () => {
  const cli = resolveCommandPath('multica');
  const playbookPath = path.join('docs', 'planning', 'MULTICA_CONTROL_PLANE_PLAYBOOK.md').replace(/\\/g, '/');
  const playbookExists = fs.existsSync(path.join(ROOT, playbookPath));
  const help = cli.available
    ? runCliCommand('multica', ['--help'], { timeoutMs: 10_000 })
    : null;
  const ready = cli.available && playbookExists;
  const blockers = [];
  const nextSteps = [];

  if (!playbookExists) {
    blockers.push('The Multica playbook is missing from the repository.');
  }
  if (!cli.available) {
    blockers.push('multica CLI is not available on PATH.');
    nextSteps.push('repair the local multica PATH or shim before relying on issue routing');
  }

  return {
    surface: 'multica',
    integrationLevel: 'coordination-plane-only',
    cliAvailable: cli.available,
    cliPath: cli.path,
    helpOk: help?.ok ?? false,
    outputPreview: help ? buildCommandPreview(help) : null,
    playbookExists,
    playbookPath,
    status: toControlPlaneStatus({ ready, available: cli.available || playbookExists }),
    blockers,
    nextSteps: ensureUniqueSteps(nextSteps),
  };
};

const probeHermesControlPlane = () => {
  const cli = resolveCommandPath('hermes');
  const hermesRoot = path.join(os.homedir(), '.hermes');
  const configPath = path.join(hermesRoot, 'config.yaml');
  const envPath = path.join(hermesRoot, '.env');
  const quickCheck = cli.available
    ? runCliCommand('hermes', ['chat', '-q', 'Reply with only OK', '-Q'], { timeoutMs: 25_000 })
    : null;
  const quickCheckOk = Boolean(
    quickCheck
    && quickCheck.ok
    && quickCheck.stdout.split(/\r?\n/).some((line) => compact(line) === 'OK'),
  );
  const blockers = [];
  const nextSteps = [];

  if (!cli.available) {
    blockers.push('hermes CLI is not available on PATH.');
    nextSteps.push('repair the hermes PATH or shim before depending on the local continuity lane');
  }
  if (cli.available && !quickCheckOk) {
    blockers.push('Hermes quick chat check did not return a clean OK response.');
    nextSteps.push('run hermes doctor to inspect provider auth and model endpoint issues');
    nextSteps.push('repair the Hermes auth or model endpoint until hermes chat -q Reply with only OK -Q succeeds');
  }

  return {
    surface: 'hermes',
    integrationLevel: 'bounded-local-continuity',
    cliAvailable: cli.available,
    cliPath: cli.path,
    configExists: fs.existsSync(configPath),
    envExists: fs.existsSync(envPath),
    quickCheck: {
      attempted: Boolean(quickCheck),
      ok: quickCheckOk,
      status: quickCheck?.status ?? null,
      preview: quickCheck ? buildCommandPreview(quickCheck) : null,
    },
    status: toControlPlaneStatus({ ready: quickCheckOk, available: cli.available }),
    blockers,
    nextSteps: ensureUniqueSteps(nextSteps),
  };
};

const probeVsCodeCopilotControlPlane = () => {
  const cli = resolveCommandPath('code');
  const bridgeCapture = runRepoScriptSync({
    scriptRelativePath: path.join('scripts', 'run-hermes-vscode-bridge.ts'),
    args: ['--status=true'],
    useTsx: true,
    timeoutMs: 20_000,
  });
  const bridge = parseCommandJsonOutput(bridgeCapture, null);
  const allowedActions = Array.isArray(bridge?.allowedActions) ? bridge.allowedActions.map((entry) => compact(entry)) : [];
  const chatAllowed = allowedActions.includes('chat');
  const bridgeConfigured = bridge?.configured === true;
  const packetExists = bridge?.packetExists === true;
  const ready = bridgeConfigured && chatAllowed && packetExists;
  const blockers = [];
  const nextSteps = [];

  if (!cli.available && bridge?.codeCliExists !== true) {
    blockers.push('VS Code CLI is not available on PATH.');
    nextSteps.push('repair the VS Code CLI install before relying on code chat relaunch');
  }
  if (!bridgeConfigured) {
    blockers.push('Hermes VS Code bridge is not configured.');
    nextSteps.push('run npm run hermes:vscode:bridge:status and repair the bridge before treating Copilot chat as a relay surface');
  }
  if (bridgeConfigured && !chatAllowed) {
    blockers.push('The Hermes VS Code bridge is configured but does not expose the chat action.');
    nextSteps.push('restore the bounded code chat allowlist before using VS Code chat relaunch');
  }
  if (bridgeConfigured && !packetExists) {
    blockers.push('The Hermes VS Code bridge packet path is missing.');
    nextSteps.push('restore the active Obsidian packet before launching the next bounded Copilot chat');
  }

  return {
    surface: 'vscode-copilot',
    integrationLevel: 'bounded-code-chat-relay',
    codeCliAvailable: cli.available || bridge?.codeCliExists === true,
    codeCliPath: compact(bridge?.codeCliPath || cli.path) || null,
    bridgeConfigured,
    packetExists,
    chatAllowed,
    allowedActions,
    outputPreview: bridgeCapture.ok ? null : buildCommandPreview(bridgeCapture),
    status: toControlPlaneStatus({ ready, available: bridgeConfigured || cli.available }),
    blockers,
    nextSteps: ensureUniqueSteps(nextSteps),
  };
};

const loadOpenJarvisGoalStatus = () => {
  const capture = runRepoScriptSync({
    scriptRelativePath: path.join('scripts', 'run-openjarvis-goal-cycle.mjs'),
    args: ['--status=true'],
    timeoutMs: 40_000,
  });
  const payload = parseCommandJsonOutput(capture, null);
  return { capture, payload };
};

const probeOpenJarvisControlPlane = () => {
  const { capture, payload } = loadOpenJarvisGoalStatus();
  const surfaceAvailable = Boolean(capture.ok && payload?.ok);
  const hermesRuntime = payload?.hermes_runtime && typeof payload.hermes_runtime === 'object'
    ? payload.hermes_runtime
    : {};
  const supervisor = payload?.supervisor && typeof payload.supervisor === 'object'
    ? payload.supervisor
    : {};
  const workflow = payload?.workflow && typeof payload.workflow === 'object'
    ? payload.workflow
    : {};
  const workflowStatus = compact(workflow.status || '').toLowerCase();
  const queueEnabled = hermesRuntime.queue_enabled === true;
  const supervisorAlive = hermesRuntime.supervisor_alive === true;
  const autoLaunchQueuedChat = supervisor.auto_launch_queued_chat === true;
  const autoLaunchQueuedSwarm = supervisor.auto_launch_queued_swarm === true;
  const queueLaunchMode = autoLaunchQueuedSwarm ? 'swarm' : (autoLaunchQueuedChat ? 'chat' : 'manual');
  const queueChatModeDrift = queueEnabled && supervisorAlive && queueLaunchMode === 'manual';
  const ready = surfaceAvailable
    && compact(hermesRuntime.readiness || '').toLowerCase() === 'ready'
    && !queueChatModeDrift;
  const blockers = [];
  const nextSteps = [];

  if (!surfaceAvailable) {
    blockers.push('OpenJarvis goal status did not return a healthy control-plane payload.');
    nextSteps.push('run npm run openjarvis:goal:status and repair the OpenJarvis control surface before widening the automation lane');
  }

  for (const blocker of Array.isArray(hermesRuntime.blockers) ? hermesRuntime.blockers.slice(0, 4) : []) {
    const text = compact(blocker);
    if (text) {
      blockers.push(text);
    }
  }

  for (const action of Array.isArray(hermesRuntime.next_actions) ? hermesRuntime.next_actions.slice(0, 4) : []) {
    const text = compact(action);
    if (text) {
      nextSteps.push(text);
    }
  }

  if (queueChatModeDrift) {
    blockers.push('The live Hermes supervisor is running without a queue-aware GPT relaunch mode, so the next bounded Copilot handoff would stop short of queue-aware relaunch.');
    nextSteps.push(workflowStatus === 'executing'
      ? 'let the active workflow reach a safe boundary, then restart the detached local autonomy supervisor so Hermes comes back in queue-aware relaunch mode'
      : 'run npm run local:autonomy:supervisor:restart so the next Hermes supervisor comes back with an explicit queue launch mode');
  }

  return {
    surface: 'openjarvis',
    integrationLevel: 'runtime-control-and-hot-state',
    surfaceAvailable,
    workflowStatus: workflowStatus || null,
    objective: compact(workflow.objective || '') || null,
    routeMode: compact(workflow.route_mode || '') || null,
    hermesReadiness: compact(hermesRuntime.readiness || '') || null,
    supervisorAlive,
    queueEnabled,
    autoLaunchQueuedChat,
    autoLaunchQueuedSwarm,
    queueLaunchMode,
    queueChatModeDrift,
    queuedObjectivesAvailable: hermesRuntime.queued_objectives_available === true,
    awaitingReentryAcknowledgment: hermesRuntime.awaiting_reentry_acknowledgment === true,
    ideHandoffObserved: hermesRuntime.ide_handoff_observed === true,
    autonomousGoalCandidates: Array.isArray(payload?.autonomous_goal_candidates)
      ? payload.autonomous_goal_candidates
        .map((entry) => compact(entry?.objective))
        .filter(Boolean)
      : [],
    outputPreview: surfaceAvailable ? null : buildCommandPreview(capture),
    status: toControlPlaneStatus({ ready, available: surfaceAvailable }),
    blockers: ensureUniqueSteps(blockers),
    nextSteps: ensureUniqueSteps(nextSteps),
  };
};

const probeLocalAutonomySupervisor = () => {
  const capture = runRepoScriptSync({
    scriptRelativePath: path.join('scripts', 'run-local-autonomy-supervisor.ts'),
    args: ['--status=true'],
    useDotenv: true,
    useTsx: true,
    timeoutMs: 30_000,
  });
  const payload = parseCommandJsonOutput(capture, null);
  const available = Boolean(capture.ok && payload?.ok);
  const running = payload?.running === true;
  const driftDetected = payload?.code?.driftDetected === true;
  const restartRecommended = payload?.code?.restartRecommended === true;
  const blockers = [];
  const nextSteps = [];

  if (!available) {
    blockers.push('Local autonomy supervisor status is unavailable.');
    nextSteps.push('run npm run local:autonomy:supervisor:status and repair the detached self-heal loop before trusting the local control plane');
  } else if (!running) {
    blockers.push('Detached local autonomy supervisor is not running.');
    nextSteps.push('run npm run local:autonomy:supervisor:restart to restore the detached self-heal loop');
  }

  if (driftDetected || restartRecommended) {
    blockers.push('Detached local autonomy supervisor reports code drift or restart recommendation.');
    nextSteps.push('restart the detached local autonomy supervisor so it matches the current repo code');
  }

  return {
    surface: 'local-autonomy',
    integrationLevel: 'detached-self-heal-loop',
    available,
    running,
    driftDetected,
    restartRecommended,
    lastSummary: compact(payload?.lastStatus?.summary || '') || null,
    outputPreview: available ? null : buildCommandPreview(capture),
    status: toControlPlaneStatus({ ready: available && running && !restartRecommended, available }),
    blockers: ensureUniqueSteps(blockers),
    nextSteps: ensureUniqueSteps(nextSteps),
  };
};

export const buildControlPlaneExecutionPlan = ({ multica, hermes, vscodeCopilot, openjarvis, localAutonomy }) => {
  const surfaces = [multica, hermes, vscodeCopilot, openjarvis, localAutonomy].filter(Boolean);
  const readySurfaces = surfaces.filter((surface) => surface.status === 'ready').map((surface) => surface.surface);
  const partialSurfaces = surfaces.filter((surface) => surface.status === 'partial').map((surface) => surface.surface);
  const blockedSurfaces = surfaces.filter((surface) => surface.status === 'blocked').map((surface) => surface.surface);
  const currentPosture = blockedSurfaces.length > 0
    ? 'blocked'
    : partialSurfaces.length > 0
      ? 'needs-activation'
      : 'ready';

  return {
    objective: 'Activate one visible local control plane across Multica, Hermes, VS Code Copilot relay, and OpenJarvis runtime surfaces.',
    currentPosture,
    readySurfaces,
    partialSurfaces,
    blockedSurfaces,
    recommendedCommands: ensureUniqueSteps([
      'npm run local:control-plane:doctor',
      currentPosture !== 'ready' ? 'npm run local:control-plane:up' : null,
      hermes.status !== 'ready' ? 'hermes chat -q "Reply with only OK" -Q' : null,
      vscodeCopilot.status !== 'ready' ? 'npm run hermes:vscode:bridge:status' : null,
      openjarvis.status !== 'ready' ? 'npm run openjarvis:goal:status' : null,
      localAutonomy.status !== 'ready' ? 'npm run local:autonomy:supervisor:restart' : null,
    ]),
    phases: [
      {
        phaseId: 'coordination',
        title: 'Multica coordination visibility',
        status: multica.status,
        owner: 'multica',
        entryCriteria: [
          'Multica playbook is present in the repository.',
          'multica CLI is reachable on the local workstation.',
        ],
        steps: ensureUniqueSteps([
          'keep Multica as the visible coordination plane only',
          ...multica.nextSteps,
        ]),
        exitCriteria: [
          'Multica CLI responds locally.',
          'Operator uses Multica for issue routing and lane assignment, not as hot-state or semantic owner.',
        ],
      },
      {
        phaseId: 'continuity',
        title: 'Hermes bounded local continuity',
        status: hermes.status,
        owner: 'hermes',
        entryCriteria: [
          'Hermes CLI is on PATH.',
          'Hermes config and env files exist locally.',
        ],
        steps: ensureUniqueSteps([
          'keep Hermes on bounded local execution and continuity work',
          ...hermes.nextSteps,
        ]),
        exitCriteria: [
          'Hermes quick chat check returns a clean OK.',
          'Hermes is safe to use as the local continuity lane behind GPT.',
        ],
      },
      {
        phaseId: 'ide-relay',
        title: 'VS Code Copilot relay',
        status: vscodeCopilot.status,
        owner: 'vscode-copilot',
        entryCriteria: [
          'VS Code CLI is installed.',
          'Hermes VS Code bridge is configured.',
        ],
        steps: ensureUniqueSteps([
          'treat code chat as a bounded relay surface, not a state owner',
          ...vscodeCopilot.nextSteps,
        ]),
        exitCriteria: [
          'Bridge exposes the chat action.',
          'Active packet exists so the next bounded chat can be relaunched.',
        ],
      },
      {
        phaseId: 'runtime-loop',
        title: 'OpenJarvis runtime and detached self-heal loop',
        status: (openjarvis.status === 'ready' && localAutonomy.status === 'ready') ? 'ready' : (openjarvis.status === 'blocked' ? 'blocked' : 'partial'),
        owner: 'openjarvis',
        entryCriteria: [
          'OpenJarvis goal status returns a valid control-plane payload.',
          'Detached local autonomy supervisor is available to keep Hermes attached.',
        ],
        steps: ensureUniqueSteps([
          'use OpenJarvis status as the runtime truth surface for the local control plane',
          ...openjarvis.nextSteps,
          ...localAutonomy.nextSteps,
        ]),
        exitCriteria: [
          'OpenJarvis status is readable and Hermes runtime is no worse than partial.',
          'Detached local autonomy supervisor is running and restart-safe.',
        ],
      },
    ],
  };
};

const SESSION_SYNTHESIS_WORKSTATION_PATTERNS = [
  /\b(gui|browser|window|desktop|screenshot|screen shot|click|ui|dashboard|obsidian app|capture)\b/i,
  /(브라우저|화면|창|데스크톱|스크린샷|클릭|대시보드|앱|캡처|UI|GUI)/,
];

const SESSION_SYNTHESIS_REMOTE_PATTERNS = [
  /\b(gcp|render|deploy|remote|worker|server|benchmark|load test|container|docker|vm|cloud|migration)\b/i,
  /(원격|배포|워커|서버|벤치|부하|컨테이너|도커|클라우드|마이그레이션|GCP|Render)/,
];

const SESSION_SYNTHESIS_DISTILLER_PATTERNS = [
  /\b(changelog|docs?|runbook|playbook|decision|retro|wiki|obsidian|distill|handoff|closeout)\b/i,
  /(문서|런북|플레이북|결정|회고|위키|옵시디언|정리|요약|핸드오프|클로즈아웃)/,
];

const matchesSessionSynthesisPattern = (value, patterns) => patterns.some((pattern) => pattern.test(String(value || '')));

const resolveFutureSessionExecutionLane = ({ objectiveText, currentPhase, plannedQueueLaunchMode }) => {
  const wantsWorkstation = matchesSessionSynthesisPattern(objectiveText, SESSION_SYNTHESIS_WORKSTATION_PATTERNS);
  const wantsRemote = matchesSessionSynthesisPattern(objectiveText, SESSION_SYNTHESIS_REMOTE_PATTERNS);

  if (currentPhase === 'close-open-gpt-turn') {
    return {
      primaryAssetId: 'hermes-local-operator',
      supportAssetIds: [],
      rationale: 'Reentry closeout stays on the local Hermes operator lane so the hot-state boundary closes before any new launch.',
      wantsWorkstation,
      wantsRemote,
    };
  }

  if (wantsWorkstation) {
    return {
      primaryAssetId: 'local-workstation-executor',
      supportAssetIds: ['hermes-local-operator'],
      rationale: 'The objective mentions browser, UI, or desktop evidence, so the workstation executor lane should stay explicit.',
      wantsWorkstation,
      wantsRemote,
    };
  }

  if (wantsRemote) {
    return {
      primaryAssetId: 'remote-heavy-execution',
      supportAssetIds: ['hermes-local-operator'],
      rationale: 'The objective mentions deploy, remote, or heavy worker scope, so the remote execution lane should stay explicit.',
      wantsWorkstation,
      wantsRemote,
    };
  }

  return {
    primaryAssetId: 'hermes-local-operator',
    supportAssetIds: [],
    rationale: plannedQueueLaunchMode === 'swarm'
      ? 'No GUI or remote signal is explicit, so scouting and bounded execution stay on the local Hermes operator lane.'
      : 'No GUI or remote signal is explicit, so the bounded turn stays on the local Hermes operator lane.',
    wantsWorkstation,
    wantsRemote,
  };
};

const buildFutureSessionChildTurns = ({ sessionKind, launchObjective, executionLane, includeDistiller }) => {
  if (!launchObjective) {
    return [];
  }

  const executorArtifactBudget = executionLane.primaryAssetId === 'local-workstation-executor'
    ? ['ui evidence', 'bounded repo change', 'targeted verification']
    : executionLane.primaryAssetId === 'remote-heavy-execution'
      ? ['remote worker artifact', 'bounded repo change', 'targeted verification']
      : ['bounded repo change', 'targeted verification'];

  if (sessionKind === 'bounded-wave') {
    return [
      {
        workerId: 'route-scout',
        ownerSurface: 'vscode-copilot',
        contextProfile: 'scout',
        assetId: 'hermes-local-operator',
        objective: `Map route, blockers, and evidence for ${launchObjective}`,
        artifactBudget: ['route summary', 'shared contract references', 'rollback boundary'],
        recallCondition: 'Recall the coordinator if the route crosses a policy boundary or the contract surface is still ambiguous.',
      },
      {
        workerId: 'bounded-executor',
        ownerSurface: 'vscode-copilot',
        contextProfile: executionLane.primaryAssetId === 'remote-heavy-execution'
          ? 'executor-remote'
          : executionLane.primaryAssetId === 'local-workstation-executor'
            ? 'executor-workstation'
            : 'executor',
        assetId: executionLane.primaryAssetId,
        objective: launchObjective,
        artifactBudget: executorArtifactBudget,
        recallCondition: 'Recall the coordinator if the shard widens past the bounded objective, worktree, or policy envelope.',
      },
      ...(includeDistiller
        ? [{
            workerId: 'closeout-distiller',
            ownerSurface: 'vscode-copilot',
            contextProfile: 'distiller',
            assetId: 'hermes-local-operator',
            objective: `Distill accepted outcomes for ${launchObjective}`,
            artifactBudget: ['decision distillate', 'doc or wiki delta', 'next bounded action'],
            recallCondition: 'Start only after the executor reaches an accepted checkpoint; recall if acceptance is still disputed.',
          }]
        : []),
    ];
  }

  if (sessionKind === 'bounded-turn') {
    return [{
      workerId: 'bounded-turn',
      ownerSurface: 'vscode-copilot',
      contextProfile: executionLane.primaryAssetId === 'remote-heavy-execution'
        ? 'executor-remote'
        : executionLane.primaryAssetId === 'local-workstation-executor'
          ? 'executor-workstation'
          : 'delegated-operator',
      assetId: executionLane.primaryAssetId,
      objective: launchObjective,
      artifactBudget: executorArtifactBudget,
      recallCondition: 'Recall the coordinator if the turn stops being one bounded handoff with one explicit closeout boundary.',
    }];
  }

  return [];
};

const buildFutureSessionSynthesis = ({ currentPhase, currentObjective, queuedCandidates, openjarvis, queuedLaunchCommand }) => {
  const observedQueueLaunchMode = compact(openjarvis.queueLaunchMode || '') || 'manual';
  const plannedQueueLaunchMode = currentPhase === 'launch-next-bounded-wave'
    ? 'swarm'
    : currentPhase === 'launch-next-bounded-turn'
      ? 'chat'
      : observedQueueLaunchMode;
  const launchObjective = currentObjective || queuedCandidates[0] || null;
  const objectiveText = [currentObjective, ...queuedCandidates].filter(Boolean).join(' ');
  const sessionKind = currentPhase === 'launch-next-bounded-wave'
    ? 'bounded-wave'
    : currentPhase === 'launch-next-bounded-turn'
      ? 'bounded-turn'
      : currentPhase === 'close-open-gpt-turn'
        ? 'closeout'
        : currentPhase === 'seed-next-bounded-objective'
          ? 'queue-seed'
          : currentPhase === 'stabilize-control-plane'
            ? 'stabilize'
            : 'monitor';
  const activationState = currentPhase === 'launch-next-bounded-wave' || currentPhase === 'launch-next-bounded-turn'
    ? 'launch-now'
    : currentPhase === 'seed-next-bounded-objective'
      ? 'queue-first'
      : currentPhase === 'close-open-gpt-turn'
        ? 'closeout-boundary'
        : currentPhase === 'stabilize-control-plane'
          ? 'stabilize'
          : 'hold';
  const includeDistiller = sessionKind === 'bounded-wave'
    || currentPhase === 'close-open-gpt-turn'
    || matchesSessionSynthesisPattern(objectiveText, SESSION_SYNTHESIS_DISTILLER_PATTERNS);
  const executionLane = resolveFutureSessionExecutionLane({
    objectiveText,
    currentPhase,
    plannedQueueLaunchMode,
  });
  const childTurns = buildFutureSessionChildTurns({
    sessionKind,
    launchObjective,
    executionLane,
    includeDistiller,
  });

  return {
    sessionKind,
    activationState,
    observedQueueLaunchMode,
    plannedQueueLaunchMode,
    launchObjective,
    coordinator: {
      ownerSurface: 'openjarvis',
      mutableStateOwner: 'supabase-hot-state',
      preflightCommand: 'npm run local:control-plane:status',
      queueCommand: 'npm run openjarvis:hermes:runtime:queue-objective:auto',
      launchCommand: sessionKind === 'bounded-wave' || sessionKind === 'bounded-turn' ? queuedLaunchCommand : null,
      closeoutCommand: 'npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed --summary="<one line outcome>" --nextAction="<next bounded step or wait boundary>"',
      rationale: 'OpenJarvis keeps queue selection, restart-safe mutable state, and the explicit reentry boundary.',
    },
    visibilitySurface: {
      ownerSurface: 'multica',
      recommendedLaneShape: sessionKind === 'bounded-wave'
        ? 'keep one parent objective plus one child lane per bounded worker shard'
        : sessionKind === 'bounded-turn'
          ? 'keep one parent objective plus one bounded GPT handoff child lane'
          : 'keep the current parent objective visible until the next safe boundary is ready',
    },
    reasoningSurface: {
      ownerSurface: 'vscode-copilot',
      surfaceMode: sessionKind === 'bounded-wave'
        ? 'swarm'
        : sessionKind === 'bounded-turn'
          ? 'chat'
          : sessionKind === 'closeout'
            ? 'reentry-boundary'
            : 'hold',
      activationState,
      launchCommand: sessionKind === 'bounded-wave' || sessionKind === 'bounded-turn' ? queuedLaunchCommand : null,
      reentryRequired: sessionKind === 'bounded-wave' || sessionKind === 'bounded-turn' || currentPhase === 'close-open-gpt-turn',
    },
    executionLane: {
      primaryAssetId: executionLane.primaryAssetId,
      supportAssetIds: executionLane.supportAssetIds,
      rationale: executionLane.rationale,
    },
    childTurns,
  };
};

export const buildFutureControlPlanePlan = ({ controlPlaneReport }) => {
  const report = controlPlaneReport || {};
  const multica = report.multica || {};
  const hermes = report.hermes || {};
  const vscodeCopilot = report.vscodeCopilot || {};
  const openjarvis = report.openjarvis || {};
  const localAutonomy = report.localAutonomy || {};

  const currentObjective = compact(openjarvis.objective || '') || null;
  const queuedCandidates = Array.isArray(openjarvis.autonomousGoalCandidates)
    ? openjarvis.autonomousGoalCandidates.filter(Boolean)
    : [];
  const queuedLaunchCommand = openjarvis.queueLaunchMode === 'swarm'
    ? 'npm run openjarvis:autopilot:queue:swarm'
    : 'npm run openjarvis:autopilot:queue:chat';

  let currentPhase = 'stabilize-control-plane';
  const reasoning = [];
  const commands = ['npm run local:control-plane:status'];

  const workflowActive = openjarvis.workflowStatus === 'executing';

  if (openjarvis.awaitingReentryAcknowledgment) {
    currentPhase = 'close-open-gpt-turn';
    reasoning.push('A queued GPT handoff is already in progress, so the next safe step is the reentry acknowledgment boundary.');
    commands.push('npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed --summary="<one line outcome>" --nextAction="<next bounded step or wait boundary>"');
    commands.push('npm run openjarvis:packets:sync');
  } else if (workflowActive) {
    currentPhase = 'monitor-active-workflow';
    reasoning.push('The current workflow is still executing, so the next safe action is to observe the live lane instead of forcing another bounded Copilot relaunch.');
    commands.push('npm run openjarvis:goal:status');
    commands.push('npm run openjarvis:packets:sync');
    if (openjarvis.queueChatModeDrift) {
      reasoning.push('The current Hermes supervisor is not armed for queue-aware relaunch, so the next safe boundary should restart it into an explicit queue launch mode before the following cycle.');
      commands.push('npm run local:autonomy:supervisor:restart');
    }
  } else if (!report.ok) {
    currentPhase = 'stabilize-control-plane';
    reasoning.push('One or more control-plane surfaces are still degraded, so future automation should not widen scope yet.');
    commands.push('npm run local:control-plane:up');
  } else if (openjarvis.status === 'ready' && openjarvis.queuedObjectivesAvailable) {
    currentPhase = openjarvis.queueLaunchMode === 'swarm' ? 'launch-next-bounded-wave' : 'launch-next-bounded-turn';
    reasoning.push(openjarvis.queueLaunchMode === 'swarm'
      ? 'The local runtime is healthy and a bounded queued objective is already available for the next GPT swarm wave.'
      : 'The local runtime is healthy and a bounded queued objective is already available for the next GPT relaunch.');
    commands.push(queuedLaunchCommand);
  } else if (queuedCandidates.length > 0) {
    currentPhase = 'seed-next-bounded-objective';
    reasoning.push('A future bounded objective is visible but not yet promoted into the safe queue.');
    commands.push('npm run openjarvis:hermes:runtime:queue-objective:auto');
  } else {
    currentPhase = 'monitor-active-workflow';
    reasoning.push('The runtime is healthy, but there is no new bounded turn to launch yet. Stay on status, queue health, and durable promotion.');
    commands.push('npm run openjarvis:goal:status');
  }

  const checkpoints = [
    {
      checkpointId: 'gate',
      when: 'before every new bounded turn',
      command: 'npm run local:control-plane:doctor',
      doneWhen: 'Multica, Hermes, VS Code Copilot relay, OpenJarvis runtime, and the detached self-heal loop are not unexpectedly degraded.',
    },
    {
      checkpointId: 'queue',
      when: 'when the active queue is empty or stale',
      command: 'npm run openjarvis:hermes:runtime:queue-objective:auto',
      doneWhen: 'A single bounded next objective is visible in the safe queue or the runtime reports that no bounded candidate exists yet.',
    },
    {
      checkpointId: 'launch',
      when: 'when the queue is ready and a new GPT handoff is actually needed',
      command: queuedLaunchCommand,
      doneWhen: openjarvis.queueLaunchMode === 'swarm'
        ? 'The next bounded VS Code Copilot swarm wave is launched without widening scope beyond the queued objective.'
        : 'The next bounded VS Code Copilot chat turn is launched without widening scope beyond the queued objective.',
    },
    {
      checkpointId: 'closeout',
      when: 'immediately after the GPT handoff settles',
      command: 'npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed --summary="<one line outcome>" --nextAction="<next bounded step or wait boundary>"',
      doneWhen: 'The queue-aware supervisor can observe the GPT closeout through hot-state instead of waiting on implicit chat history.',
    },
    {
      checkpointId: 'packets',
      when: 'while monitoring an active workflow or right after closeout',
      command: 'npm run openjarvis:packets:sync',
      doneWhen: 'The Obsidian-visible continuity packets reflect the latest active workflow state, handoff boundary, and detached watcher evidence.',
    },
    {
      checkpointId: 'durable-promotion',
      when: 'when the result changes runtime meaning or operator behavior',
      command: 'update repo-visible docs and promote durable meaning to shared Obsidian in the same change window',
      doneWhen: 'Multica remains coordination-only, Supabase remains hot-state, and durable meaning no longer lives only in issue text or chat residue.',
    },
  ];

  const sessionSynthesis = buildFutureSessionSynthesis({
    currentPhase,
    currentObjective,
    queuedCandidates,
    openjarvis,
    queuedLaunchCommand,
  });

  return {
    objective: 'Keep the local control plane running as a repeatable bounded-turn cycle instead of a one-off recovery action.',
    currentPhase,
    currentObjective,
    queuedCandidates,
    readiness: {
      multica: multica.status || 'unknown',
      hermes: hermes.status || 'unknown',
      vscodeCopilot: vscodeCopilot.status || 'unknown',
      openjarvis: openjarvis.status || 'unknown',
      localAutonomy: localAutonomy.status || 'unknown',
    },
    sessionSynthesis,
    reasoning,
    commands: ensureUniqueSteps(commands),
    checkpoints,
    guardrails: [
      'Do not treat Multica issue state, VS Code chat transport, or packet files as the canonical mutable state owner.',
      'Launch only one bounded queued GPT handoff at a time; do not widen scope just because the control plane is healthy.',
      'Every relaunched GPT handoff must close through reentry-ack so Hermes and OpenJarvis see an explicit hot-state boundary.',
      'Promote durable operator lessons into shared Obsidian or repo docs in the same change window instead of leaving them only in runtime residue.',
    ],
    doneWhen: [
      'The next bounded objective can be queued, launched, acknowledged, and handed back without manual state reconstruction.',
      'The detached local autonomy supervisor stays restart-safe across future repo edits.',
      'Future operator work starts from the control-plane doctor and compact runtime status rather than broad archaeology.',
    ],
  };
};

const buildControlPlaneReport = async ({ profile = DEFAULT_PROFILE } = {}) => {
  const multica = probeMulticaControlPlane();
  const hermes = probeHermesControlPlane();
  const vscodeCopilot = probeVsCodeCopilotControlPlane();
  const openjarvis = probeOpenJarvisControlPlane();
  const localAutonomy = probeLocalAutonomySupervisor();
  const activationPlan = buildControlPlaneExecutionPlan({
    multica,
    hermes,
    vscodeCopilot,
    openjarvis,
    localAutonomy,
  });

  return {
    ok: activationPlan.currentPosture === 'ready',
    checkedAt: new Date().toISOString(),
    profile,
    multica,
    hermes,
    vscodeCopilot,
    openjarvis,
    localAutonomy,
    activationPlan,
  };
};

const buildFutureControlPlaneReport = async ({ profile = DEFAULT_PROFILE } = {}) => {
  const controlPlane = await buildControlPlaneReport({ profile });
  const futureProcess = buildFutureControlPlanePlan({ controlPlaneReport: controlPlane });

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    profile,
    controlPlane,
    futureProcess,
  };
};

const ensureUniqueSteps = (steps) => [...new Set(steps.filter(Boolean))];

export const buildDoctorReport = async ({ profile = DEFAULT_PROFILE, controlPlane = false } = {}) => {
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

  const controlPlaneReport = controlPlane
    ? await buildControlPlaneReport({ profile })
    : null;
  const stackOk = failures.length === 0;

  return {
    ok: controlPlane ? Boolean(controlPlaneReport?.ok) : stackOk,
    stackOk,
    controlPlaneOk: controlPlane ? Boolean(controlPlaneReport?.ok) : null,
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
    controlPlane: controlPlaneReport,
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

export const runUp = async ({ profile = DEFAULT_PROFILE, applyProfileFirst = true, dryRun = false, controlPlane = false }) => {
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

  if (controlPlane) {
    operations.push({
      step: 'start-local-autonomy-supervisor',
      ...(await ensureCommandStart({
        id: 'local-autonomy-supervisor',
        scriptName: 'local:autonomy:supervisor',
        probe: async () => {
          const status = probeLocalAutonomySupervisor();
          return {
            reachable: status.available && status.running,
            status: status.available ? (status.running ? 200 : 503) : 0,
          };
        },
        dryRun,
      })),
    });
  }

  const doctor = await buildDoctorReport({ profile, controlPlane });
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
  const controlPlane = parseBool(parseArg('controlPlane', 'false'), false);

  if (action === 'up') {
    const result = await runUp({ profile, applyProfileFirst, dryRun, controlPlane });
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

    const report = await buildDoctorReport({ profile, controlPlane });
    console.log(JSON.stringify({
      ...report,
      action,
    }, null, 2));
    process.exitCode = action === 'doctor' && !report.ok ? 1 : 0;
    return;
  }

  if (action === 'future') {
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

    const report = await buildFutureControlPlaneReport({ profile });
    console.log(JSON.stringify({
      ...report,
      action,
    }, null, 2));
    process.exitCode = 0;
    return;
  }

  console.error(JSON.stringify({
    ok: false,
    error: 'Unsupported --action. Use doctor, status, future, or up.',
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