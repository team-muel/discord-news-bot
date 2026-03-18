import { requireAdmin, requireAuth } from '../../middleware/auth';
import { getAgentPrivacyPolicySnapshot, upsertAgentPrivacyPolicy } from '../../services/agentPrivacyPolicyService';
import { buildPrivacyTuningRecommendation, listPrivacyGateSamples, reviewPrivacyGateSample } from '../../services/agentPrivacyTuningService';
import { isUserAdmin } from '../../services/adminAllowlistService';
import { forgetGuildRagData, forgetUserRagData, previewForgetGuildRagData, previewForgetUserRagData } from '../../services/privacyForgetService';
import { getObsidianAdapterRuntimeStatus } from '../../services/obsidian/router';
import { getLatestObsidianGraphAuditSnapshot } from '../../services/obsidianQualityService';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { getAgentAnswerQualityReviewSummary, listAgentAnswerQualityReviews, recordAgentAnswerQualityReview } from '../../services/agentQualityReviewService';
import { isOneOf, toBoundedInt, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentQualityPrivacyRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;

  router.post('/agent/quality/reviews', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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
        labelConfidence: Number(req.body?.labelConfidence),
        reviewNote: toStringParam(req.body?.reviewNote) || undefined,
      });
      return res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_QUALITY_REVIEW_INSERT_FAILED', message });
    }
  });

  router.get('/agent/quality/reviews', requireAdmin, async (req, res) => {
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
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_QUALITY_REVIEW_LIST_FAILED', message });
    }
  });

  router.get('/agent/quality/reviews/summary', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const summary = await getAgentAnswerQualityReviewSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_QUALITY_REVIEW_SUMMARY_FAILED', message });
    }
  });

  router.get('/agent/privacy/policy', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || '*';
    const policy = getAgentPrivacyPolicySnapshot(guildId);
    return res.json({ guildId, policy });
  });

  router.put('/agent/privacy/policy', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_POLICY_UPSERT_FAILED', message });
    }
  });

  router.get('/agent/privacy/tuning/samples', requireAdmin, async (req, res) => {
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
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_TUNING_SAMPLES_FAILED', message });
    }
  });

  router.post('/agent/privacy/tuning/samples/:sampleId/review', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_TUNING_REVIEW_FAILED', message });
    }
  });

  router.get('/agent/privacy/tuning/recommendation', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const lookbackDays = toBoundedInt(req.query?.lookbackDays, 7, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const recommendation = await buildPrivacyTuningRecommendation({ guildId, lookbackDays });
      return res.json({ ok: true, recommendation });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_TUNING_RECOMMENDATION_FAILED', message });
    }
  });

  router.get('/agent/obsidian/runtime', requireAdmin, async (_req, res) => {
    return res.json({
      vaultPathConfigured: Boolean(getObsidianVaultRoot()),
      adapterRuntime: getObsidianAdapterRuntimeStatus(),
    });
  });

  router.get('/agent/obsidian/quality', requireAdmin, async (_req, res) => {
    const snapshot = await getLatestObsidianGraphAuditSnapshot();
    return res.json({
      vaultPathConfigured: Boolean(getObsidianVaultRoot()),
      snapshot,
    });
  });

  router.post('/agent/privacy/forget-user', requireAuth, adminActionRateLimiter, opencodeIdempotency, async (req, res) => {
    const requester = toStringParam(req.user?.id) || '';
    const targetUserId = toStringParam(req.body?.userId) || requester;
    const guildId = toStringParam(req.body?.guildId) || undefined;
    const confirm = toStringParam(req.body?.confirm);
    const deleteObsidian = req.body?.deleteObsidian !== false;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
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
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message === 'USER_ID_REQUIRED') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      return res.status(500).json({ ok: false, error: 'FORGET_USER_FAILED', message });
    }
  });

  router.post('/agent/privacy/forget-guild', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message === 'GUILD_ID_REQUIRED') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      return res.status(500).json({ ok: false, error: 'FORGET_GUILD_FAILED', message });
    }
  });

  router.get('/agent/privacy/forget-preview', requireAuth, async (req, res) => {
    const scope = toStringParam(req.query?.scope) || 'user';
    const requester = toStringParam(req.user?.id) || '';
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const userId = toStringParam(req.query?.userId) || requester;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
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
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'FORGET_PREVIEW_FAILED', message });
    }
  });

}

