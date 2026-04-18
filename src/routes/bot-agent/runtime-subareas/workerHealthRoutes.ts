import { requireAdmin } from '../../../middleware/auth';
import { getAgentRoleWorkersHealthSnapshot, listAgentRoleWorkerSpecs, probeHttpWorkerHealth } from '../../../services/agent/agentRoleWorkerService';
import { getAgentTelemetryQueueSnapshot } from '../../../services/agent/agentTelemetryQueue';
import { buildSocialQualityOperationalSnapshot } from '../../../services/agent/agentSocialQualitySnapshotService';
import { buildWorkerApprovalGateSnapshot } from '../../../services/agent/agentWorkerApprovalGateSnapshotService';
import { resolveAgentPersonalizationSnapshot } from '../../../services/agent/agentPersonalizationService';
import { getLlmRuntimeSnapshot } from '../../../services/llmClient';
import { summarizeOpencodeQueueReadiness } from '../../../services/opencode/opencodeGitHubQueueService';
import { getOpenJarvisAutopilotStatus } from '../../../services/openjarvis/openjarvisAutopilotStatusService';
import { getOpenJarvisMemorySyncStatus, getOpenJarvisMemorySyncScheduleStatus } from '../../../services/openjarvis/openjarvisMemorySyncStatusService';
import {
  MCP_IMPLEMENT_WORKER_URL,
  MCP_OPENCODE_WORKER_URL,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN,
  OPENJARVIS_REQUIRE_OPENCODE_WORKER,
  UNATTENDED_WORKER_HEALTH_TIMEOUT_MS,
} from '../../../config';
import { sanitizeRecord, toBoundedInt, toStringParam } from '../../../utils/validation';
import { buildDoctorReport } from '../../../../scripts/local-ai-stack-control.mjs';

import { buildOpenJarvisAutopilotStatusParams } from '../runtime-builders/paramValidation';
import { type BotAgentRouteDeps } from '../types';

const EXECUTOR_ACTION_CANONICAL_NAME = 'implement.execute';
const EXECUTOR_ACTION_LEGACY_NAME = 'opencode.execute';
const EXECUTOR_WORKER_ENV_CANONICAL_KEY = 'MCP_IMPLEMENT_WORKER_URL';
const EXECUTOR_WORKER_ENV_LEGACY_KEY = 'MCP_OPENCODE_WORKER_URL';
const LOCAL_AUTONOMY_PROFILE = 'local-nemoclaw-max-delegation';

const EXECUTOR_CONTRACT = {
  canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
  persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
  legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
  canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
  legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
};

const probeOpencodeWorkerHealth = async () => {
  const required = OPENJARVIS_REQUIRE_OPENCODE_WORKER;
  const workerUrl = MCP_IMPLEMENT_WORKER_URL || MCP_OPENCODE_WORKER_URL;
  const timeoutMs = UNATTENDED_WORKER_HEALTH_TIMEOUT_MS;
  if (!required && !workerUrl) {
    return {
      required: false,
      configured: false,
      reachable: null,
      latencyMs: null,
      status: null,
      endpoint: null,
      checkedAt: new Date().toISOString(),
      reason: 'worker_not_required',
      label: 'implement',
      contract: EXECUTOR_CONTRACT,
    };
  }

  if (!workerUrl) {
    return {
      required,
      configured: false,
      reachable: false,
      latencyMs: null,
      status: null,
      endpoint: null,
      checkedAt: new Date().toISOString(),
      reason: 'worker_url_missing',
      label: 'implement',
      contract: EXECUTOR_CONTRACT,
    };
  }

  const health = await probeHttpWorkerHealth(workerUrl, timeoutMs);

  return {
    required,
    configured: true,
    reachable: health.ok,
    latencyMs: health.latencyMs,
    status: health.status,
    endpoint: health.endpoint,
    checkedAt: new Date().toISOString(),
    reason: health.ok ? undefined : health.error || 'probe_failed',
    label: 'implement',
    contract: EXECUTOR_CONTRACT,
  };
};

export function registerBotAgentWorkerHealthRoutes(deps: BotAgentRouteDeps): void {
  const { router } = deps;

  router.get('/agent/runtime/worker-approval-gates', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const recentLimit = toBoundedInt(req.query?.recentLimit, 5, { min: 1, max: 20 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildWorkerApprovalGateSnapshot({ guildId, recentLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/social-quality-snapshot', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildSocialQualityOperationalSnapshot({ guildId, days });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/personalization', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const userId = toStringParam(req.query?.userId);
    const priority = toStringParam(req.query?.priority) || 'balanced';
    const requestedSkillId = toStringParam(req.query?.skillId || req.query?.requestedSkillId) || null;
    if (!guildId || !userId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and userId are required' });
    }

    try {
      const snapshot = await resolveAgentPersonalizationSnapshot({
        guildId,
        userId,
        requestedPriority: priority,
        requestedSkillId,
      });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/telemetry-queue', requireAdmin, async (_req, res, _next) => {
    return res.json({ ok: true, queue: getAgentTelemetryQueueSnapshot() });
  });

  router.get('/agent/runtime/role-workers', requireAdmin, async (_req, res, next) => {
    try {
      const specs = listAgentRoleWorkerSpecs();
      const health = await getAgentRoleWorkersHealthSnapshot();
      return res.json({ ok: true, workers: specs, health });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/unattended-health', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const actionName = toStringParam(req.query?.actionName) || undefined;
    try {
      const telemetry = getAgentTelemetryQueueSnapshot();
      const readiness = guildId
        ? await summarizeOpencodeQueueReadiness({ guildId })
        : null;
      const workerHealth = await probeOpencodeWorkerHealth();
      const advisoryWorkersHealth = await getAgentRoleWorkersHealthSnapshot();
      const llmRuntime = await getLlmRuntimeSnapshot({ guildId: guildId || undefined, actionName });
      const openjarvisMemorySync = getOpenJarvisMemorySyncStatus();
      const openjarvisMemorySyncSchedule = await getOpenJarvisMemorySyncScheduleStatus();
      const localAutonomy = await buildDoctorReport({ profile: LOCAL_AUTONOMY_PROFILE });
      const openjarvisAutopilot = await getOpenJarvisAutopilotStatus(buildOpenJarvisAutopilotStatusParams(
        sanitizeRecord(req.query),
      ));
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        telemetry,
        executorReadiness: readiness,
        opencodeReadiness: readiness,
        workerHealth,
        advisoryWorkersHealth,
        llmRuntime,
        openjarvisMemorySync,
        openjarvisMemorySyncSchedule,
        localAutonomy,
        openjarvisAutopilot,
        notes: {
          guildScoped: Boolean(guildId),
          actionName: actionName || null,
          executorContract: EXECUTOR_CONTRACT,
          publishLock: {
            enabled: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED),
            failOpen: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });
}