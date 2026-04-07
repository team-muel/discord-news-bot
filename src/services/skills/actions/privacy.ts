import { forgetGuildRagData, forgetUserRagData } from '../../privacyForgetService';
import logger from '../../../logger';
import type { ActionDefinition } from './types';
import { getErrorMessage } from '../../../utils/errorMessage';

const toBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
};

export const privacyForgetGuildAction: ActionDefinition = {
  name: 'privacy.forget.guild',
  description: '길드 단위 RAG 메모리(Supabase + Obsidian)를 완전 삭제합니다.',
  category: 'ops',
  parameters: [
    { name: 'confirm', required: true, description: 'Must be "true" to proceed with deletion' },
  ],
  execute: async ({ args, guildId, requestedBy }) => {
    const targetGuildId = String(guildId || '').trim();
    const confirm = String(args?.confirm || '').trim();

    if (!targetGuildId) {
      return {
        ok: false,
        name: 'privacy.forget.guild',
        summary: 'guildId가 필요합니다.',
        artifacts: [],
        verification: ['missing guildId'],
        error: 'GUILD_ID_REQUIRED',
      };
    }

    if (confirm !== 'FORGET_GUILD') {
      return {
        ok: false,
        name: 'privacy.forget.guild',
        summary: '안전 확인코드가 필요합니다. args.confirm=FORGET_GUILD 로 다시 요청하세요.',
        artifacts: [targetGuildId],
        verification: ['confirmation token missing'],
        error: 'CONFIRMATION_REQUIRED',
      };
    }

    try {
      const result = await forgetGuildRagData({
        guildId: targetGuildId,
        requestedBy: String(requestedBy || 'action'),
        reason: String(args?.reason || 'action:privacy.forget.guild'),
        deleteObsidian: toBool(args?.deleteObsidian, true),
      });

      return {
        ok: true,
        name: 'privacy.forget.guild',
        summary: `길드 RAG 메모리 완전 삭제 완료 guild=${targetGuildId}`,
        artifacts: [
          ...Object.entries(result.supabase.counts).map(([table, count]) => `${table}=${count}`),
          `supabase.totalDeleted=${result.supabase.totalDeleted}`,
          `obsidian.removedPaths=${result.obsidian.removedPaths.length}`,
        ],
        verification: [
          `scope=${result.scope}`,
          `obsidianAttempted=${String(result.obsidian.attempted)}`,
        ],
      };
    } catch (error) {
      logger.warn('[PRIVACY] forgetGuildRagData failed guild=%s: %s', targetGuildId, getErrorMessage(error));
      return {
        ok: false,
        name: 'privacy.forget.guild',
        summary: '길드 RAG 메모리 삭제 실패',
        artifacts: [targetGuildId],
        verification: ['forgetGuildRagData exception'],
        error: 'FORGET_GUILD_FAILED',
      };
    }
  },
};

export const privacyForgetUserAction: ActionDefinition = {
  name: 'privacy.forget.user',
  description: '사용자 단위 RAG 메모리(Supabase + Obsidian)를 삭제합니다.',
  category: 'ops',
  execute: async ({ args, guildId, requestedBy }) => {
    const requester = String(requestedBy || '').trim();
    const systemRequested = requester.startsWith('system:');
    const targetUserId = String(args?.userId || requester).trim();
    const targetGuildId = String(args?.guildId || guildId || '').trim() || undefined;

    if (!targetUserId) {
      return {
        ok: false,
        name: 'privacy.forget.user',
        summary: 'userId를 확인할 수 없습니다.',
        artifacts: [],
        verification: ['missing userId'],
        error: 'USER_ID_REQUIRED',
      };
    }

    const confirm = String(args?.confirm || '').trim();
    if (confirm !== 'FORGET_USER') {
      return {
        ok: false,
        name: 'privacy.forget.user',
        summary: '안전 확인코드가 필요합니다. args.confirm=FORGET_USER 로 다시 요청하세요.',
        artifacts: [`targetUserId=${targetUserId}`],
        verification: ['confirmation token missing'],
        error: 'CONFIRMATION_REQUIRED',
      };
    }

    // User-level action path is self-only unless called by a trusted system actor.
    if (!systemRequested && requester && targetUserId !== requester) {
      return {
        ok: false,
        name: 'privacy.forget.user',
        summary: '다른 사용자 삭제는 API 관리자 경로를 사용해야 합니다.',
        artifacts: [`targetUserId=${targetUserId}`],
        verification: ['third-party deletion blocked'],
        error: 'FORBIDDEN_THIRD_PARTY_DELETE',
      };
    }

    try {
      const result = await forgetUserRagData({
        userId: targetUserId,
        guildId: targetGuildId,
        requestedBy: requester || 'action',
        reason: String(args?.reason || 'action:privacy.forget.user'),
        deleteObsidian: toBool(args?.deleteObsidian, true),
      });

      return {
        ok: true,
        name: 'privacy.forget.user',
        summary: `사용자 RAG 메모리 삭제 완료 user=${targetUserId} guild=${targetGuildId || 'all'}`,
        artifacts: [
          ...Object.entries(result.supabase.counts).map(([table, count]) => `${table}=${count}`),
          `supabase.totalDeleted=${result.supabase.totalDeleted}`,
          `obsidian.removedPaths=${result.obsidian.removedPaths.length}`,
        ],
        verification: [
          `scope=${result.scope}`,
          `obsidianAttempted=${String(result.obsidian.attempted)}`,
        ],
      };
    } catch (error) {
      logger.warn('[PRIVACY] forgetUserRagData failed user=%s guild=%s: %s', targetUserId, targetGuildId || 'all', getErrorMessage(error));
      return {
        ok: false,
        name: 'privacy.forget.user',
        summary: '사용자 RAG 메모리 삭제 실패',
        artifacts: [
          `targetUserId=${targetUserId}`,
          `targetGuildId=${targetGuildId || 'all'}`,
        ],
        verification: ['forgetUserRagData exception'],
        error: 'FORGET_USER_FAILED',
      };
    }
  },
};
