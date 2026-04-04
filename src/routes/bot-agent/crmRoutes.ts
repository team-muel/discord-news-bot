import { requireAdmin } from '../../middleware/auth';
import {
  getUserProfile,
  getGuildMembership,
  getUserCrmSnapshot,
  getGuildLeaderboard,
  updateUserProfileMeta,
} from '../../services/discord-support/userCrmService';
import { toStringParam } from '../../utils/validation';
import { BotAgentRouteDeps } from './types';

export function registerBotAgentCrmRoutes(deps: BotAgentRouteDeps): void {
  const { router } = deps;

  // GET /agent/crm/user?userId=...&guildId=...
  router.get('/agent/crm/user', requireAdmin, async (req, res) => {
    const userId = toStringParam(req.query?.userId);
    const guildId = toStringParam(req.query?.guildId) || undefined;
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'userId is required' });
    }

    try {
      const snapshot = await getUserCrmSnapshot(userId, guildId);
      if (!snapshot) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'User not found' });
      }
      return res.json({ ok: true, data: snapshot });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to fetch user CRM data' });
    }
  });

  // GET /agent/crm/profile?userId=...
  router.get('/agent/crm/profile', requireAdmin, async (req, res) => {
    const userId = toStringParam(req.query?.userId);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'userId is required' });
    }

    try {
      const profile = await getUserProfile(userId);
      if (!profile) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Profile not found' });
      }
      return res.json({ ok: true, data: profile });
    } catch {
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to fetch profile' });
    }
  });

  // GET /agent/crm/membership?guildId=...&userId=...
  router.get('/agent/crm/membership', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const userId = toStringParam(req.query?.userId);
    if (!guildId || !userId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and userId are required' });
    }

    try {
      const membership = await getGuildMembership(guildId, userId);
      if (!membership) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Membership not found' });
      }
      return res.json({ ok: true, data: membership });
    } catch {
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to fetch membership' });
    }
  });

  // GET /agent/crm/leaderboard?guildId=...&counter=...&limit=...
  router.get('/agent/crm/leaderboard', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    const counter = (toStringParam(req.query?.counter) || 'message_count') as any;
    const validCounters = ['message_count', 'command_count', 'reaction_given_count', 'reaction_received_count', 'session_count'];
    if (!validCounters.includes(counter)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: `counter must be one of: ${validCounters.join(', ')}` });
    }

    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 10));

    try {
      const leaderboard = await getGuildLeaderboard(guildId, counter, limit);
      return res.json({ ok: true, data: leaderboard, count: leaderboard.length });
    } catch {
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to fetch leaderboard' });
    }
  });

  // PATCH /agent/crm/user/meta — Update badges/tags/locale/metadata
  router.patch('/agent/crm/user/meta', requireAdmin, async (req, res) => {
    const userId = toStringParam(req.body?.userId);
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'userId is required' });
    }

    const { badges, tags, metadata } = req.body || {};
    const updates: Record<string, unknown> = {};
    if (Array.isArray(badges)) updates.badges = badges;
    if (Array.isArray(tags)) updates.tags = tags;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) updates.metadata = metadata;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'No valid updates provided' });
    }

    try {
      const ok = await updateUserProfileMeta(userId, updates as any);
      return res.json({ ok });
    } catch {
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to update profile meta' });
    }
  });
}
