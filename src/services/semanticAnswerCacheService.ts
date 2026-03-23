import { parseBoundedNumberEnv, parseIntegerEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { TtlCache } from '../utils/ttlCache';

type CacheRow = {
  id: number;
  guild_id: string;
  question: string;
  answer: string;
  intent: string | null;
  source_files: string[] | null;
  hit_count: number | null;
  created_at: string;
};

export type SemanticCacheHit = {
  answer: string;
  similarity: number;
  intent: string | null;
  sourceFiles: string[];
  cacheId: number;
};

const SEMANTIC_CACHE_ENABLED = String(process.env.SEMANTIC_ANSWER_CACHE_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
const SEMANTIC_CACHE_MIN_SIMILARITY = parseBoundedNumberEnv(process.env.SEMANTIC_ANSWER_CACHE_MIN_SIMILARITY, 0.82, 0, 1);
const SEMANTIC_CACHE_LOOKBACK_DAYS = Math.max(1, parseIntegerEnv(process.env.SEMANTIC_ANSWER_CACHE_LOOKBACK_DAYS, 14));
const SEMANTIC_CACHE_CANDIDATE_LIMIT = Math.max(10, Math.min(500, parseIntegerEnv(process.env.SEMANTIC_ANSWER_CACHE_CANDIDATE_LIMIT, 120)));

const HOT_CACHE_TTL_MS = 15_000;
const hotCandidateCache = new TtlCache<CacheRow[]>(100);

const tokenize = (text: string): string[] => {
  const normalized = String(text || '').toLowerCase();
  return normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 256);
};

const jaccard = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
};

const toSourceFiles = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 20);
};

export const getSemanticAnswerCache = async (params: {
  guildId: string;
  question: string;
  minSimilarity?: number;
}): Promise<SemanticCacheHit | null> => {
  if (!SEMANTIC_CACHE_ENABLED || !isSupabaseConfigured()) {
    return null;
  }

  const guildId = String(params.guildId || '').trim();
  const question = String(params.question || '').trim();
  if (!guildId || !question) {
    return null;
  }

  const minSimilarity = Math.max(0, Math.min(1, Number(params.minSimilarity ?? SEMANTIC_CACHE_MIN_SIMILARITY)));
  const queryTokens = tokenize(question);
  if (queryTokens.length === 0) {
    return null;
  }

  const sinceIso = new Date(Date.now() - SEMANTIC_CACHE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let candidates: CacheRow[];
  const hotKey = `${guildId}::${sinceIso.slice(0, 10)}`;
  const hotHit = hotCandidateCache.get(hotKey);
  if (hotHit) {
    candidates = hotHit;
  } else {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('agent_semantic_answer_cache')
      .select('id, guild_id, question, answer, intent, source_files, hit_count, created_at')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(SEMANTIC_CACHE_CANDIDATE_LIMIT);

    if (error) {
      return null;
    }

    candidates = ((data || []) as Array<Record<string, unknown>>).map((raw) => ({
      id: Number(raw.id || 0),
      guild_id: String(raw.guild_id || ''),
      question: String(raw.question || ''),
      answer: String(raw.answer || ''),
      intent: raw.intent ? String(raw.intent) : null,
      source_files: toSourceFiles(raw.source_files),
      hit_count: Number(raw.hit_count || 0),
      created_at: String(raw.created_at || ''),
    }));
    hotCandidateCache.set(hotKey, candidates, HOT_CACHE_TTL_MS);
  }

  let best: { row: CacheRow; similarity: number } | null = null;
  for (const row of candidates) {
    if (!row.answer) continue;

    const score = jaccard(queryTokens, tokenize(row.question));
    if (score < minSimilarity) {
      continue;
    }
    if (!best || score > best.similarity) {
      best = { row, similarity: score };
    }
  }

  if (!best) {
    return null;
  }

  void getSupabaseClient()
    .from('agent_semantic_answer_cache')
    .update({
      hit_count: Math.max(0, Number(best.row.hit_count || 0)) + 1,
      last_hit_at: new Date().toISOString(),
    })
    .eq('id', best.row.id);

  return {
    answer: best.row.answer,
    similarity: Number(best.similarity.toFixed(4)),
    intent: best.row.intent,
    sourceFiles: best.row.source_files || [],
    cacheId: best.row.id,
  };
};

export const putSemanticAnswerCache = async (params: {
  guildId: string;
  question: string;
  answer: string;
  intent?: string;
  sourceFiles?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> => {
  if (!SEMANTIC_CACHE_ENABLED || !isSupabaseConfigured()) {
    return;
  }

  const guildId = String(params.guildId || '').trim();
  const question = String(params.question || '').trim();
  const answer = String(params.answer || '').trim();
  if (!guildId || !question || !answer) {
    return;
  }

  const client = getSupabaseClient();
  await client.from('agent_semantic_answer_cache').insert({
    guild_id: guildId,
    question: question.slice(0, 2000),
    answer: answer.slice(0, 8000),
    intent: String(params.intent || '').trim() || null,
    source_files: (params.sourceFiles || []).map((v) => String(v || '').trim()).filter(Boolean).slice(0, 30),
    meta: params.meta || {},
    hit_count: 0,
    last_hit_at: null,
  });

  // Invalidate hot cache for this guild so next read picks up the new entry
  hotCandidateCache.pruneExpired();
};
