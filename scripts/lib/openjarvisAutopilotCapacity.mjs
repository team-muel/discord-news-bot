import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACTIVE_WORKFLOW_STATES = new Set(['classified', 'routed', 'executing', 'verifying', 'approving', 'recovering']);
export const WAIT_FOR_NEXT_GPT_ACTION = 'wait for the next gpt objective or human approval boundary';
export const DEFAULT_CAPACITY_TARGET = 90;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OPERATING_BASELINE_PATH = path.resolve(moduleDir, '../../config/runtime/operating-baseline.json');
const GCP_NATIVE_SERVICE_IDS = ['implementWorker', 'architectWorker', 'reviewWorker', 'operateWorker', 'openjarvisServe', 'unifiedMcp'];
const GCP_NATIVE_SERVICE_LABELS = {
  implementWorker: 'implement worker',
  architectWorker: 'architect worker',
  reviewWorker: 'review worker',
  operateWorker: 'operate worker',
  openjarvisServe: 'OpenJarvis serve',
  unifiedMcp: 'shared MCP',
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const toLower = (value) => String(value || '').trim().toLowerCase();
const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};
const parseBool = (value) => ['1', 'true', 'yes', 'on'].includes(toLower(value));
const toBoolean = (value) => (typeof value === 'boolean' ? value : parseBool(value));

const pushUnique = (items, value) => {
  const normalized = String(value || '').trim();
  if (!normalized || items.includes(normalized)) {
    return;
  }
  items.push(normalized);
};

const inferObsidianHealth = (continuityPackets, packetPathsAvailable, resumeAvailable) => {
  const candidates = [continuityPackets?.final_sync, continuityPackets?.startup_sync].filter(Boolean);
  for (const candidate of candidates) {
    if (typeof candidate?.obsidian_healthy === 'boolean') {
      return candidate.obsidian_healthy;
    }
    if (Array.isArray(candidate?.obsidian_issues) && candidate.obsidian_issues.length > 0) {
      return false;
    }
  }

  if (packetPathsAvailable && resumeAvailable) {
    return true;
  }

  return null;
};

const inferVsCodeBridgeOk = (statusLike) => Boolean(
  statusLike?.vscode_cli?.last_auto_open?.ok
  || statusLike?.launch?.vscode_bridge?.ok
  || statusLike?.supervisor?.vscode_bridge?.ok
  || statusLike?.launch?.vscode_bridge === true
);

const normalizeUrl = (value) => {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  return normalized.toLowerCase();
};

const isRemoteUrl = (value) => {
  const normalized = normalizeUrl(value);
  return normalized.startsWith('http://') || normalized.startsWith('https://')
    ? !normalized.includes('127.0.0.1') && !normalized.includes('localhost')
    : false;
};

const urlsEquivalent = (left, right) => {
  const normalizedLeft = normalizeUrl(left);
  const normalizedRight = normalizeUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const readOperatingBaseline = (baselinePath = DEFAULT_OPERATING_BASELINE_PATH) => {
  try {
    return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch {
    return null;
  }
};

const formatGcpServiceLabel = (serviceId) => GCP_NATIVE_SERVICE_LABELS[serviceId] || String(serviceId || '').trim() || 'unknown service';

const collectServiceEnvKeys = (service = {}) => [
  service.envKey,
  service.legacyEnvKey,
  service.indexingEnvKey,
  ...(Array.isArray(service.extraEnvKeys) ? service.extraEnvKeys : []),
].filter(Boolean);

const collectServiceCanonicalCandidates = (service = {}) => [
  service.url,
  service.legacyUrl,
  service.directUrl,
  ...(Array.isArray(service.extraUrls) ? service.extraUrls : []),
]
  .map((value) => String(value || '').trim())
  .filter(Boolean);

const countEnabledSharedWrapperServers = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw || raw === '[]') {
    return 0;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return 0;
    }

    return parsed.filter((entry) => entry
      && typeof entry === 'object'
      && entry.enabled !== false
      && String(entry.audience || '').trim().toLowerCase() !== 'operator').length;
  } catch {
    return 0;
  }
};

export const buildGcpNativeAutopilotContext = (params = {}) => {
  const env = params.env || process.env;
  const operatingBaselinePath = params.operatingBaselinePath || DEFAULT_OPERATING_BASELINE_PATH;
  const operatingBaseline = params.operatingBaseline || readOperatingBaseline(operatingBaselinePath);
  const strictRoutingEnabled = parseBool(env.ACTION_MCP_STRICT_ROUTING);
  const delegationEnabled = parseBool(env.ACTION_MCP_DELEGATION_ENABLED);
  const opencodeWorkerRequired = parseBool(env.OPENJARVIS_REQUIRE_OPENCODE_WORKER);
  const obsidianRemoteMcpEnabled = parseBool(env.OBSIDIAN_REMOTE_MCP_ENABLED);
  const localOllamaEnabled = Boolean(String(env.OLLAMA_BASE_URL || '').trim());
  const sharedMcpUpstreamConfiguredCount = countEnabledSharedWrapperServers(env.MCP_UPSTREAM_SERVERS);

  if (!operatingBaseline?.services) {
    return {
      available: false,
      operating_baseline_path: operatingBaselinePath,
      instance_name: null,
      machine_type: null,
      required_surface_count: 0,
      wired_surface_count: 0,
      remote_surface_count: 0,
      missing_surfaces: [],
      strict_routing_enabled: strictRoutingEnabled,
      delegation_enabled: delegationEnabled,
      opencode_worker_required: opencodeWorkerRequired,
      obsidian_remote_mcp_enabled: obsidianRemoteMcpEnabled,
      local_ollama_enabled: localOllamaEnabled,
      openjarvis_remote_preferred: false,
      shared_mcp_remote_preferred: false,
      shared_mcp_upstream_configured_count: sharedMcpUpstreamConfiguredCount,
      shared_mcp_wrapper_ready: false,
      services: {},
    };
  }

  const services = {};
  let wiredSurfaceCount = 0;
  let remoteSurfaceCount = 0;
  const missingSurfaces = [];

  for (const serviceId of GCP_NATIVE_SERVICE_IDS) {
    const service = operatingBaseline.services?.[serviceId];
    if (!service) {
      continue;
    }

    const envKeys = collectServiceEnvKeys(service);
    const actualValues = envKeys
      .map((envKey) => String(env[envKey] || '').trim())
      .filter(Boolean);
    const canonicalCandidates = collectServiceCanonicalCandidates(service);
    const canonicalMatch = actualValues.some((actualValue) => canonicalCandidates.some((candidate) => urlsEquivalent(actualValue, candidate)));
    const remoteConfigured = actualValues.some(isRemoteUrl);

    if (canonicalMatch) {
      wiredSurfaceCount += 1;
    } else {
      missingSurfaces.push(serviceId);
    }
    if (remoteConfigured) {
      remoteSurfaceCount += 1;
    }

    services[serviceId] = {
      configured: actualValues.length > 0,
      env_keys: envKeys,
      actual: actualValues[0] || null,
      canonical_candidates: canonicalCandidates,
      canonical_match: canonicalMatch,
      remote_configured: remoteConfigured,
    };
  }

  return {
    available: Object.keys(services).length > 0,
    operating_baseline_path: operatingBaselinePath,
    instance_name: operatingBaseline.gcpWorker?.instanceName || null,
    machine_type: operatingBaseline.gcpWorker?.machineType || null,
    required_surface_count: Object.keys(services).length,
    wired_surface_count: wiredSurfaceCount,
    remote_surface_count: remoteSurfaceCount,
    missing_surfaces: missingSurfaces,
    strict_routing_enabled: strictRoutingEnabled,
    delegation_enabled: delegationEnabled,
    opencode_worker_required: opencodeWorkerRequired,
    obsidian_remote_mcp_enabled: obsidianRemoteMcpEnabled,
    local_ollama_enabled: localOllamaEnabled,
    openjarvis_remote_preferred: services.openjarvisServe?.canonical_match === true,
    shared_mcp_remote_preferred: services.unifiedMcp?.canonical_match === true,
    shared_mcp_upstream_configured_count: sharedMcpUpstreamConfiguredCount,
    shared_mcp_wrapper_ready: services.unifiedMcp?.canonical_match === true && sharedMcpUpstreamConfiguredCount > 0,
    services,
  };
};

const inferGcpNativeCapacity = (gcpNativeLike) => {
  if (!gcpNativeLike?.available) {
    return null;
  }

  const requiredSurfaceCount = Math.max(1, toNumber(gcpNativeLike.required_surface_count));
  const wiredSurfaceCount = clamp(toNumber(gcpNativeLike.wired_surface_count), 0, requiredSurfaceCount);
  const remoteSurfaceCount = clamp(toNumber(gcpNativeLike.remote_surface_count), 0, requiredSurfaceCount);
  const missingSurfaces = Array.isArray(gcpNativeLike.missing_surfaces) ? gcpNativeLike.missing_surfaces : [];
  const strengths = [];
  const blockers = [];

  const surfaceScore = Math.round((wiredSurfaceCount / requiredSurfaceCount) * 70);
  const routingScore = (gcpNativeLike.strict_routing_enabled ? 10 : 0)
    + (gcpNativeLike.opencode_worker_required ? 10 : 0)
    + (gcpNativeLike.delegation_enabled ? 5 : 0)
    + (gcpNativeLike.obsidian_remote_mcp_enabled && gcpNativeLike.shared_mcp_wrapper_ready ? 5 : 0);
  const score = clamp(surfaceScore + routingScore, 0, 100);

  if (wiredSurfaceCount === requiredSurfaceCount) {
    pushUnique(strengths, 'all canonical GCP always-on surfaces are wired into the active runtime');
  } else {
    pushUnique(blockers, `${requiredSurfaceCount - wiredSurfaceCount} canonical GCP surface(s) are not wired into the active runtime`);
  }

  for (const serviceId of missingSurfaces) {
    pushUnique(blockers, `missing canonical GCP surface: ${formatGcpServiceLabel(serviceId)}`);
  }

  if (gcpNativeLike.strict_routing_enabled) {
    pushUnique(strengths, 'strict worker routing is enabled for the GCP lane');
  } else {
    pushUnique(blockers, 'strict worker routing is disabled for the GCP lane');
  }

  if (gcpNativeLike.opencode_worker_required) {
    pushUnique(strengths, 'OpenJarvis requires the remote opencode worker on the active lane');
  } else {
    pushUnique(blockers, 'OpenJarvis can still bypass the remote opencode worker on the active lane');
  }

  if (gcpNativeLike.delegation_enabled) {
    pushUnique(strengths, 'MCP delegation is enabled for GCP-backed role workers');
  } else {
    pushUnique(blockers, 'MCP delegation is disabled for GCP-backed role workers');
  }

  if (gcpNativeLike.openjarvis_remote_preferred) {
    pushUnique(strengths, 'OpenJarvis serve points at the canonical GCP lane');
  } else {
    pushUnique(blockers, 'OpenJarvis serve still prefers a local-only surface');
  }

  if (gcpNativeLike.shared_mcp_remote_preferred) {
    pushUnique(strengths, 'shared MCP service points at the canonical GCP lane');
  } else {
    pushUnique(blockers, 'shared MCP is not yet anchored to the canonical GCP lane');
  }

  if (gcpNativeLike.shared_mcp_wrapper_ready) {
    pushUnique(strengths, 'shared MCP wrapper namespaces are configured for the active lane');
  } else if (gcpNativeLike.shared_mcp_remote_preferred) {
    pushUnique(blockers, 'shared MCP URL is wired but no enabled MCP_UPSTREAM_SERVERS namespace is configured');
  }

  if (gcpNativeLike.obsidian_remote_mcp_enabled) {
    pushUnique(strengths, 'remote Obsidian MCP is explicitly enabled for the active lane');
  } else if (gcpNativeLike.shared_mcp_remote_preferred) {
    pushUnique(blockers, 'shared MCP is remote but remote Obsidian MCP is not explicitly enabled');
  } else {
    pushUnique(blockers, 'remote Obsidian MCP is not explicitly enabled for the active lane');
  }

  let primaryReason = 'gcp_native_capacity_below_target';
  if (!gcpNativeLike.openjarvis_remote_preferred) {
    primaryReason = 'gcp_openjarvis_serve_not_remote';
  } else if (!gcpNativeLike.shared_mcp_remote_preferred) {
    primaryReason = 'gcp_shared_mcp_not_remote';
  } else if (!gcpNativeLike.shared_mcp_wrapper_ready) {
    primaryReason = 'gcp_shared_mcp_wrapper_not_configured';
  } else if (!gcpNativeLike.obsidian_remote_mcp_enabled) {
    primaryReason = 'gcp_remote_obsidian_not_enabled';
  } else if (wiredSurfaceCount < requiredSurfaceCount) {
    primaryReason = 'gcp_role_worker_surfaces_incomplete';
  } else if (!gcpNativeLike.strict_routing_enabled) {
    primaryReason = 'gcp_strict_routing_disabled';
  } else if (!gcpNativeLike.opencode_worker_required) {
    primaryReason = 'gcp_worker_requirement_disabled';
  }

  return {
    score,
    strengths,
    blockers,
    primary_reason: primaryReason,
    required_surfaces: requiredSurfaceCount,
    wired_surfaces: wiredSurfaceCount,
    remote_surfaces: remoteSurfaceCount,
    instance_name: gcpNativeLike.instance_name || null,
    machine_type: gcpNativeLike.machine_type || null,
  };
};

export const normalizeCapacityTarget = (value, fallback = DEFAULT_CAPACITY_TARGET) => {
  const raw = String(value ?? '').trim();
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return clamp(numeric, 1, 100);
};

export const buildAutopilotCapacity = (statusLike = {}) => {
  const target = normalizeCapacityTarget(statusLike?.target ?? statusLike?.resume_state?.capacity?.target);
  const workflowStatus = toLower(statusLike?.workflow?.status);
  const finalStatus = toLower(statusLike?.result?.final_status);
  const resumeReason = toLower(statusLike?.resume_state?.reason);
  const owner = toLower(statusLike?.resume_state?.owner);
  const mode = toLower(statusLike?.resume_state?.mode);
  const staleExecutionSuspected = Boolean(statusLike?.result?.stale_execution_suspected);
  const failedSteps = Math.max(0, toNumber(statusLike?.result?.failed_steps));
  const resumeAvailable = Boolean(statusLike?.resume_state?.available);
  const resumeResumable = Boolean(statusLike?.resume_state?.resumable);
  const safeQueueCount = Array.isArray(statusLike?.resume_state?.safe_queue)
    ? statusLike.resume_state.safe_queue.length
    : 0;
  const packetPathsAvailable = Boolean(
    statusLike?.resume_state?.handoff_packet_path
    && statusLike?.resume_state?.progress_packet_path
  );
  const obsidianHealthy = inferObsidianHealth(statusLike?.continuity_packets, packetPathsAvailable, resumeAvailable);
  const continuousLoopEnabled = Boolean(statusLike?.launch?.continuous_loop) || Boolean(statusLike?.supervisor);
  const launchManifestAvailable = Boolean(statusLike?.launch?.manifest_path);
  const launchLogAvailable = Boolean(statusLike?.launch?.log_path);
  const monitorKnown = statusLike?.launch?.monitor_pid !== null && statusLike?.launch?.monitor_pid !== undefined;
  const runnerKnown = statusLike?.launch?.runner_pid !== null && statusLike?.launch?.runner_pid !== undefined;
  const monitorAlive = statusLike?.launch?.monitor_alive;
  const runnerAlive = statusLike?.launch?.runner_alive;
  const launchesCompleted = Math.max(0, toNumber(statusLike?.supervisor?.launches_completed));
  const lastLaunchOk = statusLike?.supervisor?.last_launch?.ok === true;
  const vscodeBridgeOk = inferVsCodeBridgeOk(statusLike);
  const gcpNative = inferGcpNativeCapacity(statusLike?.gcp_native);
  const gcpCapacityRecoveryRequested = toBoolean(statusLike?.gcp_capacity_recovery_requested)
    || toBoolean(statusLike?.resume_state?.gcp_capacity_recovery_requested);

  const waitingBoundary = resumeReason === 'packet_waiting_for_next_gpt_objective'
    || (owner === 'human' && mode === 'waiting');
  const activeWorkflow = ACTIVE_WORKFLOW_STATES.has(workflowStatus);
  const failedWorkflow = workflowStatus === 'failed' || finalStatus === 'fail';
  const escalated = resumeReason.startsWith('escalation_');
  const blocked = staleExecutionSuspected || failedWorkflow || escalated || obsidianHealthy === false;

  const strengths = [];
  const blockers = [];

  let execution = 0;
  if (staleExecutionSuspected) {
    execution = 8;
    pushUnique(blockers, 'runner is missing while workflow metadata still looks active');
  } else if (failedWorkflow) {
    execution = 4;
    pushUnique(blockers, 'latest workflow ended in a failed state');
  } else if (workflowStatus === 'released' && failedSteps === 0) {
    execution = 34;
    pushUnique(strengths, 'latest workflow reached a clean released state');
  } else if (activeWorkflow) {
    execution = 26;
    pushUnique(strengths, 'workflow is still actively progressing');
  } else if (workflowStatus) {
    execution = 16;
  } else if (resumeAvailable) {
    execution = 10;
  }
  if (failedSteps > 0) {
    execution = Math.max(0, execution - Math.min(12, failedSteps * 4));
    pushUnique(blockers, `${failedSteps} workflow step(s) remain failed`);
  }

  let continuity = 0;
  if (resumeAvailable) {
    continuity += 10;
    pushUnique(strengths, 'stable continuity packets are available');
  } else {
    pushUnique(blockers, 'continuity packets are unavailable');
  }
  if (packetPathsAvailable) {
    continuity += 4;
  }
  if (safeQueueCount > 0) {
    continuity += 4;
  }
  if (resumeResumable) {
    continuity += 4;
    pushUnique(strengths, 'packet state supports a direct resume path');
  } else if (waitingBoundary) {
    continuity += 2;
    pushUnique(strengths, 'packet state cleanly yields at the GPT or human boundary');
  } else if (resumeReason) {
    pushUnique(blockers, `resume state is constrained by ${resumeReason}`);
  }
  if (obsidianHealthy === true) {
    continuity += 8;
    pushUnique(strengths, 'Obsidian continuity storage is healthy');
  } else if (obsidianHealthy === false) {
    pushUnique(blockers, 'Obsidian continuity storage is degraded');
  }
  continuity = clamp(continuity, 0, 30);

  let observability = 0;
  if (launchManifestAvailable) {
    observability += 3;
  }
  if (launchLogAvailable) {
    observability += 3;
  }
  if (statusLike?.supervisor) {
    observability += 4;
  }
  if (vscodeBridgeOk) {
    observability += 5;
    pushUnique(strengths, 'VS Code bridge opened the active continuity surface successfully');
  }
  if (monitorKnown) {
    observability += 2;
  }
  if (runnerKnown) {
    observability += 2;
  }
  if (monitorAlive === true || runnerAlive === true || workflowStatus === 'released') {
    observability += 3;
  }
  observability = clamp(observability, 0, 20);

  let autonomy = 0;
  if (continuousLoopEnabled) {
    autonomy += 4;
    pushUnique(strengths, 'supervisor loop metadata is present');
  }
  if (launchesCompleted > 0 || lastLaunchOk) {
    autonomy += 4;
  }
  if (!staleExecutionSuspected) {
    autonomy += 3;
  }
  if (owner === 'hermes' && (mode === 'executing' || mode === 'observing')) {
    autonomy += 4;
  } else if (waitingBoundary) {
    autonomy += 2;
  } else if (owner === 'gpt' && mode === 'blocked') {
    pushUnique(blockers, 'Hermes handed control back to GPT due to a blocked workflow');
  }
  if (failedSteps === 0) {
    autonomy += 2;
  }
  autonomy = clamp(autonomy, 0, 15);

  const continuityPlane = clamp(Math.round(execution + continuity + observability + autonomy), 0, 100);
  if (gcpNative) {
    for (const strength of gcpNative.strengths) {
      pushUnique(strengths, strength);
    }
    for (const blocker of gcpNative.blockers) {
      pushUnique(blockers, blocker);
    }
  }
  const score = clamp(Math.round(gcpNative ? ((continuityPlane + gcpNative.score) / 2) : continuityPlane), 0, 100);
  const gap = Math.max(0, target - score);
  const reached = score >= target;
  const recoveryOverrideActive = Boolean(gcpCapacityRecoveryRequested && !blocked && !reached);

  if (gcpCapacityRecoveryRequested) {
    pushUnique(strengths, 'operator explicitly requested GCP capacity recovery until the target is reached');
  }

  let primaryReason = 'capacity_below_target';
  if (staleExecutionSuspected) {
    primaryReason = 'stale_execution';
  } else if (failedWorkflow) {
    primaryReason = 'workflow_failed';
  } else if (escalated) {
    primaryReason = resumeReason || 'escalation_pending';
  } else if (!resumeAvailable) {
    primaryReason = 'missing_continuity_packets';
  } else if (obsidianHealthy === false) {
    primaryReason = 'obsidian_unhealthy';
  } else if (activeWorkflow) {
    primaryReason = 'workflow_active';
  } else if (recoveryOverrideActive && gcpNative && gcpNative.score < target) {
    primaryReason = gcpNative.primary_reason;
  } else if (recoveryOverrideActive) {
    primaryReason = 'operator_requested_gcp_capacity_recovery';
  } else if (gcpNative && continuityPlane >= target && gcpNative.score < target) {
    primaryReason = gcpNative.primary_reason;
  } else if (waitingBoundary && reached) {
    primaryReason = 'capacity_target_reached_waiting_for_next_gpt_objective';
  } else if (waitingBoundary) {
    primaryReason = 'waiting_for_next_gpt_objective';
  } else if (reached) {
    primaryReason = 'capacity_target_reached';
  }

  let loopAction = 'continue';
  if (blocked) {
    loopAction = 'escalate';
  } else if (waitingBoundary && !recoveryOverrideActive) {
    loopAction = 'wait';
  } else if (activeWorkflow) {
    loopAction = 'observe';
  } else if (reached) {
    loopAction = 'stop';
  }

  let state = 'bootstrapping';
  if (blocked) {
    state = 'blocked';
  } else if (waitingBoundary && !recoveryOverrideActive) {
    state = 'waiting';
  } else if (recoveryOverrideActive) {
    state = 'recovering';
  } else if (activeWorkflow) {
    state = 'advancing';
  } else if (reached) {
    state = 'healthy';
  } else if (resumeAvailable) {
    state = 'advancing';
  }

  return {
    target,
    score,
    gap,
    reached,
    state,
    loop_action: loopAction,
    continue_recommended: loopAction === 'continue' || loopAction === 'observe',
    primary_reason: primaryReason,
    breakdown: {
      execution,
      continuity,
      observability,
      autonomy,
      continuity_plane: continuityPlane,
    },
    gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
    gcp_native: gcpNative,
    strengths,
    blockers,
  };
};

export const buildAutopilotCapacitySectionLines = (capacity) => {
  const effective = capacity || buildAutopilotCapacity();
  return [
    `target: ${effective.target}`,
    `current: ${effective.score}`,
    `gap: ${effective.gap}`,
    `reached: ${String(effective.reached)}`,
    `state: ${effective.state}`,
    `loop_action: ${effective.loop_action}`,
    `continue_recommended: ${String(effective.continue_recommended)}`,
    `primary_reason: ${effective.primary_reason}`,
    `execution: ${effective.breakdown.execution}`,
    `continuity: ${effective.breakdown.continuity}`,
    `observability: ${effective.breakdown.observability}`,
    `autonomy: ${effective.breakdown.autonomy}`,
    `continuity_plane: ${effective.breakdown.continuity_plane}`,
    `gcp_capacity_recovery_requested: ${String(Boolean(effective.gcp_capacity_recovery_requested))}`,
    ...(effective.gcp_native ? [
      `gcp_native_current: ${effective.gcp_native.score}`,
      `gcp_native_required_surfaces: ${effective.gcp_native.required_surfaces}`,
      `gcp_native_wired_surfaces: ${effective.gcp_native.wired_surfaces}`,
      `gcp_native_primary_reason: ${effective.gcp_native.primary_reason}`,
    ] : []),
    `strengths: ${effective.strengths.length > 0 ? effective.strengths.join(' | ') : 'none'}`,
    `blockers: ${effective.blockers.length > 0 ? effective.blockers.join(' | ') : 'none'}`,
  ];
};