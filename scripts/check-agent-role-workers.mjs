/* eslint-disable no-console */
const timeoutMs = Math.max(1000, Number(process.env.UNATTENDED_WORKER_HEALTH_TIMEOUT_MS || 5000));

const specs = [
  { id: 'local-orchestrator', url: String(process.env.MCP_COORDINATE_WORKER_URL || process.env.MCP_LOCAL_ORCHESTRATOR_WORKER_URL || '').trim() },
  { id: 'opendev', url: String(process.env.MCP_ARCHITECT_WORKER_URL || process.env.MCP_OPENDEV_WORKER_URL || '').trim() },
  { id: 'nemoclaw', url: String(process.env.MCP_REVIEW_WORKER_URL || process.env.MCP_NEMOCLAW_WORKER_URL || '').trim() },
  { id: 'openjarvis', url: String(process.env.MCP_OPERATE_WORKER_URL || process.env.MCP_OPENJARVIS_WORKER_URL || '').trim() },
];

const withTimeout = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

let hasFailure = false;
for (const spec of specs) {
  if (!spec.url) {
    console.log(`[role-worker-check] ${spec.id}: not configured`);
    continue;
  }
  const target = `${spec.url.replace(/\/+$/, '')}/health`;
  const result = await withTimeout(target);
  if (!result.ok) {
    hasFailure = true;
    console.log(`[role-worker-check] ${spec.id}: fail status=${result.status} error=${result.error || 'probe_failed'} url=${target}`);
    continue;
  }
  console.log(`[role-worker-check] ${spec.id}: ok status=${result.status} url=${target}`);
}

if (hasFailure) {
  process.exit(1);
}