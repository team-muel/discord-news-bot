import { requireAdmin } from '../../../middleware/auth';
import { resolveAgentPersonalizationSnapshot } from '../../../services/agent/agentPersonalizationService';
import { getOpenJarvisAutopilotStatus, getOpenJarvisSessionOpenBundle } from '../../../services/openjarvis/openjarvisAutopilotStatusService';
import {
  createOpenJarvisHermesRuntimeChatNote,
  enqueueOpenJarvisHermesRuntimeObjectives,
  launchOpenJarvisHermesChatSession,
  prepareOpenJarvisHermesSessionStart,
  runOpenJarvisHermesRuntimeRemediation,
} from '../../../services/openjarvis/openjarvisHermesRuntimeControlService';
import {
  ensureOpenJarvisMemorySyncSchedule,
  getOpenJarvisMemorySyncScheduleStatus,
  runOpenJarvisManagedMemoryMaintenance,
  runOpenJarvisMemorySync,
  startOpenJarvisSchedulerDaemon,
} from '../../../services/openjarvis/openjarvisMemorySyncStatusService';
import { getHermesVsCodeBridgeStatus, runHermesVsCodeBridge } from '../../../services/runtime/hermesVsCodeBridgeService';
import { sanitizeRecord, toBoundedInt, toStringParam } from '../../../utils/validation';

import {
  buildOpenJarvisAutopilotStatusParams,
  parseBool,
  toOptionalBoundedInt,
  toStringArrayParam,
} from '../runtime-builders/paramValidation';
import { type BotAgentRouteDeps } from '../types';

export function registerBotAgentOpenjarvisRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency } = deps;

  router.get('/agent/runtime/openjarvis/autopilot', requireAdmin, async (req, res, next) => {
    try {
      const status = await getOpenJarvisAutopilotStatus(buildOpenJarvisAutopilotStatusParams(
        sanitizeRecord(req.query),
      ));
      return res.json({ ok: true, status });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/openjarvis/hermes-runtime', requireAdmin, async (req, res, next) => {
    try {
      const status = await getOpenJarvisAutopilotStatus(buildOpenJarvisAutopilotStatusParams(
        sanitizeRecord(req.query),
      ));
      return res.json({ ok: true, hermesRuntime: status.hermes_runtime });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/session-start', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    try {
      const requesterId = toStringParam((req as { user?: { id?: string } }).user?.id) || 'admin-route';
      const result = await prepareOpenJarvisHermesSessionStart({
        ...buildOpenJarvisAutopilotStatusParams(sanitizeRecord(req.body)),
        objective: toStringParam(req.body?.objective) || null,
        objectives: toStringArrayParam(req.body?.objectives),
        contextProfile: toStringParam(req.body?.contextProfile) || null,
        title: toStringParam(req.body?.title) || null,
        guildId: toStringParam(req.body?.guildId) || null,
        createChatNote: parseBool(String(req.body?.createChatNote ?? 'true'), true),
        startSupervisor: parseBool(String(req.body?.startSupervisor ?? 'true'), true),
        dryRun: parseBool(String(req.body?.dryRun ?? 'false'), false),
        visibleTerminal: parseBool(String(req.body?.visibleTerminal ?? 'true'), true),
        autoLaunchQueuedChat: parseBool(String(req.body?.autoLaunchQueuedChat ?? 'false'), false),
        requesterId,
        requesterKind: (req as { user?: unknown }).user ? 'session' : 'bearer',
      });

      if (!result.ok) {
        const statusCode = result.errorCode === 'VAULT_PATH_REQUIRED' ? 503 : 500;
        return res.status(statusCode).json({ ok: false, result });
      }

      const statusCode = result.remediation?.completion === 'queued' ? 202 : 201;
      return res.status(statusCode).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/hermes-runtime/chat-note', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    try {
      const requesterId = toStringParam((req as { user?: { id?: string } }).user?.id) || 'admin-route';
      const result = await createOpenJarvisHermesRuntimeChatNote({
        ...buildOpenJarvisAutopilotStatusParams(sanitizeRecord(req.body)),
        title: toStringParam(req.body?.title) || null,
        guildId: toStringParam(req.body?.guildId) || null,
        requesterId,
        requesterKind: (req as { user?: unknown }).user ? 'session' : 'bearer',
      });

      if (!result.ok) {
        const statusCode = result.errorCode === 'VAULT_PATH_REQUIRED' ? 503 : 500;
        return res.status(statusCode).json({ ok: false, result });
      }

      return res.status(201).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/hermes-runtime/queue-objective', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    try {
      const result = await enqueueOpenJarvisHermesRuntimeObjectives({
        ...buildOpenJarvisAutopilotStatusParams(sanitizeRecord(req.body)),
        objective: toStringParam(req.body?.objective) || null,
        objectives: toStringArrayParam(req.body?.objectives),
        ...(req.body?.replaceExisting !== undefined || req.body?.replace_existing !== undefined
          ? { replaceExisting: parseBool(String(req.body?.replaceExisting ?? req.body?.replace_existing ?? 'false'), false) }
          : {}),
      });

      if (!result.ok) {
        const statusCode = result.errorCode === 'VALIDATION'
          ? 400
          : result.errorCode === 'VAULT_PATH_REQUIRED'
            ? 503
            : 500;
        return res.status(statusCode).json({ ok: false, result });
      }

      return res.status(result.completion === 'updated' ? 201 : 200).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/hermes-runtime/chat-launch', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    try {
      const result = await launchOpenJarvisHermesChatSession({
        ...buildOpenJarvisAutopilotStatusParams(sanitizeRecord(req.body)),
        objective: toStringParam(req.body?.objective) || null,
        prompt: toStringParam(req.body?.prompt) || null,
        chatMode: toStringParam(req.body?.chatMode) || null,
        contextProfile: toStringParam(req.body?.contextProfile) || null,
        addFilePaths: toStringArrayParam(req.body?.addFilePaths),
        maximize: parseBool(String(req.body?.maximize ?? 'true'), true),
        newWindow: parseBool(String(req.body?.newWindow ?? 'false'), false),
        reuseWindow: parseBool(String(req.body?.reuseWindow ?? 'true'), true),
        dryRun: parseBool(String(req.body?.dryRun ?? 'false'), false),
      });

      if (!result.ok) {
        const statusCode = result.errorCode === 'VALIDATION'
          ? 400
          : ['CODE_CLI_MISSING', 'PACKET_PATH_MISSING'].includes(String(result.errorCode || ''))
            ? 503
            : 500;
        return res.status(statusCode).json({ ok: false, result });
      }

      return res.status(202).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/openjarvis/session-open-bundle', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || null;
    const userId = toStringParam(req.query?.userId) || null;
    const requestedPriority = toStringParam(req.query?.priority || req.query?.requestedPriority) || 'balanced';
    const requestedSkillId = toStringParam(req.query?.skillId || req.query?.requestedSkillId) || null;
    if ((guildId && !userId) || (!guildId && userId)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and userId must be provided together for personalization' });
    }

    try {
      const statusParams = buildOpenJarvisAutopilotStatusParams(sanitizeRecord(req.query));
      const personalizationSnapshot = guildId && userId
        ? await resolveAgentPersonalizationSnapshot({
          guildId,
          userId,
          requestedPriority,
          requestedSkillId,
        })
        : null;
      const bundle = await getOpenJarvisSessionOpenBundle({
        ...statusParams,
        personalizationSnapshot,
      });
      return res.json({ ok: true, bundle });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/memory-sync', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const dryRun = parseBool(String(req.body?.dryRun ?? 'true'), true);
    const force = parseBool(String(req.body?.force ?? 'false'), false);
    const guildId = toStringParam(req.body?.guildId) || undefined;

    try {
      const result = await runOpenJarvisMemorySync({
        dryRun,
        force,
        guildId,
      });
      if (!result.ok) {
        return res.status(500).json({ ok: false, result });
      }
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/memory-sync/managed', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const dryRun = parseBool(String(req.body?.dryRun ?? 'false'), false);
    const force = parseBool(String(req.body?.force ?? 'false'), false);
    const guildId = toStringParam(req.body?.guildId) || undefined;
    const agentName = toStringParam(req.body?.agentName || req.body?.agent_name) || undefined;
    const timeoutMs = toBoundedInt(req.body?.timeoutMs ?? req.body?.timeout_ms, 1_000, { min: 1_000, max: 10 * 60 * 1_000 }) || undefined;

    try {
      const result = await runOpenJarvisManagedMemoryMaintenance({
        dryRun,
        force,
        guildId,
        agentName,
        timeoutMs,
      });
      if (!result.ok) {
        return res.status(500).json({ ok: false, result });
      }
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/openjarvis/scheduler', requireAdmin, async (_req, res, next) => {
    try {
      const scheduler = await getOpenJarvisMemorySyncScheduleStatus();
      return res.json({ ok: true, scheduler });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/memory-sync/schedule', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const dryRun = parseBool(String(req.body?.dryRun ?? 'false'), false);
    const scheduleType = toStringParam(req.body?.scheduleType || req.body?.schedule_type) || undefined;
    const scheduleValue = toStringParam(req.body?.scheduleValue || req.body?.schedule_value) || undefined;
    const prompt = toStringParam(req.body?.prompt) || undefined;
    const agent = toStringParam(req.body?.agent) || undefined;
    const toolsRaw = Array.isArray(req.body?.tools)
      ? req.body.tools.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
      : toStringParam(req.body?.tools) || undefined;

    try {
      const result = await ensureOpenJarvisMemorySyncSchedule({
        dryRun,
        prompt,
        scheduleType,
        scheduleValue,
        agent,
        tools: toolsRaw,
      });
      if (!result.ok) {
        return res.status(500).json({ ok: false, result });
      }
      return res.status(result.completion === 'skipped' ? 200 : 201).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/scheduler/start', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const dryRun = parseBool(String(req.body?.dryRun ?? 'false'), false);
    const pollIntervalSeconds = toBoundedInt(req.body?.pollIntervalSeconds ?? req.body?.poll_interval_seconds, 60, { min: 5, max: 3600 }) || 60;

    try {
      const result = await startOpenJarvisSchedulerDaemon({
        dryRun,
        pollIntervalSeconds,
      });
      if (!result.ok) {
        return res.status(500).json({ ok: false, result });
      }
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/openjarvis/hermes-runtime/remediate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    try {
      const result = await runOpenJarvisHermesRuntimeRemediation({
        ...buildOpenJarvisAutopilotStatusParams(sanitizeRecord(req.body)),
        actionId: toStringParam(req.body?.actionId || req.body?.action_id) || null,
        dryRun: parseBool(String(req.body?.dryRun ?? 'false'), false),
        visibleTerminal: parseBool(String(req.body?.visibleTerminal ?? 'true'), true),
        autoLaunchQueuedChat: parseBool(String(req.body?.autoLaunchQueuedChat ?? 'false'), false),
      });

      if (!result.ok) {
        const statusCode = result.errorCode === 'VALIDATION'
          ? 400
          : result.errorCode === 'PACKET_PATH_MISSING'
            ? 503
            : 500;
        return res.status(statusCode).json({ ok: false, result });
      }

      return res.status(result.completion === 'queued' ? 202 : 200).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/hermes/vscode-bridge', requireAdmin, async (req, res, next) => {
    try {
      const status = getHermesVsCodeBridgeStatus({
        packetPath: toStringParam(req.query?.packetPath) || null,
        codeCliPath: toStringParam(req.query?.codeCliPath) || null,
        vaultPath: toStringParam(req.query?.vaultPath) || null,
      });
      return res.json({ ok: true, status });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/hermes/vscode-bridge', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    try {
      const result = await runHermesVsCodeBridge({
        action: toStringParam(req.body?.action),
        filePath: toStringParam(req.body?.filePath) || null,
        targetPath: toStringParam(req.body?.targetPath) || null,
        leftPath: toStringParam(req.body?.leftPath) || null,
        rightPath: toStringParam(req.body?.rightPath) || null,
        line: toOptionalBoundedInt(req.body?.line, 200_000),
        column: toOptionalBoundedInt(req.body?.column, 5_000),
        reason: toStringParam(req.body?.reason) || null,
        packetPath: toStringParam(req.body?.packetPath) || null,
        codeCliPath: toStringParam(req.body?.codeCliPath) || null,
        vaultPath: toStringParam(req.body?.vaultPath) || null,
        prompt: toStringParam(req.body?.prompt) || null,
        chatMode: toStringParam(req.body?.chatMode) || null,
        addFilePaths: toStringArrayParam(req.body?.addFilePaths),
        maximize: parseBool(String(req.body?.maximize ?? 'false'), false),
        newWindow: parseBool(String(req.body?.newWindow ?? 'false'), false),
        reuseWindow: parseBool(String(req.body?.reuseWindow ?? 'true'), true),
        dryRun: parseBool(String(req.body?.dryRun ?? 'false'), false),
      });

      if (!result.ok) {
        const statusCode = result.errorCode === 'VALIDATION'
          ? 400
          : ['CODE_CLI_MISSING', 'PACKET_PATH_MISSING', 'PACKET_NOT_FOUND'].includes(String(result.errorCode || ''))
            ? 503
            : 500;
        return res.status(statusCode).json({ ok: false, result });
      }

      return res.status(result.completion === 'queued' ? 202 : 200).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });
}