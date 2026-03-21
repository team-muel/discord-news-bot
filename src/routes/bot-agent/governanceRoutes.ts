import { requireAdmin } from '../../middleware/auth';
import { listAgentRoleWorkerSpecs } from '../../services/agentRoleWorkerService';
import { getAction, listActions } from '../../services/skills/actions/registry';
import { decideActionApprovalRequest, isActionRunMode, listActionApprovalRequests, listGuildActionPolicies, upsertGuildActionPolicy } from '../../services/skills/actionGovernanceStore';
import { getOpencodeExecutionSummary } from '../../services/opencodeOpsService';
import { normalizeActionInput, normalizeActionResult, toWorkerExecutionError } from '../../services/workerExecution';
import {
  createOpencodeChangeRequest,
  decideOpencodeChangeRequest,
  enqueueOpencodePublishJob,
  isOpencodeChangeRequestStatus,
  isOpencodePublishJobStatus,
  listOpencodeChangeRequests,
  listOpencodePublishJobs,
  summarizeOpencodeQueueReadiness,
  type OpencodeRiskTier,
} from '../../services/opencodeGitHubQueueService';
import { isOneOf, toBoundedInt, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

const ADVISORY_ACTION_WORKER_IDS: Record<string, 'local-orchestrator' | 'opendev' | 'nemoclaw' | 'openjarvis'> = {
  'local.orchestrator.all': 'local-orchestrator',
  'local.orchestrator.route': 'local-orchestrator',
  'coordinate.all': 'local-orchestrator',
  'coordinate.route': 'local-orchestrator',
  'opendev.plan': 'opendev',
  'architect.plan': 'opendev',
  'nemoclaw.review': 'nemoclaw',
  'review.review': 'nemoclaw',
  'openjarvis.ops': 'openjarvis',
  'operate.ops': 'openjarvis',
  'implement.execute': 'openjarvis',
  'tools.run.cli': 'openjarvis',
};

const inferActionRole = (actionName: string): 'openjarvis' | 'opencode' | 'nemoclaw' | 'opendev' => {
  const normalized = String(actionName || '').trim().toLowerCase();
  if (normalized.startsWith('opencode.') || normalized.startsWith('implement.')) {
    return 'opencode';
  }
  if (normalized.startsWith('nemoclaw.') || normalized.startsWith('review.') || normalized.startsWith('news.') || normalized.startsWith('web.') || normalized.startsWith('youtube.') || normalized.startsWith('community.')) {
    return 'nemoclaw';
  }
  if (normalized.startsWith('opendev.') || normalized.startsWith('architect.') || normalized.startsWith('db.') || normalized.startsWith('code.') || normalized.startsWith('rag.')) {
    return 'opendev';
  }
  return 'openjarvis';
};

const toCatalogEntry = (action: ReturnType<typeof listActions>[number], policy?: Awaited<ReturnType<typeof listGuildActionPolicies>>[number]) => {
  const workerId = ADVISORY_ACTION_WORKER_IDS[action.name];
  const workerSpec = workerId ? listAgentRoleWorkerSpecs().find((item) => item.id === workerId) || null : null;

  return {
    name: action.name,
    description: action.description,
    agentRole: inferActionRole(action.name),
    advisoryWorker: workerSpec,
    policy: policy || null,
  };
};

export function registerBotAgentGovernanceRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;

  router.get('/agent/actions/catalog', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || null;
    const [actionCatalog, savedPolicies] = await Promise.all([
      Promise.resolve(listActions()),
      guildId ? listGuildActionPolicies(guildId) : Promise.resolve([]),
    ]);

    const policyMap = new Map(savedPolicies.map((item) => [item.actionName, item]));

    return res.json({
      ok: true,
      guildId,
      actions: actionCatalog.map((action) => toCatalogEntry(action, policyMap.get(action.name))),
      advisoryWorkers: listAgentRoleWorkerSpecs(),
    });
  });

  router.get('/agent/actions/policies', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ error: 'guildId is required' });
    }

    const [savedPolicies, actionCatalog] = await Promise.all([
      listGuildActionPolicies(guildId),
      Promise.resolve(listActions()),
    ]);

    return res.json({
      guildId,
      actions: actionCatalog.map((action) => action.name),
      policies: savedPolicies,
    });
  });

  router.put('/agent/actions/policies', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const actionName = toStringParam(req.body?.actionName);
    const runMode = toStringParam(req.body?.runMode) || 'auto';
    const enabledRaw = req.body?.enabled;
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : String(enabledRaw || '').trim() !== 'false';

    if (!guildId || !actionName) {
      return res.status(400).json({ error: 'guildId and actionName are required' });
    }

    if (!listActions().some((action) => action.name === actionName)) {
      return res.status(400).json({ error: 'unknown actionName' });
    }

    if (!isActionRunMode(runMode)) {
      return res.status(400).json({ error: 'invalid runMode (auto|approval_required|disabled)' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const policy = await upsertGuildActionPolicy({
        guildId,
        actionName,
        enabled,
        runMode,
        actorId,
      });
      return res.json({ ok: true, policy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'ACTION_POLICY_UPDATE_FAILED', message });
    }
  });

  router.get('/agent/actions/approvals', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const statusValue = toStringParam(req.query?.status) as 'pending' | 'approved' | 'rejected' | 'expired' | '';
    const limit = toBoundedInt(req.query?.limit, 30, { min: 1, max: 200 });

    if (!guildId) {
      return res.status(400).json({ error: 'guildId is required' });
    }

    if (statusValue && !isOneOf(statusValue, ['pending', 'approved', 'rejected', 'expired'])) {
      return res.status(400).json({ error: 'invalid status' });
    }

    const items = await listActionApprovalRequests({
      guildId,
      status: statusValue || undefined,
      limit,
    });

    return res.json({ ok: true, items });
  });

  router.post('/agent/actions/execute', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const actionName = toStringParam(req.body?.actionName);
    const goal = toStringParam(req.body?.goal);
    const guildId = toStringParam(req.body?.guildId) || undefined;
    const requestedBy = toStringParam(req.user?.id) || toStringParam(req.body?.requestedBy) || 'api';
    const rawArgs = req.body?.args;
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? rawArgs as Record<string, unknown>
      : {};

    if (!actionName || !goal) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'actionName and goal are required' });
    }

    const action = getAction(actionName);
    if (!action) {
      return res.status(400).json({ ok: false, error: 'UNKNOWN_ACTION', message: `unknown actionName: ${actionName}` });
    }

    try {
      const input = normalizeActionInput({
        actionName,
        input: {
          goal,
          args,
          guildId,
          requestedBy,
        },
      });
      const result = await action.execute(input);
      const normalized = normalizeActionResult({ actionName, result });
      return res.status(normalized.ok ? 200 : 200).json({
        ok: normalized.ok,
        action: toCatalogEntry(action),
        result: normalized,
      });
    } catch (error) {
      const workerError = toWorkerExecutionError(error);
      return res.status(500).json({
        ok: false,
        error: workerError.code,
        message: workerError.message,
        retryable: workerError.retryable,
        meta: workerError.meta || null,
      });
    }
  });

  router.post('/agent/actions/approvals/:requestId/decision', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const requestId = toStringParam(req.params.requestId);
    const decision = toStringParam(req.body?.decision);
    const reason = toStringParam(req.body?.reason);

    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required' });
    }

    if (!isOneOf(decision, ['approve', 'reject'])) {
      return res.status(400).json({ error: 'decision must be approve|reject' });
    }

    const actorId = toStringParam(req.user?.id) || 'api';
    const updated = await decideActionApprovalRequest({
      requestId,
      decision: decision as 'approve' | 'reject',
      actorId,
      reason: reason || undefined,
    });

    if (!updated) {
      return res.status(404).json({ ok: false, error: 'REQUEST_NOT_FOUND' });
    }

    return res.json({ ok: true, request: updated });
  });

  router.post('/agent/opencode/bootstrap-policy', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const runMode = toStringParam(req.body?.runMode) || 'approval_required';
    const enabledRaw = req.body?.enabled;
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : String(enabledRaw || '').trim() !== 'false';

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!isActionRunMode(runMode)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'runMode must be auto|approval_required|disabled' });
    }
    if (!listActions().some((action) => action.name === 'opencode.execute')) {
      return res.status(500).json({ ok: false, error: 'CONFIG', message: 'opencode.execute action is not registered' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const policy = await upsertGuildActionPolicy({
        guildId,
        actionName: 'opencode.execute',
        enabled,
        runMode,
        actorId,
      });
      return res.status(202).json({ ok: true, policy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'OPENCODE_POLICY_BOOTSTRAP_FAILED', message });
    }
  });

  router.get('/agent/self-growth/policy', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    const policies = await listGuildActionPolicies(guildId);
    const opencodePolicy = policies.find((item) => item.actionName === 'opencode.execute') || null;
    const effectiveRunMode = opencodePolicy?.runMode || 'approval_required';
    const profile = effectiveRunMode === 'auto'
      ? 'conditional_auto'
      : effectiveRunMode === 'disabled'
        ? 'disabled'
        : 'human_gate';

    return res.json({
      ok: true,
      guildId,
      profile,
      effective: {
        actionName: 'opencode.execute',
        runMode: effectiveRunMode,
        enabled: opencodePolicy?.enabled ?? true,
      },
      note: 'self-growth profile currently controls opencode.execute governance mode',
    });
  });

  router.post('/agent/self-growth/policy/apply', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const profile = toStringParam(req.body?.profile || req.query?.profile).toLowerCase();
    if (!guildId || !isOneOf(profile, ['human_gate', 'conditional_auto', 'disabled'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and profile(human_gate|conditional_auto|disabled) are required' });
    }

    const runMode = profile === 'conditional_auto'
      ? 'auto'
      : profile === 'disabled'
        ? 'disabled'
        : 'approval_required';

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const policy = await upsertGuildActionPolicy({
        guildId,
        actionName: 'opencode.execute',
        enabled: profile !== 'disabled',
        runMode,
        actorId,
      });
      return res.status(202).json({ ok: true, guildId, profile, policy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'SELF_GROWTH_POLICY_APPLY_FAILED', message });
    }
  });

  router.get('/agent/opencode/summary', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 7, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const summary = await getOpencodeExecutionSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is invalid' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_SUMMARY_FAILED', message });
    }
  });

  router.post('/agent/opencode/change-requests', requireAdmin, adminActionRateLimiter, opencodeIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const title = toStringParam(req.body?.title);
    const riskTierRaw = toStringParam(req.body?.riskTier).toLowerCase();
    if (!guildId || !title) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and title are required' });
    }
    if (riskTierRaw && !isOneOf(riskTierRaw, ['low', 'medium', 'high', 'critical'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'riskTier must be low|medium|high|critical' });
    }

    try {
      const requestedBy = toStringParam(req.user?.id) || 'api';
      const created = await createOpencodeChangeRequest({
        guildId,
        requestedBy,
        title,
        summary: toStringParam(req.body?.summary) || undefined,
        targetBaseBranch: toStringParam(req.body?.targetBaseBranch) || undefined,
        proposedBranch: toStringParam(req.body?.proposedBranch) || undefined,
        sourceActionLogId: Number(req.body?.sourceActionLogId),
        riskTier: (riskTierRaw || undefined) as OpencodeRiskTier | undefined,
        scoreCard: req.body?.scoreCard && typeof req.body.scoreCard === 'object' && !Array.isArray(req.body.scoreCard)
          ? req.body.scoreCard as Record<string, unknown>
          : undefined,
        evidenceBundleId: toStringParam(req.body?.evidenceBundleId) || undefined,
        files: Array.isArray(req.body?.files)
          ? req.body.files.map((item: unknown) => toStringParam(item)).filter(Boolean)
          : undefined,
        diffPatch: toStringParam(req.body?.diffPatch) || undefined,
        metadata: req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
          ? req.body.metadata as Record<string, unknown>
          : undefined,
      });
      return res.status(201).json({ ok: true, item: created });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid payload' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_CHANGE_REQUEST_CREATE_FAILED', message });
    }
  });

  router.get('/agent/opencode/change-requests', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const statusRaw = toStringParam(req.query?.status).toLowerCase();
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (statusRaw && !isOpencodeChangeRequestStatus(statusRaw)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid status' });
    }

    try {
      const items = await listOpencodeChangeRequests({
        guildId,
        status: statusRaw ? (statusRaw as 'draft' | 'review_pending' | 'approved' | 'rejected' | 'queued_for_publish' | 'published' | 'failed') : undefined,
        limit,
      });
      return res.json({ ok: true, items, count: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_CHANGE_REQUEST_LIST_FAILED', message });
    }
  });

  router.post('/agent/opencode/change-requests/:changeRequestId/decision', requireAdmin, adminActionRateLimiter, opencodeIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const changeRequestId = toBoundedInt(req.params.changeRequestId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const decision = toStringParam(req.body?.decision).toLowerCase();

    if (!guildId || changeRequestId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and changeRequestId are required' });
    }
    if (!isOneOf(decision, ['approve', 'reject', 'published', 'failed'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'decision must be approve|reject|published|failed' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const updated = await decideOpencodeChangeRequest({
        guildId,
        changeRequestId,
        decision: decision as 'approve' | 'reject' | 'published' | 'failed',
        actorId,
        note: toStringParam(req.body?.note) || undefined,
        publishUrl: toStringParam(req.body?.publishUrl) || undefined,
      });
      return res.json({ ok: true, item: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'OPENCODE_CHANGE_REQUEST_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_CHANGE_REQUEST_DECIDE_FAILED', message });
    }
  });

  router.post('/agent/opencode/change-requests/:changeRequestId/queue-publish', requireAdmin, adminActionRateLimiter, opencodeIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const changeRequestId = toBoundedInt(req.params.changeRequestId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (!guildId || changeRequestId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and changeRequestId are required' });
    }

    try {
      const requestedBy = toStringParam(req.user?.id) || 'api';
      const payload = req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload)
        ? req.body.payload as Record<string, unknown>
        : undefined;
      const job = await enqueueOpencodePublishJob({
        guildId,
        changeRequestId,
        requestedBy,
        provider: toStringParam(req.body?.provider) || undefined,
        payload,
      });
      const deduplicated = Boolean((job as Record<string, unknown>).deduplicated);
      return res.status(202).json({ ok: true, job, deduplicated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'OPENCODE_CHANGE_REQUEST_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'OPENCODE_CHANGE_REQUEST_NOT_APPROVED') {
        return res.status(409).json({ ok: false, error: 'CONFLICT', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_PUBLISH_QUEUE_ENQUEUE_FAILED', message });
    }
  });

  router.get('/agent/opencode/publish-queue', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const statusRaw = toStringParam(req.query?.status).toLowerCase();
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (statusRaw && !isOpencodePublishJobStatus(statusRaw)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid status' });
    }

    try {
      const items = await listOpencodePublishJobs({
        guildId,
        status: statusRaw ? (statusRaw as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled') : undefined,
        limit,
      });
      return res.json({ ok: true, items, count: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_PUBLISH_QUEUE_LIST_FAILED', message });
    }
  });

  router.get('/agent/opencode/readiness', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const readiness = await summarizeOpencodeQueueReadiness({ guildId });
      return res.json({ ok: true, readiness });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_READINESS_FAILED', message });
    }
  });

}

