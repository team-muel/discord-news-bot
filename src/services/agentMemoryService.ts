import logger from '../logger';
import { parseIntegerEnv } from '../utils/env';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { withObsidianFileLock } from '../utils/obsidianFileLock';
import { TtlCache } from '../utils/ttlCache';
import { assessMemoryPoisonRisk } from './memoryPoisonGuard';
import { buildSocialContextHints } from './communityGraphService';
import { readObsidianLoreWithAdapter } from './obsidian/router';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const MEMORY_HINT_CACHE_TTL_MS = Math.max(2_000, parseIntegerEnv(process.env.MEMORY_HINT_CACHE_TTL_MS, 5_000));
const memoryHintCache = new TtlCache<string[]>(200);

const OBSIDIAN_VAULT_PATH = getObsidianVaultRoot();
const OBSIDIAN_INPUT_MAX_LENGTH = Math.max(40, Math.min(1200, parseIntegerEnv(process.env.OBSIDIAN_INPUT_MAX_LENGTH, 320)));
const MEMORY_HINT_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.MEMORY_HINT_MIN_CONFIDENCE || 0.35)));
const MEMORY_HINT_RECENCY_HALF_LIFE_DAYS = Math.max(3, Number(process.env.MEMORY_HINT_RECENCY_HALF_LIFE_DAYS || 30));

type MemoryHintCandidate = {
  text: string;
  confidence: number;
  pinned: boolean;
  updatedAt: string;
  ownerUserId: string;
};

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeUntrustedText = (value: unknown, maxLen = OBSIDIAN_INPUT_MAX_LENGTH): string => {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\.\.[/\\]/g, ' ')
    .replace(/[|&;$`<>]/g, ' ')
    .replace(/\$\(|\)\s*;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, Math.max(8, maxLen));
};

const sanitizeGuildId = (value: unknown): string => {
  const candidate = sanitizeUntrustedText(value, 40);
  if (!/^\d{6,30}$/.test(candidate)) {
    return '';
  }
  return candidate;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const parseIsoRecencyScore = (iso: string): number => {
  const ts = Date.parse(String(iso || ''));
  if (!Number.isFinite(ts)) {
    return 0.5;
  }
  const ageDays = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  return clamp01(Math.exp(-ageDays / MEMORY_HINT_RECENCY_HALF_LIFE_DAYS));
};

const SOCIAL_USER_PATTERN = /\[social:(?:outbound|inbound)\]\s+user=(\d{6,30})(?:\s+|$)/i;
const SOCIAL_SCORE_PATTERN = /dynamic_affinity=([0-9]+(?:\.[0-9]+)?)|affinity=([0-9]+(?:\.[0-9]+)?)/gi;

const parseSocialUserScores = (socialHints: string[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const hint of socialHints) {
    const row = String(hint || '').trim();
    const userMatch = row.match(SOCIAL_USER_PATTERN);
    if (!userMatch) {
      continue;
    }

    let picked = 0;
    const matches = row.matchAll(SOCIAL_SCORE_PATTERN);
    for (const match of matches) {
      const dynamicAffinity = Number(match[1] || NaN);
      const affinity = Number(match[2] || NaN);
      if (Number.isFinite(dynamicAffinity)) {
        picked = Math.max(picked, dynamicAffinity);
        continue;
      }
      if (Number.isFinite(affinity)) {
        picked = Math.max(picked, affinity);
      }
    }

    const userId = String(userMatch[1] || '').trim();
    if (!userId) {
      continue;
    }
    const prev = out.get(userId) || 0;
    out.set(userId, Math.max(prev, clamp01(picked)));
  }
  return out;
};

const safeGoalTerms = (goal: string): string[] =>
  sanitizeUntrustedText(goal)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 6);

const readObsidianLore = async (params: { guildId: string; goal: string }): Promise<string[]> => {
  const safeGuildId = sanitizeGuildId(params.guildId);
  const safeGoal = sanitizeUntrustedText(params.goal);
  if (!safeGuildId || !safeGoal) {
    logger.warn('[AGENT-MEMORY] obsidian file read skipped due to invalid untrusted input');
    return [];
  }

  return withObsidianFileLock({
    vaultRoot: OBSIDIAN_VAULT_PATH,
    key: `obsidian:guild:${safeGuildId}`,
    task: async () => {
      if (!OBSIDIAN_VAULT_PATH) {
        return [];
      }

      return readObsidianLoreWithAdapter({
        guildId: safeGuildId,
        goal: safeGoal,
        vaultPath: OBSIDIAN_VAULT_PATH,
      });
    },
  });
};

const readSupabaseLore = async (guildId: string): Promise<string[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('guild_lore_docs')
      .select('title, summary, content, updated_at')
      .eq('guild_id', guildId)
      .order('updated_at', { ascending: false })
      .limit(5);

    if (error) {
      return [];
    }

    return (data || []).map((row: any) => {
      const title = toSingleLine(row?.title || 'lore');
      const summary = toSingleLine(row?.summary || row?.content || '').slice(0, 220);
      return summary ? `${title}: ${summary}` : title;
    }).filter(Boolean);
  } catch {
    return [];
  }
};

const readSupabaseMemoryItems = async (guildId: string, goal: string): Promise<MemoryHintCandidate[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const terms = safeGoalTerms(goal);

    let query = client
      .from('memory_items')
      .select('id, type, title, content, summary, confidence, pinned, updated_at, owner_user_id')
      .eq('guild_id', guildId)
      .eq('status', 'active')
      .order('pinned', { ascending: false })
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(12);

    if (terms.length > 0) {
      const orFilter = terms
        .map((term) => `content.ilike.%${term}%,summary.ilike.%${term}%,title.ilike.%${term}%`)
        .join(',');
      query = query.or(orFilter);
    }

    const { data: items, error } = await query;
    if (error || !items || items.length === 0) {
      return [];
    }

    const ids = items.map((item: any) => String(item.id || '')).filter(Boolean);
    const sourceCountById = new Map<string, number>();

    if (ids.length > 0) {
      const { data: sourceRows } = await client
        .from('memory_sources')
        .select('memory_item_id')
        .in('memory_item_id', ids)
        .limit(120);

      for (const row of (sourceRows || []) as Array<any>) {
        const id = String(row?.memory_item_id || '');
        if (!id) continue;
        sourceCountById.set(id, (sourceCountById.get(id) || 0) + 1);
      }
    }

    return items.map((row: any) => {
      const id = String(row?.id || '');
      const type = toSingleLine(row?.type || 'memory');
      const title = toSingleLine(row?.title || row?.summary || '').slice(0, 80);
      const body = toSingleLine(row?.summary || row?.content || '').slice(0, 220);
      const conf = Number(row?.confidence ?? 0.5);
      const confidenceNumeric = Number.isFinite(conf) ? clamp01(conf) : 0.5;
      const confidence = Number.isFinite(conf) ? conf.toFixed(2) : '0.50';
      const pinnedMark = row?.pinned ? ' pinned' : '';
      const pinned = Boolean(row?.pinned);
      const sourceCount = sourceCountById.get(id) || 0;
      const ownerUserId = String(row?.owner_user_id || '').trim();
      const updatedAt = String(row?.updated_at || '').trim();
      const poison = assessMemoryPoisonRisk({
        title,
        summary: String(row?.summary || ''),
        content: String(row?.content || ''),
      });

      if (!row?.pinned && (poison.blocked || Number(conf || 0) < MEMORY_HINT_MIN_CONFIDENCE)) {
        return null;
      }

      return {
        text: `[memory:${id}${pinnedMark}] (${type}, conf=${confidence}, src=${sourceCount}) ${title ? `${title}: ` : ''}${body}`,
        confidence: confidenceNumeric,
        pinned,
        updatedAt,
        ownerUserId,
      };
    }).filter(Boolean) as MemoryHintCandidate[];
  } catch {
    return [];
  }
};

export const buildAgentMemoryHints = async (params: {
  guildId: string;
  goal: string;
  maxItems?: number;
  requesterUserId?: string;
}): Promise<string[]> => {
  const maxItems = Math.max(1, Math.min(20, Math.trunc(params.maxItems ?? 10)));
  const safeGuildId = sanitizeGuildId(params.guildId);
  const safeGoal = sanitizeUntrustedText(params.goal, 480);
  if (!safeGoal) {
    return [];
  }

  // Session-level dedup: same guild+goal within TTL returns cached hints
  const cacheKey = `${safeGuildId}::${safeGoal.slice(0, 120)}`;
  const cached = memoryHintCache.get(cacheKey);
  if (cached) {
    return cached.slice(0, maxItems);
  }

  if (!safeGuildId) {
    logger.warn('[AGENT-MEMORY] invalid guild id blocked in memory hint pipeline');
    return [`현재 목표: ${toSingleLine(safeGoal).slice(0, 180)}`].slice(0, maxItems);
  }

  const [socialHints, memoryHints, supabaseLoreHints, obsidianHints] = await Promise.all([
    buildSocialContextHints({ guildId: safeGuildId, requesterUserId: params.requesterUserId, maxItems: 4 }),
    readSupabaseMemoryItems(safeGuildId, safeGoal),
    readSupabaseLore(safeGuildId),
    readObsidianLore({ guildId: safeGuildId, goal: safeGoal }),
  ]);

  const socialByUser = parseSocialUserScores(socialHints);
  const rankedMemoryHints = memoryHints
    .map((item) => {
      const socialScore = item.ownerUserId ? (socialByUser.get(item.ownerUserId) || 0) : 0;
      const recencyScore = parseIsoRecencyScore(item.updatedAt);
      const pinnedBoost = item.pinned ? 0.08 : 0;
      const rank = clamp01((item.confidence * 0.45) + (recencyScore * 0.35) + (socialScore * 0.20) + pinnedBoost);
      return {
        ...item,
        rank,
        socialScore,
        recencyScore,
      };
    })
    .sort((a, b) => b.rank - a.rank)
    .map((item) => `${item.text} [rank=${item.rank.toFixed(2)} rel=${item.socialScore.toFixed(2)} recency=${item.recencyScore.toFixed(2)}]`);

  const goalHint = `현재 목표: ${toSingleLine(safeGoal).slice(0, 180)}`;
  const merged = [goalHint, ...socialHints, ...rankedMemoryHints, ...supabaseLoreHints, ...obsidianHints].filter(Boolean);
  memoryHintCache.set(cacheKey, merged, MEMORY_HINT_CACHE_TTL_MS);
  return merged.slice(0, maxItems);
};
