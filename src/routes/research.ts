import { Router } from 'express';
import type { ResolvedResearchPreset } from '../contracts/researchPreset';
import { requireAdmin, requireAuth } from '../middleware/auth';
import {
  getPreset,
  getPresetHistory,
  isResearchPresetKey,
  restorePresetFromHistory,
  upsertPreset,
} from '../services/researchPresetStore';
import { toBoundedInt, toStringParam } from '../utils/validation';

export function createResearchRouter(): Router {
  const router = Router();

  router.get('/preset/:presetKey', (req, res) => {
    const key = toStringParam(req.params.presetKey);
    if (!isResearchPresetKey(key)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json({ preset: getPreset(key) });
  });

  router.get('/preset/:presetKey/history', requireAuth, (req, res) => {
    const key = toStringParam(req.params.presetKey);
    if (!isResearchPresetKey(key)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const limit = toBoundedInt(req.query.limit, 20, { min: 1, max: 100 });

    return res.json({ history: getPresetHistory(key, limit) });
  });

  router.post('/preset/:presetKey', requireAdmin, (req, res) => {
    const key = toStringParam(req.params.presetKey);
    if (!isResearchPresetKey(key)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const payload = req.body?.payload as ResolvedResearchPreset | undefined;
    if (!payload || typeof payload !== 'object') {
      return res.status(422).json({ error: 'INVALID_PAYLOAD' });
    }

    const preset = upsertPreset({
      key,
      payload,
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      source: 'api',
    });

    return res.json({ preset });
  });

  router.post('/preset/:presetKey/restore/:historyId', requireAdmin, (req, res) => {
    const key = toStringParam(req.params.presetKey);
    if (!isResearchPresetKey(key)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const result = restorePresetFromHistory({
      key,
      historyId: toStringParam(req.params.historyId),
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
    });

    if (!result) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json({ preset: result.preset, restored: result.restored });
  });

  return router;
}
