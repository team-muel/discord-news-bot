import { requireAdmin, requireAuth } from '../../middleware/auth';
import { getUserConsentSnapshot, upsertUserConsentSnapshot } from '../../services/agent/agentConsentService';
import { getAgentPrivacyPolicySnapshot, upsertAgentPrivacyPolicy } from '../../services/agent/agentPrivacyPolicyService';
import { buildPrivacyTuningRecommendation, listPrivacyGateSamples, reviewPrivacyGateSample } from '../../services/agent/agentPrivacyTuningService';
import { isUserAdmin } from '../../services/adminAllowlistService';
import { getAgentRetentionPolicySnapshot, upsertAgentRetentionPolicy } from '../../services/agent/agentRetentionPolicyService';
import { forgetGuildRagData, forgetUserRagData, previewForgetGuildRagData, previewForgetUserRagData } from '../../services/privacyForgetService';
import { getObsidianAdapterRuntimeStatus, getObsidianVaultLiveHealthStatus, readObsidianFileWithAdapter } from '../../services/obsidian/router';
import { getObsidianInboxChatLoopStats } from '../../services/obsidian/obsidianInboxChatLoopService';
import { getLatestObsidianGraphAuditSnapshot } from '../../services/obsidian/obsidianQualityService';
import { buildObsidianKnowledgeReflectionBundle, getObsidianKnowledgeCompilationStats, getObsidianKnowledgeControlSurface, resolveObsidianKnowledgeArtifactPath } from '../../services/obsidian/knowledgeCompilerService';
import { getObsidianRetrievalBoundarySnapshot } from '../../services/obsidian/obsidianRagService';
import { getObsidianVaultRoot, getObsidianVaultRuntimeInfo } from '../../utils/obsidianEnv';
import { getAgentAnswerQualityReviewSummary, listAgentAnswerQualityReviews, recordAgentAnswerQualityReview } from '../../services/agent/agentQualityReviewService';
import { isOneOf, toBoundedInt, toFiniteNumber, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentQualityPrivacyRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;

  router.post('/agent/quality/reviews', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId);
    const reviewerId = toStringParam(req.body?.reviewerId);
    const strategyRaw = String(req.body?.strategy || '').trim().toLowerCase();
    const strategy = strategyRaw === 'got' || strategyRaw === 'tot' ? strategyRaw : 'baseline';
    const isHallucination = req.body?.isHallucination === true;
    if (!guildId || !reviewerId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and reviewerId are required' });
    }

    try {
      await recordAgentAnswerQualityReview({
        guildId,
        reviewerId,
        strategy,
        isHallucination,
        sessionId: toStringParam(req.body?.sessionId) || undefined,
        question: toStringParam(req.body?.question) || undefined,
        answerExcerpt: toStringParam(req.body?.answerExcerpt) || undefined,
        labelConfidence: toFiniteNumber(req.body?.labelConfidence, 0),
        reviewNote: toStringParam(req.body?.reviewNote) || undefined,
      });
      return res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/quality/reviews', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const rows = await listAgentAnswerQualityReviews({ guildId, days, limit });
      return res.json({ ok: true, rows, count: rows.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/quality/reviews/summary', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const summary = await getAgentAnswerQualityReviewSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/privacy/policy', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || '*';
    const policy = getAgentPrivacyPolicySnapshot(guildId);
    return res.json({ guildId, policy });
  });

  router.get('/agent/privacy/consent', requireAuth, async (req, res, next) => {
    const requester = toStringParam(req.user?.id) || '';
    const guildId = toStringParam(req.query?.guildId);
    const targetUserId = toStringParam(req.query?.userId) || requester;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    const admin = await isUserAdmin(requester);
    if (targetUserId !== requester && !admin) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'only admin can query other users' });
    }

    const consent = await getUserConsentSnapshot({ guildId, userId: targetUserId });
    return res.json({ ok: true, consent });
  });

  router.put('/agent/privacy/consent', requireAuth, adminActionRateLimiter, opencodeIdempotency, async (req, res, next) => {
    const requester = toStringParam(req.user?.id) || '';
    const guildId = toStringParam(req.body?.guildId);
    const targetUserId = toStringParam(req.body?.userId) || requester;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    const admin = await isUserAdmin(requester);
    if (targetUserId !== requester && !admin) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'only admin can update other users' });
    }

    try {
      const consent = await upsertUserConsentSnapshot({
        guildId,
        userId: targetUserId,
        memoryEnabled: typeof req.body?.memoryEnabled === 'boolean' ? req.body.memoryEnabled : undefined,
        socialGraphEnabled: typeof req.body?.socialGraphEnabled === 'boolean' ? req.body.socialGraphEnabled : undefined,
        profilingEnabled: typeof req.body?.profilingEnabled === 'boolean' ? req.body.profilingEnabled : undefined,
        actionAuditDisclosureEnabled: typeof req.body?.actionAuditDisclosureEnabled === 'boolean' ? req.body.actionAuditDisclosureEnabled : undefined,
        updatedBy: requester,
      });
      return res.json({ ok: true, consent });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/privacy/retention-policy', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || '*';
    const policy = await getAgentRetentionPolicySnapshot(guildId);
    return res.json({ ok: true, policy });
  });

  router.put('/agent/privacy/retention-policy', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId) || '*';
    try {
      const updatedBy = toStringParam(req.user?.id) || 'api';
      const policy = await upsertAgentRetentionPolicy({
        guildId,
        actionLogDays: req.body?.actionLogDays,
        memoryDays: req.body?.memoryDays,
        socialGraphDays: req.body?.socialGraphDays,
        conversationDays: req.body?.conversationDays,
        approvalRequestDays: req.body?.approvalRequestDays,
        updatedBy,
      });
      return res.json({ ok: true, policy });
    } catch (error) {
      next(error);
    }
  });

  router.put('/agent/privacy/policy', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId) || '*';
    const modeDefault = toStringParam(req.body?.modeDefault) as 'direct' | 'plan_act' | 'deliberate' | 'guarded';
    const reviewScore = toBoundedInt(req.body?.reviewScore, 60, { min: 0, max: 100 });
    const blockScore = toBoundedInt(req.body?.blockScore, 80, { min: 0, max: 100 });
    const reviewPatterns = Array.isArray(req.body?.reviewPatterns) ? req.body.reviewPatterns : [];
    const blockPatterns = Array.isArray(req.body?.blockPatterns) ? req.body.blockPatterns : [];

    if (!isOneOf(modeDefault, ['direct', 'plan_act', 'deliberate', 'guarded'])) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'modeDefault invalid' });
    }
    if (blockScore <= reviewScore) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'blockScore must be greater than reviewScore' });
    }

    try {
      const updatedBy = toStringParam(req.user?.id) || 'api';
      const row = await upsertAgentPrivacyPolicy({
        guildId,
        modeDefault,
        reviewScore,
        blockScore,
        reviewPatterns,
        blockPatterns,
        enabled: req.body?.enabled !== false,
        updatedBy,
      });
      return res.json({ ok: true, policy: row });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/privacy/tuning/samples', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    const status = toStringParam(req.query?.status) as 'reviewed' | 'unreviewed' | '';
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (status && !isOneOf(status, ['reviewed', 'unreviewed'])) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'status must be reviewed|unreviewed' });
    }

    try {
      const items = await listPrivacyGateSamples({ guildId, limit, status: status || undefined });
      return res.json({ ok: true, items });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/privacy/tuning/samples/:sampleId/review', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const sampleId = toBoundedInt(req.params.sampleId, 0, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const expectedDecision = toStringParam(req.body?.expectedDecision) as 'allow' | 'review' | 'block';
    if (!isOneOf(expectedDecision, ['allow', 'review', 'block'])) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'expectedDecision must be allow|review|block' });
    }

    try {
      const reviewedBy = toStringParam(req.user?.id) || 'api';
      const row = await reviewPrivacyGateSample({
        sampleId,
        expectedDecision,
        reviewedBy,
        note: toStringParam(req.body?.note) || undefined,
      });
      return res.json({ ok: true, sample: row });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/privacy/tuning/recommendation', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const lookbackDays = toBoundedInt(req.query?.lookbackDays, 7, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const recommendation = await buildPrivacyTuningRecommendation({ guildId, lookbackDays });
      return res.json({ ok: true, recommendation });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/obsidian/runtime', requireAdmin, async (_req, res, next) => {
    try {
      const [vaultHealth, retrievalBoundary] = await Promise.all([
        getObsidianVaultLiveHealthStatus(),
        getObsidianRetrievalBoundarySnapshot(),
      ]);
      return res.json({
        vaultPathConfigured: Boolean(getObsidianVaultRoot()),
        vault: getObsidianVaultRuntimeInfo(),
        adapterRuntime: getObsidianAdapterRuntimeStatus(),
        vaultHealth,
        cacheStats: retrievalBoundary.supabaseBacked.cacheStats,
        compiler: getObsidianKnowledgeCompilationStats(),
        inboxChatLoop: getObsidianInboxChatLoopStats(),
        retrievalBoundary,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/obsidian/quality', requireAdmin, async (_req, res, next) => {
    const snapshot = await getLatestObsidianGraphAuditSnapshot();
    return res.json({
      vaultPathConfigured: Boolean(getObsidianVaultRoot()),
      vault: getObsidianVaultRuntimeInfo(),
      snapshot,
    });
  });

  router.get('/agent/obsidian/knowledge-control', requireAdmin, async (req, res, next) => {
    const artifactRequest = toStringParam(req.query?.artifact);
    const bundleRequest = toStringParam(req.query?.bundleFor);

    try {
      let artifact: { request: string; path: string; content: string | null } | null = null;
      let bundle = null;
      if (artifactRequest) {
        const artifactPath = resolveObsidianKnowledgeArtifactPath(artifactRequest);
        if (!artifactPath) {
          return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'artifact must be index|log|lint|blueprint|canonical-map|cadence|gate-entrypoints|topic:<slug>|entity:<slug>' });
        }

        artifact = {
          request: artifactRequest,
          path: artifactPath,
          content: await readObsidianFileWithAdapter({
            vaultPath: getObsidianVaultRoot() || '',
            filePath: artifactPath,
          }),
        };
      }

      if (bundleRequest) {
        bundle = buildObsidianKnowledgeReflectionBundle(bundleRequest);
        if (!bundle) {
          return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'bundleFor must be a control-tower alias or vault-relative path' });
        }
      }

      return res.json({
        vaultPathConfigured: Boolean(getObsidianVaultRoot()),
        vault: getObsidianVaultRuntimeInfo(),
        ...getObsidianKnowledgeControlSurface(),
        artifact,
        bundle,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/privacy/forget-user', requireAuth, adminActionRateLimiter, opencodeIdempotency, async (req, res, next) => {
    const requester = toStringParam(req.user?.id) || '';
    const targetUserId = toStringParam(req.body?.userId) || requester;
    const guildId = toStringParam(req.body?.guildId) || undefined;
    const confirm = toStringParam(req.body?.confirm);
    const deleteObsidian = req.body?.deleteObsidian !== false;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (!targetUserId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'userId is required' });
    }

    const admin = await isUserAdmin(requester);
    if (targetUserId !== requester && !admin) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'only admin can erase other users' });
    }

    const expectedConfirm = targetUserId === requester ? 'FORGET_USER' : 'FORGET_USER_ADMIN';
    if (confirm !== expectedConfirm) {
      return res.status(400).json({
        ok: false,
        error: 'VALIDATION',
        message: `confirm must be ${expectedConfirm}`,
      });
    }

    try {
      const result = await forgetUserRagData({
        userId: targetUserId,
        guildId,
        requestedBy: requester,
        reason: toStringParam(req.body?.reason) || 'api:forget-user',
        deleteObsidian,
      });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/privacy/forget-guild', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId);
    const confirm = toStringParam(req.body?.confirm);
    const requester = toStringParam(req.user?.id) || 'api';
    const deleteObsidian = req.body?.deleteObsidian !== false;

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (confirm !== 'FORGET_GUILD') {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'confirm must be FORGET_GUILD' });
    }

    try {
      const result = await forgetGuildRagData({
        guildId,
        requestedBy: requester,
        reason: toStringParam(req.body?.reason) || 'api:forget-guild',
        deleteObsidian,
      });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/privacy/forget-preview', requireAuth, async (req, res, next) => {
    const scope = toStringParam(req.query?.scope) || 'user';
    const requester = toStringParam(req.user?.id) || '';
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const userId = toStringParam(req.query?.userId) || requester;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    try {
      if (scope === 'guild') {
        if (!guildId) {
          return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required for guild scope' });
        }
        const admin = await isUserAdmin(requester);
        if (!admin) {
          return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'admin required for guild scope preview' });
        }
        const preview = await previewForgetGuildRagData(guildId);
        return res.json({ ok: true, preview });
      }

      const admin = await isUserAdmin(requester);
      if (userId !== requester && !admin) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'only admin can preview other users' });
      }
      const preview = await previewForgetUserRagData({ userId, guildId });
      return res.json({ ok: true, preview });
    } catch (error) {
      next(error);
    }
  });

}

