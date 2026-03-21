type AgentRoleWorkerId = 'local-orchestrator' | 'opendev' | 'nemoclaw' | 'openjarvis';

export type AgentRoleWorkerSpec = {
  id: AgentRoleWorkerId;
  title: string;
  envKey: string;
  url: string;
  aliases?: string[];
  actionAliases?: string[];
};

export type AgentRoleWorkerHealth = {
  required: boolean;
  configured: boolean;
  reachable: boolean | null;
  latencyMs: number | null;
  status: number | null;
  endpoint: string | null;
  checkedAt: string;
  reason?: string;
  label: AgentRoleWorkerId;
};

export type HttpWorkerProbeResult = {
  ok: boolean;
  status: number;
  error?: string;
  endpoint: string;
  latencyMs: number;
};

const readFirstEnv = (...keys: string[]): string => {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
};

const AGENT_ROLE_WORKER_SPECS: AgentRoleWorkerSpec[] = [
  {
    id: 'local-orchestrator',
    title: 'Local Orchestrator worker',
    envKey: 'MCP_LOCAL_ORCHESTRATOR_WORKER_URL',
    url: readFirstEnv('MCP_COORDINATE_WORKER_URL', 'MCP_LOCAL_ORCHESTRATOR_WORKER_URL'),
    aliases: ['coordinate'],
    actionAliases: ['local.orchestrator.route', 'local.orchestrator.all', 'coordinate.route', 'coordinate.all'],
  },
  {
    id: 'opendev',
    title: 'OpenDev worker',
    envKey: 'MCP_OPENDEV_WORKER_URL',
    url: readFirstEnv('MCP_ARCHITECT_WORKER_URL', 'MCP_OPENDEV_WORKER_URL'),
    aliases: ['architect'],
    actionAliases: ['opendev.plan', 'architect.plan'],
  },
  {
    id: 'nemoclaw',
    title: 'NemoClaw worker',
    envKey: 'MCP_NEMOCLAW_WORKER_URL',
    url: readFirstEnv('MCP_REVIEW_WORKER_URL', 'MCP_NEMOCLAW_WORKER_URL'),
    aliases: ['review'],
    actionAliases: ['nemoclaw.review', 'review.review'],
  },
  {
    id: 'openjarvis',
    title: 'OpenJarvis worker',
    envKey: 'MCP_OPENJARVIS_WORKER_URL',
    url: readFirstEnv('MCP_OPERATE_WORKER_URL', 'MCP_OPENJARVIS_WORKER_URL'),
    aliases: ['operate', 'implement'],
    actionAliases: ['openjarvis.ops', 'operate.ops', 'implement.execute', 'tools.run.cli'],
  },
];

const withFetchTimeout = async (url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; error?: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

export const probeHttpWorkerHealth = async (workerUrl: string, timeoutMs: number): Promise<HttpWorkerProbeResult> => {
  const base = String(workerUrl || '').trim().replace(/\/+$/, '');
  const candidates = [base, `${base}/health`].filter(Boolean);
  const startedAt = Date.now();
  let lastResult: { ok: boolean; status: number; error?: string } = { ok: false, status: 0 };
  let lastEndpoint = base ? `${base}/health` : '';

  for (const target of candidates) {
    const result = await withFetchTimeout(target, timeoutMs);
    lastResult = result;
    lastEndpoint = target;
    if (result.ok) {
      return {
        ok: true,
        status: result.status,
        endpoint: target,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  return {
    ok: false,
    status: lastResult.status,
    error: lastResult.error || 'probe_failed',
    endpoint: lastEndpoint,
    latencyMs: Date.now() - startedAt,
  };
};

export const listAgentRoleWorkerSpecs = (): AgentRoleWorkerSpec[] => AGENT_ROLE_WORKER_SPECS.map((item) => ({ ...item }));

export const probeAgentRoleWorkerHealth = async (spec: AgentRoleWorkerSpec, timeoutMs: number): Promise<AgentRoleWorkerHealth> => {
  const timestamp = new Date().toISOString();
  if (!spec.url) {
    return {
      required: false,
      configured: false,
      reachable: false,
      latencyMs: null,
      status: null,
      endpoint: null,
      checkedAt: timestamp,
      reason: 'worker_url_missing',
      label: spec.id,
    };
  }

  const health = await probeHttpWorkerHealth(spec.url, timeoutMs);

  return {
    required: false,
    configured: true,
    reachable: health.ok,
    latencyMs: health.latencyMs,
    status: health.status,
    endpoint: health.endpoint,
    checkedAt: timestamp,
    reason: health.ok ? undefined : health.error || 'probe_failed',
    label: spec.id,
  };
};

export const getAgentRoleWorkersHealthSnapshot = async (timeoutMs = Math.max(1000, Number(process.env.UNATTENDED_WORKER_HEALTH_TIMEOUT_MS || 5000))) => {
  const entries = await Promise.all(listAgentRoleWorkerSpecs().map(async (spec) => [
    spec.id,
    await probeAgentRoleWorkerHealth(spec, timeoutMs),
  ] as const));
  return Object.fromEntries(entries) as Record<AgentRoleWorkerId, AgentRoleWorkerHealth>;
};