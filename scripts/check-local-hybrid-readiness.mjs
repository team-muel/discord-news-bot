/* eslint-disable no-console */
import 'dotenv/config';

const read = (key) => String(process.env[key] || '').trim();

const parseProviderList = (raw) => String(raw || '')
  .split(/[;,]/)
  .map((item) => String(item || '').trim().toLowerCase())
  .filter(Boolean);

const parseBool = (value, fallback = false) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const localFirst = (() => {
  const provider = read('AI_PROVIDER').toLowerCase();
  const baseOrder = parseProviderList(read('LLM_PROVIDER_BASE_ORDER'));
  return provider === 'ollama' || provider === 'local' || baseOrder[0] === 'ollama' || baseOrder[0] === 'local';
})();

const ollamaBaseUrl = read('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';
const ollamaModel = read('OLLAMA_MODEL') || read('LOCAL_LLM_MODEL');
const requireWorker = parseBool(read('OPENJARVIS_REQUIRE_OPENCODE_WORKER'), true);
const workerUrl = read('MCP_OPENCODE_WORKER_URL');
const workerRequireAuth = parseBool(read('OPENCODE_LOCAL_WORKER_REQUIRE_AUTH'), false);
const hasWorkerAuthToken = Boolean(
  read('MCP_WORKER_AUTH_TOKEN')
  || read('MCP_OPENCODE_WORKER_AUTH_TOKEN')
  || read('OPENCODE_LOCAL_WORKER_AUTH_TOKEN'),
);
const timeoutMs = Math.max(1000, Number(read('LOCAL_HYBRID_CHECK_TIMEOUT_MS') || 5000));

const timedFetch = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const failures = [];
const warnings = [];

const addFailure = (message) => failures.push(message);
const addWarning = (message) => warnings.push(message);

const checkOllama = async () => {
  if (!localFirst) {
    addWarning('local-first provider order is not active; Ollama probe skipped');
    return;
  }
  if (!ollamaModel) {
    addFailure('OLLAMA_MODEL or LOCAL_LLM_MODEL is required for local-first hybrid mode');
    return;
  }

  const tags = await timedFetch(`${ollamaBaseUrl.replace(/\/+$/, '')}/api/tags`);
  if (!tags.ok) {
    addFailure(`Ollama probe failed: ${tags.status || 'request-error'} ${tags.error || tags.body}`.trim());
    return;
  }

  try {
    const payload = JSON.parse(tags.body || '{}');
    const models = Array.isArray(payload.models) ? payload.models : [];
    const normalizedNames = new Set(models.map((item) => String(item?.name || '').trim().toLowerCase()));
    if (!normalizedNames.has(ollamaModel.toLowerCase())) {
      addWarning(`Ollama is reachable but model '${ollamaModel}' is not listed by /api/tags; run 'ollama pull ${ollamaModel}' if this model should be local-first`);
    }
  } catch {
    addWarning('Ollama /api/tags returned a non-JSON response; model presence was not verified');
  }
};

const checkWorker = async () => {
  if (!requireWorker) {
    addWarning('OPENJARVIS_REQUIRE_OPENCODE_WORKER=false; unattended autonomy isolation is relaxed');
    return;
  }
  if (!workerUrl) {
    addFailure('MCP_OPENCODE_WORKER_URL is required when OPENJARVIS_REQUIRE_OPENCODE_WORKER=true; set the real remote worker URL before enabling unattended autonomy');
    return;
  }

  const targets = [workerUrl, `${workerUrl.replace(/\/+$/, '')}/health`];
  let ok = false;
  for (const target of targets) {
    const response = await timedFetch(target);
    if (response.ok) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    addFailure('Remote worker probe failed for base URL and /health endpoint; verify MCP_OPENCODE_WORKER_URL and worker health before unattended runs');
  }

  if (!hasWorkerAuthToken) {
    addWarning('Remote worker is configured without MCP worker auth token; consider setting MCP_WORKER_AUTH_TOKEN (or MCP_OPENCODE_WORKER_AUTH_TOKEN) to reduce unauthenticated access risk');
  }
  if (workerRequireAuth && !hasWorkerAuthToken) {
    addFailure('OPENCODE_LOCAL_WORKER_REQUIRE_AUTH=true but worker auth token is missing; configure a shared token for worker and client');
  }
};

const checkFallback = () => {
  if (!localFirst) {
    return;
  }
  const hasFallback = Boolean(
    read('OPENCLAW_BASE_URL')
    || read('OPENCLAW_API_BASE_URL')
    || read('OPENCLAW_URL')
    || read('OPENAI_API_KEY')
    || read('ANTHROPIC_API_KEY')
    || read('CLAUDE_API_KEY')
    || read('GEMINI_API_KEY')
    || read('GOOGLE_API_KEY')
    || read('HF_TOKEN')
    || read('HF_API_KEY')
    || read('HUGGINGFACE_API_KEY'),
  );
  if (!hasFallback) {
    addWarning('No remote fallback provider is configured; local Ollama outage will fail sessions');
  }
};

const main = async () => {
  console.log(JSON.stringify({
    mode: 'local-first-hybrid-readiness',
    localFirst,
    requireWorker,
    ollamaBaseUrl,
    ollamaModel: ollamaModel || null,
    timeoutMs,
  }, null, 2));

  await checkOllama();
  await checkWorker();
  checkFallback();

  const report = {
    ok: failures.length === 0,
    failures,
    warnings,
    checkedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
};

main().catch((error) => {
  console.error('[local-hybrid-check] FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});