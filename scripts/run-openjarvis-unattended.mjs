import 'dotenv/config';
/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  beginWorkflowStep,
  createWorkflowSession,
  finishWorkflowStep,
  transitionWorkflow,
} from './openjarvis-workflow-state.mjs';
import { loadOpenjarvisRoutingPolicy } from './openjarvis-routing-policy.mjs';
import { parseArg, parseBool } from './lib/cliArgs.mjs';

const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');
const TMP_DIR = path.join(ROOT, 'tmp', 'autonomy');
const SUMMARY_PATH = path.join(TMP_DIR, 'openjarvis-unattended-last-run.json');
const CONTINUITY_PACKET_SYNC_SCRIPT = path.join(ROOT, 'scripts', 'sync-openjarvis-continuity-packets.ts');
const DRY_RUN_MISSING_SOURCE_ENV_DEFAULTS = Object.freeze({
  LLM_WEEKLY_REPORT_ALLOW_MISSING_SOURCE_TABLE: 'true',
  HYBRID_WEEKLY_REPORT_ALLOW_MISSING_SOURCE_REPORTS: 'true',
  AUTO_JUDGE_WEEKLY_ALLOW_MISSING_SOURCE_REPORTS: 'true',
  SELF_IMPROVEMENT_ALLOW_MISSING_SOURCE_SNAPSHOTS: 'true',
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const VALID_ROUTE_MODES = new Set(['auto', 'delivery', 'operations']);
const GCP_WORKER_HEALTH_STEP = Object.freeze({
  id: 'gcp-worker-cost-health',
  script: 'ops:gcp:report:weekly',
  scriptDry: 'ops:gcp:report:weekly',
  classification: 'discover',
  agentRole: 'openjarvis',
  handoffFrom: 'openjarvis',
  handoffTo: 'openjarvis',
  reason: 'capture canonical GCP worker health before deciding whether the unattended loop should keep investing in the remote always-on lane',
});

const normalizeRouteMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_ROUTE_MODES.has(mode) ? mode : 'auto';
};

const inferRouteMode = (params) => {
  const requestedMode = normalizeRouteMode(params.requestedMode);
  if (requestedMode === 'delivery' || requestedMode === 'operations') {
    return requestedMode;
  }

  const scope = String(params.scope || '').trim().toLowerCase();
  const objective = String(params.objective || '').trim().toLowerCase();
  const operationsHints = [
    'weekly',
    'incident',
    'recover',
    'release',
    'rollback',
    'ops',
    'autonomy',
    'gate',
    'runbook',
  ];
  const source = `${scope} ${objective}`;
  return operationsHints.some((token) => source.includes(token)) ? 'operations' : 'delivery';
};

const cloneWorkflowStep = (step) => ({
  id: String(step.id || '').trim(),
  script: String(step.script || '').trim(),
  scriptDry: String(step.scriptDry || step.script || '').trim(),
  classification: String(step.classification || '').trim(),
  agentRole: String(step.agentRole || '').trim(),
  handoffFrom: String(step.handoffFrom || '').trim(),
  handoffTo: String(step.handoffTo || '').trim(),
  reason: String(step.reason || '').trim(),
});

export const buildWorkflowStepsForRun = (policy, params = {}) => {
  const baseSteps = Array.isArray(policy?.workflowSteps)
    ? policy.workflowSteps.map((step) => cloneWorkflowStep(step))
    : [];
  const objective = String(params.objective || '').trim().toLowerCase();
  const routeMode = String(params.routeMode || '').trim().toLowerCase();
  const shouldIncludeGcpHealth = routeMode === 'operations'
    || Boolean(params.gcpCapacityRecoveryRequested)
    || objective.includes('gcp')
    || objective.includes('render');

  if (!shouldIncludeGcpHealth || baseSteps.some((step) => step.id === GCP_WORKER_HEALTH_STEP.id)) {
    return baseSteps;
  }

  const gcpStep = cloneWorkflowStep(GCP_WORKER_HEALTH_STEP);
  const memorySyncIndex = baseSteps.findIndex((step) => step.id === 'openjarvis-memory-sync');
  if (memorySyncIndex >= 0) {
    baseSteps.splice(memorySyncIndex, 0, gcpStep);
  } else {
    baseSteps.unshift(gcpStep);
  }

  return baseSteps;
};

const npmCmd = 'npm';

const runNpmScript = (scriptName, args = []) => {
  const start = Date.now();
  try {
    if (process.platform === 'win32') {
      execFileSync('cmd.exe', ['/d', '/s', '/c', npmCmd, 'run', '-s', scriptName, ...args], {
        cwd: ROOT,
        stdio: 'inherit',
        env: process.env,
      });
    } else {
      execFileSync(npmCmd, ['run', '-s', scriptName, ...args], {
        cwd: ROOT,
        stdio: 'inherit',
        env: process.env,
      });
    }
    return {
      script: scriptName,
      status: 'pass',
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      script: scriptName,
      status: 'fail',
      duration_ms: Date.now() - start,
      error: message,
    };
  }
};

const findBalancedJsonEnd = (text, startIndex) => {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < text.length; index += 1) {
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
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const parseJsonCommandOutput = (raw, fallback = null) => {
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
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '{' && char !== '[') {
      continue;
    }

    const endIndex = findBalancedJsonEnd(text, index);
    if (endIndex < 0) {
      continue;
    }

    const candidate = text.slice(index, endIndex + 1);
    try {
      lastParsed = JSON.parse(candidate);
      index = endIndex;
    } catch {
      // Keep scanning for the final JSON payload.
    }
  }

  return lastParsed;
};

const syncContinuityPackets = (sessionPath, reason) => {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CONTINUITY_PACKET_SYNC_SCRIPT, `--sessionPath=${path.relative(ROOT, sessionPath)}`, `--reason=${reason}`], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8').trim();
    return parseJsonCommandOutput(stdout, { ok: true });
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error
      ? String(error.stdout || '').trim()
      : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr || '').trim()
      : '';
    const message = stderr || stdout || (error instanceof Error ? error.message : String(error));
    console.warn('[OPENJARVIS][PACKETS] sync failed:', message);
    return {
      ok: false,
      error: message,
    };
  }
};

const runNpmScriptAsWorkflowStep = async (sessionPath, params) => {
  const stepOrder = await beginWorkflowStep(sessionPath, {
    stepName: params.stepName,
    agentRole: params.agentRole || 'openjarvis',
    reason: params.reason,
    handoffFrom: params.handoffFrom,
    handoffTo: params.handoffTo,
    details: {
      script: params.scriptName,
      args: params.args || [],
      classification: params.classification || null,
      route_mode: params.routeMode || null,
    },
  });

  const raw = runNpmScript(params.scriptName, params.args || []);
  const result = {
    ...raw,
    step_name: params.stepName,
    agent_role: params.agentRole || 'openjarvis',
    classification: params.classification || null,
    route_mode: params.routeMode || null,
  };
  await finishWorkflowStep(sessionPath, {
    stepOrder,
    status: result.status === 'pass' ? 'passed' : 'failed',
    reason: result.status === 'pass' ? `${params.stepName} completed` : `${params.stepName} failed`,
    handoffFrom: params.handoffFrom,
    handoffTo: params.handoffTo,
    details: {
      script_status: result.status,
      error: result.error || null,
      duration_ms: result.duration_ms,
    },
  });
  return result;
};

const latestGateRun = () => {
  if (!fs.existsSync(RUNS_DIR)) return null;

  const candidates = fs.readdirSync(RUNS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const fullPath = path.join(RUNS_DIR, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(item.fullPath, 'utf8'));
      if (!isObject(parsed)) continue;
      return {
        path: item.fullPath,
        run_id: String(parsed.run_id || ''),
        stage: String(parsed.stage || ''),
        decision: String(parsed?.final_decision?.overall || '').toLowerCase(),
        rollback_required: Boolean(parsed?.final_decision?.rollback_required),
      };
    } catch {
      continue;
    }
  }
  return null;
};

const triggerRenderDeploy = async () => {
  const serviceIdRaw = String(process.env.RENDER_SERVICE_ID || '').trim();
  const apiKey = String(process.env.RENDER_API_KEY || '').trim();
  const serviceId = serviceIdRaw.replace(/^srv-/i, '');
  const serviceFullId = `srv-${serviceId}`;

  if (!serviceId || !apiKey) {
    return {
      status: 'skipped',
      reason: 'missing RENDER_SERVICE_ID or RENDER_API_KEY',
    };
  }

  const url = `https://api.render.com/v1/services/${serviceFullId}/deploys`;
  const serviceUrl = `https://api.render.com/v1/services/${serviceFullId}`;
  const maxAttempts = 3;

  const serviceProbe = await fetch(serviceUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (serviceProbe.status === 401) {
    return {
      status: 'fail',
      http_status: serviceProbe.status,
      attempt: 0,
      reason: 'Render service probe unauthorized (check RENDER_API_KEY and workspace ownership)',
    };
  }

  if (serviceProbe.status === 403) {
    return {
      status: 'fail',
      http_status: serviceProbe.status,
      attempt: 0,
      reason: 'Render service probe forbidden (API key lacks permission for this service/workspace)',
    };
  }

  if (serviceProbe.status === 404) {
    return {
      status: 'fail',
      http_status: serviceProbe.status,
      attempt: 0,
      reason: 'Render service probe not found (RENDER_SERVICE_ID is not valid in this workspace)',
    };
  }

  if (!serviceProbe.ok) {
    return {
      status: 'fail',
      http_status: serviceProbe.status,
      attempt: 0,
      reason: `Render service probe failed with HTTP ${serviceProbe.status}`,
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        clearCache: 'do_not_clear',
        deployMode: 'build_and_deploy',
      }),
    });

    if (res.ok) {
      return {
        status: 'pass',
        http_status: res.status,
        attempt,
      };
    }

    if (res.status === 401) {
      return {
        status: 'fail',
        http_status: res.status,
        attempt,
        reason: 'Render API unauthorized (check RENDER_API_KEY and workspace ownership)',
      };
    }

    if (res.status === 403) {
      return {
        status: 'fail',
        http_status: res.status,
        attempt,
        reason: 'Render API forbidden (API key lacks permission for this service/workspace)',
      };
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 4000));
    } else {
      return {
        status: 'fail',
        http_status: res.status,
        attempt,
      };
    }
  }

  return {
    status: 'fail',
    reason: 'unexpected deploy loop state',
  };
};

async function main() {
  const dryRun = parseBool(parseArg('dryRun', process.env.AUTONOMY_DRY_RUN || 'false'));
  const autoDeploy = parseBool(parseArg('autoDeploy', process.env.AUTONOMY_AUTO_DEPLOY || 'false'));
  const strict = parseBool(parseArg('strict', process.env.AUTONOMY_STRICT || 'true'), true);
  if (dryRun) {
    for (const [envKey, envValue] of Object.entries(DRY_RUN_MISSING_SOURCE_ENV_DEFAULTS)) {
      if (!String(process.env[envKey] || '').trim()) {
        process.env[envKey] = envValue;
      }
    }
  }
  const objective = String(parseArg('objective', process.env.OPENJARVIS_OBJECTIVE || 'weekly unattended autonomy cycle')).trim();
  const scope = String(parseArg('scope', process.env.OPENJARVIS_SCOPE || 'weekly:auto')).trim() || 'weekly:auto';
  const stage = String(parseArg('stage', process.env.OPENJARVIS_STAGE || 'A')).trim() || 'A';
  const runtimeLane = String(parseArg('runtimeLane', process.env.OPENJARVIS_RUNTIME_LANE || 'operator-personal')).trim() || 'operator-personal';
  const autoRestartOnRelease = parseBool(parseArg('autoRestartOnRelease', process.env.OPENJARVIS_AUTO_RESTART_ON_RELEASE || 'false'), false);
  const gcpCapacityRecoveryRequested = parseBool(parseArg('gcpCapacityRecovery', process.env.HERMES_AUTOPILOT_GCP_CAPACITY_RECOVERY || 'false'), false);
  const routeMode = inferRouteMode({
    requestedMode: parseArg('routeMode', process.env.OPENJARVIS_ROUTE_MODE || 'auto'),
    scope,
    objective,
  });
  const requireOpencodeWorker = parseBool(parseArg('requireOpencodeWorker', process.env.OPENJARVIS_REQUIRE_OPENCODE_WORKER || 'true'), true);
  const policyLoaded = loadOpenjarvisRoutingPolicy(process.env.OPENJARVIS_ROUTING_POLICY_PATH);
  const policy = policyLoaded.policy;
  const workflowSteps = buildWorkflowStepsForRun(policy, {
    routeMode,
    objective,
    gcpCapacityRecoveryRequested,
  });
  const sessionState = await createWorkflowSession({
    dryRun,
    autoDeploy,
    strict,
    stage,
    scope,
    runtimeLane,
    routeMode,
    objective,
    autoRestartOnRelease,
  });
  const sessionPath = sessionState.sessionPath;

  const implementWorkerUrl = String(process.env.MCP_IMPLEMENT_WORKER_URL || process.env.MCP_OPENCODE_WORKER_URL || '').trim();
  if (requireOpencodeWorker && !implementWorkerUrl) {
    await transitionWorkflow(sessionPath, {
      toState: 'failed',
      eventType: 'state.failed',
      handoffFrom: 'openjarvis',
      handoffTo: 'openjarvis',
      reason: 'opencode worker URL is required but not configured',
      evidenceId: 'env:MCP_IMPLEMENT_WORKER_URL',
    });
    throw new Error('MCP_IMPLEMENT_WORKER_URL is required by OPENJARVIS_REQUIRE_OPENCODE_WORKER (legacy alias MCP_OPENCODE_WORKER_URL is also accepted)');
  }

  await transitionWorkflow(sessionPath, {
    toState: 'classified',
    eventType: 'state.classified',
    handoffFrom: 'openjarvis',
    handoffTo: 'openjarvis',
    reason: 'routing policy loaded and classification priority resolved',
    payload: {
      policy_loaded: policyLoaded.loaded,
      policy_path: path.relative(ROOT, policyLoaded.policyPath),
      classification_priority: policy.classificationPriority,
      route_mode: routeMode,
      objective,
    },
  });

  await transitionWorkflow(sessionPath, {
    toState: 'routed',
    eventType: 'state.routed',
    handoffFrom: 'openjarvis',
    handoffTo: 'openjarvis',
    reason: 'run profile resolved',
    payload: {
      dryRun,
      autoDeploy,
      strict,
      route_mode: routeMode,
      auto_restart_on_release: autoRestartOnRelease,
      objective,
      routing_policy_loaded: policyLoaded.loaded,
      routing_policy_path: path.relative(ROOT, policyLoaded.policyPath),
      workflow_step_count: workflowSteps.length,
    },
  });

  const result = {
    executed_at: new Date().toISOString(),
    workflow: {
      session_id: sessionState.sessionId,
      session_path: path.relative(ROOT, sessionPath),
      runtime_lane: runtimeLane,
      workstream_source: sessionState.source,
      remote_persisted: Boolean(sessionState.remote?.ok),
      remote_reason: sessionState.remote?.reason || null,
      routing_policy_path: path.relative(ROOT, policyLoaded.policyPath),
      routing_policy_loaded: policyLoaded.loaded,
    },
    mode: {
      dry_run: dryRun,
      auto_deploy: autoDeploy,
      strict,
      route_mode: routeMode,
      auto_restart_on_release: autoRestartOnRelease,
      gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
    },
    steps: [],
    latest_gate_run: null,
    deploy: null,
    final_status: 'pass',
    continuity_packets: {
      startup_sync: null,
      final_sync: null,
    },
    role_kpi: {
      by_agent_role: {},
      overall: {
        total_steps: 0,
        failed_steps: 0,
        retry_steps: 0,
      },
    },
  };

  await transitionWorkflow(sessionPath, {
    toState: 'executing',
    eventType: 'state.executing',
    handoffFrom: 'openjarvis',
    handoffTo: routeMode === 'delivery' ? 'opendev' : (policy.agentByClassification.implement || 'opencode'),
    reason: 'start report and gate execution using routing policy',
    evidenceId: path.relative(ROOT, policyLoaded.policyPath),
  });

  result.continuity_packets.startup_sync = syncContinuityPackets(sessionPath, 'session-executing');

  for (const step of workflowSteps) {
    const scriptName = dryRun
      ? String(step.scriptDry || step.script || '').trim()
      : String(step.script || '').trim();

    if (!scriptName) {
      continue;
    }

    result.steps.push(await runNpmScriptAsWorkflowStep(sessionPath, {
      stepName: step.id,
      scriptName,
      agentRole: step.agentRole,
      classification: step.classification,
      routeMode,
      handoffFrom: step.handoffFrom,
      handoffTo: step.handoffTo,
      reason: step.reason,
    }));
  }

  await transitionWorkflow(sessionPath, {
    toState: 'verifying',
    eventType: 'state.verifying',
    handoffFrom: 'nemoclaw',
    handoffTo: 'opendev',
    reason: 'collecting post-step verification summary',
  });

  result.latest_gate_run = latestGateRun();

  const failedStep = result.steps.find((step) => step.status !== 'pass');
  if (failedStep) {
    result.final_status = 'fail';
    await transitionWorkflow(sessionPath, {
      toState: 'recovering',
      eventType: 'state.recovering',
      handoffFrom: 'opendev',
      handoffTo: 'openjarvis',
      reason: `step failed: ${failedStep.script}`,
      evidenceId: failedStep.script,
      payload: {
        error: failedStep.error || null,
      },
    });
  }

  if (!failedStep) {
    await transitionWorkflow(sessionPath, {
      toState: 'approving',
      eventType: 'state.approving',
      handoffFrom: 'openjarvis',
      handoffTo: 'opendev',
      reason: 'evaluate latest go/no-go decision before deploy',
      evidenceId: result.latest_gate_run?.run_id || null,
      payload: {
        gate_decision: result.latest_gate_run?.decision || 'unknown',
        rollback_required: Boolean(result.latest_gate_run?.rollback_required),
      },
    });
  }

  if (result.final_status === 'pass' && autoDeploy) {
    const decision = String(result.latest_gate_run?.decision || '');
    if (decision === 'go') {
      result.deploy = await triggerRenderDeploy();
      if (result.deploy?.status === 'fail') {
        result.final_status = 'fail';
      }
    } else {
      result.deploy = {
        status: 'skipped',
        reason: `latest gate decision is ${decision || 'unknown'} (need go)`,
      };
    }
  } else {
    result.deploy = {
      status: 'skipped',
      reason: autoDeploy ? 'pre-deploy steps failed' : 'auto deploy disabled',
    };
  }

  if (result.final_status === 'pass') {
    await transitionWorkflow(sessionPath, {
      toState: 'released',
      eventType: 'state.released',
      handoffFrom: 'opendev',
      handoffTo: 'openjarvis',
      reason: result.deploy?.status === 'pass' ? 'deploy triggered successfully' : 'run completed without deployment',
      payload: {
        deploy_status: result.deploy?.status || 'unknown',
      },
    });
  } else {
    await transitionWorkflow(sessionPath, {
      toState: 'failed',
      eventType: 'state.failed',
      handoffFrom: 'openjarvis',
      handoffTo: 'openjarvis',
      reason: 'workflow failed by strict step/deploy validation',
      payload: {
        failed_step: failedStep?.script || null,
      },
    });
  }

  const byRole = {};
  for (const step of result.steps) {
    const scriptName = String(step.script || '').trim().toLowerCase();
    const role = String(step.agent_role || '').trim().toLowerCase()
      || (scriptName.includes('weekly-report') ? 'opencode' : (scriptName.includes('rollback') ? 'nemoclaw' : 'openjarvis'));

    const current = byRole[role] || {
      total_steps: 0,
      failed_steps: 0,
      retry_steps: 0,
      durations_ms: [],
      p95_duration_ms: 0,
      avg_duration_ms: 0,
      fail_rate: 0,
      retry_rate: 0,
    };

    current.total_steps += 1;
    if (step.status !== 'pass') {
      current.failed_steps += 1;
    }
    if (String(step.error || '').trim()) {
      current.retry_steps += 1;
    }
    if (Number.isFinite(step.duration_ms)) {
      current.durations_ms.push(Math.max(0, Number(step.duration_ms)));
    }
    byRole[role] = current;
  }

  for (const role of Object.keys(byRole)) {
    const row = byRole[role];
    const sorted = [...row.durations_ms].sort((a, b) => a - b);
    const p95Index = sorted.length > 0
      ? Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1))
      : 0;
    const durationSum = row.durations_ms.reduce((sum, value) => sum + value, 0);
    row.p95_duration_ms = sorted.length > 0 ? sorted[p95Index] : 0;
    row.avg_duration_ms = row.durations_ms.length > 0 ? Math.round(durationSum / row.durations_ms.length) : 0;
    row.fail_rate = row.total_steps > 0 ? Number((row.failed_steps / row.total_steps).toFixed(4)) : 0;
    row.retry_rate = row.total_steps > 0 ? Number((row.retry_steps / row.total_steps).toFixed(4)) : 0;
    delete row.durations_ms;
  }

  result.role_kpi = {
    by_agent_role: byRole,
    overall: {
      total_steps: result.steps.length,
      failed_steps: result.steps.filter((step) => step.status !== 'pass').length,
      retry_steps: result.steps.filter((step) => String(step.error || '').trim().length > 0).length,
    },
  };

  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  result.continuity_packets.final_sync = syncContinuityPackets(sessionPath, result.final_status === 'pass' ? 'session-finished-pass' : 'session-finished-fail');
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log('[OPENJARVIS][UNATTENDED] summary path:', path.relative(ROOT, SUMMARY_PATH));
  console.log('[OPENJARVIS][UNATTENDED] final status:', result.final_status);

  if (strict && result.final_status !== 'pass') {
    process.exit(1);
  }
}

const directExecutionPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (directExecutionPath === modulePath) {
  main().catch((error) => {
    console.error('[OPENJARVIS][UNATTENDED] FAIL', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
