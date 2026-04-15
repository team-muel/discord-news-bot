import logger from '../../logger';
import { parseBooleanEnv, parseBoundedNumberEnv, parseMinIntEnv } from '../../utils/env';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { TtlCache } from '../../utils/ttlCache';
// Cross-domain imports via barrel exports (domain boundary contracts)
import { assessMemoryPoisonRisk, batchCountMemoryLinks, getUserEmbedding, isUserEmbeddingEnabled } from '../memory';
import { queryObsidianLoreHints, readObsidianLoreWithAdapter, type LoreHint } from '../obsidian';
// Root-level service imports (no barrel available)
import { buildSocialContextHints, getRelationshipStrengths } from '../communityGraphService';
import { loadSelfNotes } from '../entityNervousSystem';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import {
  resolveAgentPersonalizationSnapshot,
  type AgentPersonalizationRetrievalProfile,
  type AgentPersonalizationSnapshot,
} from './agentPersonalizationService';
// Within-domain imports
import { searchMemoryHybrid, searchMemoryTiered } from './agentMemoryStore';
import { cosineSimilarity } from '../../utils/vectorMath';

const MEMORY_HINT_CACHE_TTL_MS = parseMinIntEnv(process.env.MEMORY_HINT_CACHE_TTL_MS, 30_000, 2_000);
const memoryHintCache = new TtlCache<string[]>(200);
const userEmbeddingCache = new TtlCache<number[] | null>(50);
const USER_EMBEDDING_CACHE_TTL_MS = 5 * 60_000; // 5min — user embeddings refresh every 24h

const OBSIDIAN_VAULT_PATH = getObsidianVaultRoot();
const OBSIDIAN_INPUT_MAX_LENGTH = parseBoundedNumberEnv(process.env.OBSIDIAN_INPUT_MAX_LENGTH, 320, 40, 1200);
const MEMORY_HINT_MIN_CONFIDENCE = parseBoundedNumberEnv(process.env.MEMORY_HINT_MIN_CONFIDENCE, 0.35, 0, 1);
const MEMORY_HINT_RECENCY_HALF_LIFE_DAYS = parseMinIntEnv(process.env.MEMORY_HINT_RECENCY_HALF_LIFE_DAYS, 30, 3);
const MEMORY_TIERED_SEARCH_ENABLED = parseBooleanEnv(process.env.MEMORY_TIERED_SEARCH_ENABLED, true);

type MemoryHintCandidate = {
  text: string;
  confidence: number;
  pinned: boolean;
  updatedAt: string;
  ownerUserId: string;
  tier: string;
  linkCount: number;
  tags: string[];
};

type GuildLoreDocRow = {
  title: string | null;
  summary: string | null;
  content: string | null;
  updated_at: string | null;
};

type MemorySourceRow = {
  memory_item_id: string | null;
};

type MemorySearchRow = Record<string, unknown>;

const MARKET_GOAL_TERMS = [
  'market', 'markets', 'macro', 'investment', 'investing', 'stock', 'stocks',
  'cpi', 'inflation', 'fomc', 'bond', 'bonds', 'nasdaq', 's&p', 's&p500', 'dow', 'russell',
  '시장', '증시', '거시', '투자', '주식', '채권', '금리', '물가', '인플레이션', '국채', '나스닥', '다우', '러셀',
] as const;

const MARKET_SOURCE_TAGS = new Set(['youtube', 'subscription', 'posts', 'community-post']);
const MARKET_SOURCE_BOOST = 0.06;

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const uniqueStrings = (values: string[]): string[] => [...new Set(values.map((value) => toSingleLine(value)).filter(Boolean))];

const normalizeTagList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
};

const getMemorySearchRowId = (row: MemorySearchRow): string => String(row.id || '').trim();

const normalizeGuildLoreDocRow = (row: GuildLoreDocRow): string => {
  const title = toSingleLine(row.title || 'lore');
  const summary = toSingleLine(row.summary || row.content || '').slice(0, 220);
  return summary ? `${title}: ${summary}` : title;
};

const normalizeMemoryHintCandidate = (
  row: MemorySearchRow,
  sourceCount: number,
): MemoryHintCandidate | null => {
  const id = getMemorySearchRowId(row);
  const type = toSingleLine(row.type || 'memory');
  const title = toSingleLine(row.title || row.summary || '').slice(0, 80);
  const body = toSingleLine(row.summary || row.content || '').slice(0, 220);
  const numericConfidence = Number(row.confidence ?? 0.5);
  const confidence = Number.isFinite(numericConfidence) ? clamp01(numericConfidence) : 0.5;
  const confidenceLabel = confidence.toFixed(2);
  const pinned = Boolean(row.pinned);
  const pinnedMark = pinned ? ' pinned' : '';
  const ownerUserId = String(row.owner_user_id || '').trim();
  const updatedAt = String(row.updated_at || '').trim();
  const tags = normalizeTagList(row.tags);
  const poison = assessMemoryPoisonRisk({
    title,
    summary: String(row.summary || ''),
    content: String(row.content || ''),
  });

  if (!pinned && (poison.blocked || confidence < MEMORY_HINT_MIN_CONFIDENCE)) {
    return null;
  }

  return {
    text: `[memory:${id}${pinnedMark}] (${type}, conf=${confidenceLabel}, src=${sourceCount}) ${title ? `${title}: ` : ''}${body}`,
    confidence,
    pinned,
    updatedAt,
    ownerUserId,
    tier: String(row.tier || 'raw'),
    linkCount: 0,
    tags,
  };
};

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
    .filter((term) => term.length >= 2 && !term.includes('_'))
    .slice(0, 6);

const inferRetrievalIntentLabel = (goal: string): string => {
  const normalized = sanitizeUntrustedText(goal, 320).toLowerCase();
  if (/(deploy|run|execute|fix|implement|배포|실행|구현|수정|설정)/i.test(normalized)) {
    return 'action';
  }
  if (/(compare|analysis|why|evidence|risk|review|비교|분석|근거|리스크|검토)/i.test(normalized)) {
    return 'analysis';
  }
  return 'info';
};

const buildLoreGoalForProfile = (params: {
  goal: string;
  retrievalProfile?: AgentPersonalizationRetrievalProfile;
  personalizationSnapshot?: AgentPersonalizationSnapshot | null;
}): string => {
  const baseGoal = sanitizeUntrustedText(params.goal, 480);
  const profile = params.retrievalProfile || 'graph_lore';
  if (!baseGoal) {
    return baseGoal;
  }

  const topicHint = (params.personalizationSnapshot?.persona.preferredTopics || []).slice(0, 2).join(' ');
  if (profile === 'intent_prefix') {
    return `${inferRetrievalIntentLabel(baseGoal)} ${baseGoal}`.trim();
  }
  if (profile === 'keyword_expansion') {
    const expanded = uniqueStrings([...safeGoalTerms(baseGoal), ...safeGoalTerms(topicHint)]).slice(0, 6).join(' ');
    return expanded ? `${baseGoal} ${expanded}`.trim() : baseGoal;
  }
  if (profile === 'graph_lore') {
    return topicHint ? `${baseGoal} ${topicHint}`.trim() : baseGoal;
  }
  return baseGoal;
};

const isMarketGoal = (goal: string): boolean => {
  const normalizedGoal = sanitizeUntrustedText(goal, 480).toLowerCase();
  return MARKET_GOAL_TERMS.some((term) => normalizedGoal.includes(term));
};

const marketSourceBoost = (goal: string, tags: string[]): number => {
  if (!isMarketGoal(goal)) {
    return 0;
  }
  const matchedTags = tags.filter((tag) => MARKET_SOURCE_TAGS.has(tag)).length;
  if (matchedTags < 3) {
    return 0;
  }
  return MARKET_SOURCE_BOOST;
};

const readObsidianLore = async (params: {
  guildId: string;
  goal: string;
  retrievalProfile?: AgentPersonalizationRetrievalProfile;
  personalizationSnapshot?: AgentPersonalizationSnapshot | null;
}): Promise<string[]> => {
  const safeGuildId = sanitizeGuildId(params.guildId);
  const safeGoal = buildLoreGoalForProfile({
    goal: params.goal,
    retrievalProfile: params.retrievalProfile,
    personalizationSnapshot: params.personalizationSnapshot,
  });
  if (!safeGuildId || !safeGoal) {
    logger.warn('[AGENT-MEMORY] obsidian file read skipped due to invalid untrusted input');
    return [];
  }

  if (!OBSIDIAN_VAULT_PATH) {
    return [];
  }

  try {
    // Graph-first path: use intent routing + connectivity boost + 2-hop traversal
    const hints = await queryObsidianLoreHints(safeGoal, {
      maxDocs: 4,
      guildId: safeGuildId,
    });

    if (hints.length > 0) {
      return hints.map((h) => h.text);
    }

    // Fallback: direct adapter read (no graph features)
    return await readObsidianLoreWithAdapter({
      guildId: safeGuildId,
      goal: safeGoal,
      vaultPath: OBSIDIAN_VAULT_PATH,
    });
  } catch {
    return [];
  }
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

    return ((data || []) as GuildLoreDocRow[])
      .map(normalizeGuildLoreDocRow)
      .filter(Boolean);
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
    const queryText = terms.join(' ');

    const items = await searchMemoryTiered({
      guildId,
      query: queryText,
      type: null,
      limit: 12,
      extraSelect: 'owner_user_id, priority, tags',
      flatSearch: !MEMORY_TIERED_SEARCH_ENABLED,
    });

    if (items.length === 0) {
      return [];
    }

    const ids = items.map((item) => getMemorySearchRowId(item)).filter(Boolean);
    const sourceCountById = new Map<string, number>();

    if (ids.length > 0) {
      const { data: sourceRows } = await client
        .from('memory_sources')
        .select('memory_item_id')
        .in('memory_item_id', ids)
        .limit(120);

      for (const row of (sourceRows || []) as MemorySourceRow[]) {
        const id = String(row.memory_item_id || '');
        if (!id) continue;
        sourceCountById.set(id, (sourceCountById.get(id) || 0) + 1);
      }
    }

    return items
      .map((row) => normalizeMemoryHintCandidate(row, sourceCountById.get(getMemorySearchRowId(row)) || 0))
      .filter((item): item is MemoryHintCandidate => item !== null);
  } catch {
    return [];
  }
};

export const buildAgentMemoryHints = async (params: {
  guildId: string;
  goal: string;
  maxItems?: number;
  requesterUserId?: string;
  personalizationSnapshot?: AgentPersonalizationSnapshot | null;
}): Promise<string[]> => {
  const maxItems = Math.max(1, Math.min(20, Math.trunc(params.maxItems ?? 10)));
  const safeGuildId = sanitizeGuildId(params.guildId);
  const safeGoal = sanitizeUntrustedText(params.goal, 480);
  if (!safeGoal) {
    return [];
  }

  // Session-level dedup: same guild+goal within TTL returns cached hints
  const cacheKey = `${safeGuildId}::${String(params.requesterUserId || '').trim() || '*'}::${safeGoal.slice(0, 120)}`;
  const cached = memoryHintCache.get(cacheKey);
  if (cached) {
    return cached.slice(0, maxItems);
  }

  if (!safeGuildId) {
    logger.warn('[AGENT-MEMORY] invalid guild id blocked in memory hint pipeline');
    return [`현재 목표: ${toSingleLine(safeGoal).slice(0, 180)}`].slice(0, maxItems);
  }

  const personalization = params.personalizationSnapshot ?? (params.requesterUserId
    ? await resolveAgentPersonalizationSnapshot({
      guildId: safeGuildId,
      userId: params.requesterUserId,
    }).catch(() => null)
    : null);

  const [socialHints, memoryHints, supabaseLoreHints, obsidianHints, selfNotes] = await Promise.all([
    buildSocialContextHints({ guildId: safeGuildId, requesterUserId: params.requesterUserId, maxItems: 4 }),
    readSupabaseMemoryItems(safeGuildId, safeGoal),
    readSupabaseLore(safeGuildId),
    readObsidianLore({
      guildId: safeGuildId,
      goal: safeGoal,
      retrievalProfile: personalization?.effective.retrievalProfile,
      personalizationSnapshot: personalization,
    }),
    loadSelfNotes(safeGuildId),
  ]);

  // ADR-006: Batch-fetch link counts for graph-based scoring
  const memoryIds = memoryHints.map((item) => {
    const idMatch = item.text.match(/\[memory:(\S+?)[\s\]]/);
    return idMatch?.[1] || '';
  }).filter(Boolean);
  const linkCounts = memoryIds.length > 0
    ? await batchCountMemoryLinks(memoryIds, safeGuildId).catch(() => new Map<string, number>())
    : new Map<string, number>();

  // Populate linkCount on each hint
  for (const item of memoryHints) {
    const idMatch = item.text.match(/\[memory:(\S+?)[\s\]]/);
    const id = idMatch?.[1] || '';
    if (id) item.linkCount = linkCounts.get(id) || 0;
  }

  // ── User embedding for personalized affinity scoring (Daangn-inspired) ────
  // Load the requester's user embedding (guild-constrained, RCBS-analog).
  // Cached for 5min to avoid re-fetching on every hint build.
  let userEmbeddingVec: number[] | null = null;
  if (params.requesterUserId && isUserEmbeddingEnabled()) {
    const embCacheKey = `${safeGuildId}:${params.requesterUserId}`;
    const cached = userEmbeddingCache.get(embCacheKey);
    if (cached !== null) {
      userEmbeddingVec = cached;
    } else {
      const userEmb = await getUserEmbedding(params.requesterUserId, safeGuildId).catch(() => null);
      userEmbeddingVec = userEmb?.embedding ?? null;
      userEmbeddingCache.set(embCacheKey, userEmbeddingVec, USER_EMBEDDING_CACHE_TTL_MS);
    }
  }

  // Batch-fetch memory item embeddings for user affinity scoring
  // Only when user embedding is loaded — skips the entire query otherwise
  const memoryEmbeddingsById = new Map<string, number[]>();
  if (userEmbeddingVec && memoryIds.length > 0) {
    try {
      const client = getSupabaseClient();
      const { data: embRows } = await client
        .from('memory_items')
        .select('id, embedding')
        .in('id', memoryIds)
        .not('embedding', 'is', null)
        .limit(memoryIds.length);

      for (const row of (embRows || []) as Array<{ id?: string; embedding?: string | number[] }>) {
        const id = String(row.id || '');
        if (!id) continue;
        const rawEmb = row.embedding;
        let vec: number[];
        if (Array.isArray(rawEmb)) {
          vec = (rawEmb as number[]).map(Number).filter(Number.isFinite);
        } else if (typeof rawEmb === 'string') {
          const cleaned = String(rawEmb).replace(/^\[|\]$/g, '');
          vec = cleaned.split(',').map(Number).filter(Number.isFinite);
        } else {
          continue;
        }
        if (vec.length > 0) memoryEmbeddingsById.set(id, vec);
      }
    } catch {
      // non-critical — scoring falls back to non-affinity weights
    }
  }

  // ADR-006: Tier weight — higher tiers get priority
  const tierWeight = (tier: string): number => {
    switch (tier) {
      case 'schema': return 0.06;
      case 'concept': return 0.04;
      case 'summary': return 0.02;
      default: return 0; // raw
    }
  };

  // ADR-006: Link-based graph centrality bonus (diminishing returns)
  const linkBonus = (count: number): number => {
    if (count <= 0) return 0;
    return Math.min(0.06, Math.log2(count + 1) * 0.02);
  };

  // ── Unified cross-source scoring ──────────────────────────────────────────
  // Score Obsidian hints and Supabase lore into the same ranking pipeline
  // to enable cross-source dedup and quality-based ordering.

  type ScoredHint = { text: string; rank: number; source: 'memory' | 'obsidian' | 'lore' };
  const allScoredHints: ScoredHint[] = [];

  // Score memory items (ADR-006 scoring + user affinity from Daangn-inspired embeddings)
  const socialByUser = parseSocialUserScores(socialHints);

  // Enhance social scores with direct relationship edge strengths
  if (params.requesterUserId && memoryHints.length > 0) {
    const ownerIds = [...new Set(memoryHints.map((m) => m.ownerUserId).filter(Boolean))];
    if (ownerIds.length > 0) {
      try {
        const edgeStrengths = await getRelationshipStrengths({
          guildId: safeGuildId,
          requesterUserId: params.requesterUserId,
          targetUserIds: ownerIds,
        });
        for (const [userId, strength] of edgeStrengths) {
          const current = socialByUser.get(userId) ?? 0;
          socialByUser.set(userId, Math.max(current, strength));
        }
      } catch {
        // Best-effort — fall back to hint-only social scores
      }
    }
  }

  for (const item of memoryHints) {
    const socialScore = item.ownerUserId ? (socialByUser.get(item.ownerUserId) || 0) : 0;
    const recencyScore = parseIsoRecencyScore(item.updatedAt);
    const pinnedBoost = item.pinned ? 0.08 : 0;
    const tierBoost = tierWeight(item.tier);
    const graphBoost = linkBonus(item.linkCount);
    const sourceBoost = marketSourceBoost(safeGoal, item.tags);

    // User affinity: cosine similarity between user embedding and memory embedding
    // Weights redistributed: confidence 0.35, recency 0.25, social 0.15, userAffinity 0.10
    const memIdMatch = item.text.match(/\[memory:(\S+?)[\s\]]/);
    const memId = memIdMatch?.[1] || '';
    const memEmbedding = memId ? memoryEmbeddingsById.get(memId) : undefined;
    const userAffinityScore = (userEmbeddingVec && memEmbedding)
      ? clamp01(cosineSimilarity(userEmbeddingVec, memEmbedding))
      : 0;
    const hasUserAffinity = userAffinityScore > 0;

    const rank = clamp01(
      (item.confidence * (hasUserAffinity ? 0.35 : 0.40)) +
      (recencyScore * (hasUserAffinity ? 0.25 : 0.30)) +
      (socialScore * 0.15) +
      (userAffinityScore * 0.10) +
      pinnedBoost +
      tierBoost +
      graphBoost +
      sourceBoost,
    );
    const label = `${item.text} [rank=${rank.toFixed(2)} rel=${socialScore.toFixed(2)} recency=${recencyScore.toFixed(2)}${hasUserAffinity ? ` affinity=${userAffinityScore.toFixed(2)}` : ''}]`;
    allScoredHints.push({ text: label, rank, source: 'memory' });
  }

  // Score Obsidian hints (graph connectivity → rank)
  for (const hint of obsidianHints) {
    const text = String(hint || '').trim();
    if (!text) continue;
    // Obsidian hints from graph-first path carry [obsidian:path] prefix
    // Base score 0.55 (between high-confidence memory and low-confidence memory)
    // + connectivity bonus extracted from the hint metadata
    const backlinkMatch = text.match(/←(\d+)/);
    const backlinkCount = backlinkMatch ? Number(backlinkMatch[1]) : 0;
    const connectivityBoost = Math.min(0.12, Math.log2(1 + backlinkCount) * 0.04);
    const rank = clamp01(0.55 + connectivityBoost);
    allScoredHints.push({ text: `${text} [rank=${rank.toFixed(2)}]`, rank, source: 'obsidian' });
  }

  // Score Supabase lore hints (static medium score — curated content)
  for (const hint of supabaseLoreHints) {
    const text = String(hint || '').trim();
    if (!text) continue;
    const rank = 0.50; // curated lore gets stable mid-tier priority
    allScoredHints.push({ text: `[lore] ${text} [rank=${rank.toFixed(2)}]`, rank, source: 'lore' });
  }

  // Dedup: if same text snippet appears in both obsidian and lore, keep higher-ranked one
  const dedupTexts = new Set<string>();
  const dedupedHints: ScoredHint[] = [];
  for (const hint of allScoredHints.sort((a, b) => b.rank - a.rank)) {
    // Dedup key: first 80 chars of the hint text (after stripping source prefixes)
    const dedupKey = hint.text.replace(/^\[(memory|obsidian|lore):[^\]]*\]\s*/i, '').slice(0, 80).toLowerCase();
    if (dedupTexts.has(dedupKey)) continue;
    dedupTexts.add(dedupKey);
    dedupedHints.push(hint);
  }

  const rankedHintTexts = dedupedHints.map((h) => h.text);

  const goalHint = `현재 목표: ${toSingleLine(safeGoal).slice(0, 180)}`;
  const merged = [
    goalHint,
    ...(personalization?.promptHints || []),
    ...selfNotes,
    ...socialHints,
    ...rankedHintTexts,
  ].filter(Boolean);
  memoryHintCache.set(cacheKey, merged, MEMORY_HINT_CACHE_TTL_MS);
  return merged.slice(0, maxItems);
};
