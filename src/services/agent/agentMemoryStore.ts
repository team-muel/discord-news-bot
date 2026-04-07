import crypto from 'crypto';
import logger from '../../logger';
import { debugCatchError, getErrorMessage } from '../../utils/errorMessage';
import { assessMemoryPoisonRisk, buildPoisonTags } from '../memory/memoryPoisonGuard';
import { sanitizeForObsidianWrite } from '../obsidian/obsidianSanitizationWorker';
import { hasMemoryConsent } from './agentConsentService';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { runWithConcurrency } from '../../utils/async';
import { generateQueryEmbedding, generateEmbedding, storeMemoryEmbedding, isEmbeddingEnabled } from '../memory/memoryEmbeddingService';

const MEMORY_TYPES = ['episode', 'semantic', 'policy', 'preference'] as const;
const FEEDBACK_ACTIONS = ['pin', 'unpin', 'edit', 'deprecate', 'restore', 'approve', 'reject'] as const;
const CONFLICT_STATUSES = ['open', 'resolved', 'ignored'] as const;
const JOB_TYPES = ['short_summary', 'topic_synthesis', 'durable_extraction', 'reindex', 'conflict_scan', 'onboarding_snapshot', 'consolidation'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryFeedbackAction = (typeof FEEDBACK_ACTIONS)[number];
export type MemoryConflictStatus = (typeof CONFLICT_STATUSES)[number];
export type MemoryJobType = (typeof JOB_TYPES)[number];

export const isMemoryType = (value: string): value is MemoryType => MEMORY_TYPES.includes(value as MemoryType);
export const isFeedbackAction = (value: string): value is MemoryFeedbackAction => FEEDBACK_ACTIONS.includes(value as MemoryFeedbackAction);
export const isConflictStatus = (value: string): value is MemoryConflictStatus => CONFLICT_STATUSES.includes(value as MemoryConflictStatus);
export const isMemoryJobType = (value: string): value is MemoryJobType => JOB_TYPES.includes(value as MemoryJobType);

type SearchParams = {
  guildId: string;
  query: string;
  type?: MemoryType;
  limit: number;
};

type CreateMemoryParams = {
  guildId: string;
  channelId?: string;
  type: MemoryType;
  title?: string;
  content: string;
  tags?: string[];
  confidence?: number;
  actorId: string;
  ownerUserId?: string;
  source?: {
    sourceKind?: 'discord_message' | 'summary_job' | 'admin_edit' | 'system';
    sourceMessageId?: string;
    sourceAuthorId?: string;
    sourceRef?: string;
    excerpt?: string;
  };
};

type FeedbackParams = {
  memoryId: string;
  guildId: string;
  action: MemoryFeedbackAction;
  actorId: string;
  reason?: string;
  patch?: Record<string, unknown>;
};

type QueueJobParams = {
  guildId: string;
  jobType: MemoryJobType;
  actorId: string;
  windowStartedAt?: string;
  windowEndedAt?: string;
  input?: Record<string, unknown>;
};

const ensureSupabase = () => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return getSupabaseClient();
};

const safeLike = (value: string): string => value.replace(/[%,_()."'\\]/g, ' ').trim();
const MEMORY_RETRIEVE_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.MEMORY_RETRIEVE_MIN_CONFIDENCE || 0.35)));
const MEMORY_HYBRID_MIN_SIMILARITY = Math.max(0, Math.min(1, Number(process.env.MEMORY_HYBRID_MIN_SIMILARITY || 0.08)));
const MEMORY_CITATIONS_PER_ITEM = Math.max(1, Math.min(5, Number(process.env.MEMORY_CITATIONS_PER_ITEM || 3)));
const MEMORY_CITATIONS_REFILL_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.MEMORY_CITATIONS_REFILL_CONCURRENCY || 4)));

const toMaybeUserId = (value: unknown): string | null => {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  if (/^\d{6,30}$/.test(text)) {
    return text;
  }
  return null;
};

const recencyScore = (updatedAtIso: string | null): number => {
  if (!updatedAtIso) return 0;
  const updatedAtMs = Date.parse(updatedAtIso);
  if (!Number.isFinite(updatedAtMs)) return 0;
  const days = Math.max(0, (Date.now() - updatedAtMs) / (1000 * 60 * 60 * 24));
  return Math.exp(-days / 30);
};

const toCitation = (row: Record<string, unknown>) => ({
  sourceKind: String(row.source_kind || ''),
  sourceMessageId: String(row.source_message_id || ''),
  sourceRef: String(row.source_ref || ''),
});

const logRetrievalEvent = async (params: {
  guildId: string;
  query: string;
  requestedTopK: number;
  returned: number;
  queryLatencyMs: number;
  avgScore: number;
  avgCitations: number;
  type?: MemoryType;
}) => {
  try {
    const client = ensureSupabase();
    const row = {
      id: `mret_${crypto.randomUUID()}`,
      guild_id: params.guildId,
      query: params.query.slice(0, 500),
      query_type: params.type || null,
      requested_top_k: params.requestedTopK,
      returned_count: params.returned,
      query_latency_ms: Math.max(0, Math.trunc(params.queryLatencyMs)),
      avg_score: Math.max(0, Math.min(1, params.avgScore)),
      avg_citations: Math.max(0, Math.min(20, params.avgCitations)),
      created_at: new Date().toISOString(),
    };

    await client.from('memory_retrieval_logs').insert(row);
  } catch {
    // Retrieval logging must never break the API path.
  }
};

/**
 * Shared hybrid memory search: vector RPC first, classic ilike fallback.
 * Eliminates duplication across agentMemoryStore, agentMemoryService, memoryEvolutionService.
 */
export type HybridSearchParams = {
  guildId: string;
  query: string;
  type?: MemoryType | null;
  limit: number;
  minSimilarity?: number;
  /** Extra select columns for classic fallback (default: id, guild_id, type, title, content, summary, confidence, pinned, updated_at, status) */
  extraSelect?: string;
};

export const searchMemoryHybrid = async (
  params: HybridSearchParams,
): Promise<Array<Record<string, unknown>>> => {
  const client = ensureSupabase();
  const cleanQuery = safeLike(params.query);
  const minSim = params.minSimilarity ?? MEMORY_HYBRID_MIN_SIMILARITY;

  const runClassic = async (): Promise<Array<Record<string, unknown>>> => {
    const selectCols = params.extraSelect
      ? `id, guild_id, type, title, content, summary, confidence, pinned, updated_at, status, ${params.extraSelect}`
      : 'id, guild_id, type, title, content, summary, confidence, pinned, updated_at, status';

    let query = client
      .from('memory_items')
      .select(selectCols)
      .eq('guild_id', params.guildId)
      .eq('status', 'active')
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(params.limit);

    if (params.type) {
      query = query.eq('type', params.type);
    }

    if (cleanQuery) {
      query = query.or(`content.ilike.%${cleanQuery}%,summary.ilike.%${cleanQuery}%,title.ilike.%${cleanQuery}%`);
    }

    const result = await query;
    if (result.error) {
      throw new Error(result.error.message || 'MEMORY_SEARCH_FAILED');
    }
    return (result.data || []) as unknown as Array<Record<string, unknown>>;
  };

  const canUseHybridRpc = typeof (client as { rpc?: unknown }).rpc === 'function';
  if (cleanQuery && canUseHybridRpc) {
    const queryEmbedding = isEmbeddingEnabled()
      ? await generateQueryEmbedding(cleanQuery).catch(() => null)
      : null;

    const hybrid = await client.rpc('search_memory_items_hybrid', {
      p_guild_id: params.guildId,
      p_query: cleanQuery,
      p_type: params.type || null,
      p_limit: params.limit,
      p_min_similarity: minSim,
      p_query_embedding: queryEmbedding ? `[${queryEmbedding.join(',')}]` : null,
    });

    if (hybrid.error) {
      return runClassic();
    }
    return (hybrid.data || []) as unknown as Array<Record<string, unknown>>;
  }

  return runClassic();
};

// ──── Tiered Search (H-MEM inspired) ─────────────────────────────────────────

/**
 * Search memories using tier-based routing: concept → summary → raw.
 * Higher tiers are searched first; lower tiers only fill remaining slots.
 * This reduces search cost and naturally promotes consolidated knowledge.
 */
const TIERED_SEARCH_ORDER: readonly string[] = ['concept', 'summary', 'raw'] as const;

export type TieredSearchParams = Omit<HybridSearchParams, 'extraSelect'> & {
  extraSelect?: string;
  /** Skip tier routing and search all tiers at once (default: false) */
  flatSearch?: boolean;
};

export const searchMemoryTiered = async (
  params: TieredSearchParams,
): Promise<Array<Record<string, unknown>>> => {
  if (params.flatSearch) {
    return searchMemoryHybrid(params);
  }

  const collected: Array<Record<string, unknown>> = [];
  const seenIds = new Set<string>();
  let remaining = params.limit;

  for (const tier of TIERED_SEARCH_ORDER) {
    if (remaining <= 0) break;

    try {
      const tierResults = await searchMemoryHybrid({
        ...params,
        limit: remaining + 2, // slight overfetch to account for dedup
        extraSelect: params.extraSelect
          ? `tier, ${params.extraSelect}`
          : 'tier',
      });

      for (const row of tierResults) {
        if (remaining <= 0) break;
        const rowTier = String(row.tier || 'raw');
        if (rowTier !== tier) continue; // only accept results from current tier
        const id = String(row.id || '');
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(row);
        remaining--;
      }
    } catch (err) {
      logger.debug('[MEMORY-TIERED] tier=%s search failed, continuing: %s', tier, getErrorMessage(err));
    }
  }

  return collected;
};

export async function searchGuildMemory(params: SearchParams) {
  const client = ensureSupabase();
  const startedAt = Date.now();

  const items = await searchMemoryHybrid({
    guildId: params.guildId,
    query: params.query,
    type: params.type,
    limit: params.limit,
    extraSelect: 'channel_id',
  });

  const ids = items.map((item) => String(item.id)).filter(Boolean);

  let citationsById = new Map<string, Array<{ sourceKind: string; sourceMessageId: string; sourceRef: string }>>();
  if (ids.length > 0) {
    const citationsPerItem = MEMORY_CITATIONS_PER_ITEM;
    const warmupLimit = citationsPerItem * ids.length;
    const { data: sourceRows, error: sourceError } = await client
      .from('memory_sources')
      .select('memory_item_id, source_kind, source_message_id, source_ref')
      .in('memory_item_id', ids)
      .order('created_at', { ascending: false })
      .limit(warmupLimit);

    if (sourceError) {
      throw new Error(sourceError.message || 'MEMORY_SOURCES_FAILED');
    }

    for (const row of (sourceRows || []) as Array<Record<string, unknown>>) {
      const memoryItemId = String(row.memory_item_id || '');
      if (!memoryItemId) continue;
      const current = citationsById.get(memoryItemId) || [];
      if (current.length < citationsPerItem) {
        current.push(toCitation(row));
      }
      citationsById.set(memoryItemId, current);
    }

    const underfilledIds = ids.filter((id) => (citationsById.get(id)?.length || 0) < citationsPerItem);
    if (underfilledIds.length > 0) {
      await runWithConcurrency(
        underfilledIds,
        async (memoryItemId) => {
          const existing = citationsById.get(memoryItemId) || [];
          const existingKeys = new Set(existing.map((citation) => `${citation.sourceMessageId}|${citation.sourceRef}`));
          const needed = citationsPerItem - existing.length;
          if (needed <= 0) {
            return;
          }

          const { data: refillRows, error: refillError } = await client
            .from('memory_sources')
            .select('memory_item_id, source_kind, source_message_id, source_ref')
            .eq('memory_item_id', memoryItemId)
            .order('created_at', { ascending: false })
            .limit(citationsPerItem);

          if (refillError) {
            throw new Error(refillError.message || 'MEMORY_SOURCES_REFILL_FAILED');
          }

          for (const row of (refillRows || []) as Array<Record<string, unknown>>) {
            if (existing.length >= citationsPerItem) {
              break;
            }
            const citation = toCitation(row);
            const key = `${citation.sourceMessageId}|${citation.sourceRef}`;
            if (existingKeys.has(key)) {
              continue;
            }
            existing.push(citation);
            existingKeys.add(key);
          }

          citationsById.set(memoryItemId, existing);
        },
        MEMORY_CITATIONS_REFILL_CONCURRENCY,
      );
    }
  }

  const responseItems = items.map((item) => {
    const id = String(item.id || '');
    const confidence = Number(item.confidence ?? 0.5);
    const recency = recencyScore(String(item.updated_at || ''));
    const pinnedBoost = item.pinned ? 1 : 0;
    const citations = citationsById.get(id) || [];
    const poisonAssessment = assessMemoryPoisonRisk({
      title: String(item.title || ''),
      summary: String(item.summary || ''),
      content: String(item.content || ''),
      sourceRef: citations[0]?.sourceRef || null,
    });

    const poisonPenalty = poisonAssessment.reviewRequired ? 0.2 : 0;
    const scoreBase = 0.55 * confidence + 0.30 * recency + 0.15 * pinnedBoost - poisonPenalty;
    const score = Math.max(0, Math.min(1, scoreBase));

    return {
      id,
      type: String(item.type || ''),
      title: String(item.title || ''),
      content: String(item.content || ''),
      summary: String(item.summary || ''),
      confidence,
      pinned: Boolean(item.pinned),
      score,
      citations,
      poisonRisk: Number(poisonAssessment.riskScore.toFixed(3)),
      reviewRequired: poisonAssessment.reviewRequired,
      blockedByPoisonGuard: poisonAssessment.blocked,
      updatedAt: String(item.updated_at || ''),
    };
  }).filter((item) => {
    if (item.pinned) {
      return true;
    }
    if (item.blockedByPoisonGuard) {
      return false;
    }
    if (item.confidence < MEMORY_RETRIEVE_MIN_CONFIDENCE) {
      return false;
    }
    return true;
  });

  const avgScore = responseItems.length > 0
    ? responseItems.reduce((acc, row) => acc + Number(row.score || 0), 0) / responseItems.length
    : 0;
  const avgCitations = responseItems.length > 0
    ? responseItems.reduce((acc, row) => acc + (Array.isArray(row.citations) ? row.citations.length : 0), 0) / responseItems.length
    : 0;

  await logRetrievalEvent({
    guildId: params.guildId,
    query: params.query,
    requestedTopK: params.limit,
    returned: responseItems.length,
    queryLatencyMs: Date.now() - startedAt,
    avgScore,
    avgCitations,
    type: params.type,
  });

  return {
    items: responseItems,
    meta: {
      requestedTopK: params.limit,
      returned: responseItems.length,
      queryLatencyMs: Date.now() - startedAt,
    },
  };
}

export async function createMemoryItem(params: CreateMemoryParams) {
  const client = ensureSupabase();
  const id = `mem_${crypto.randomUUID()}`;
  const ownerUserId = toMaybeUserId(params.ownerUserId)
    || toMaybeUserId(params.source?.sourceAuthorId)
    || toMaybeUserId(params.actorId);

  if (ownerUserId) {
    const consentGranted = await hasMemoryConsent({ guildId: params.guildId, userId: ownerUserId });
    if (!consentGranted) {
      throw new Error('MEMORY_CONSENT_REQUIRED');
    }
  }

  const sanitized = sanitizeForObsidianWrite({
    title: params.title,
    summary: null,
    content: params.content,
    sourceRef: params.source?.sourceRef,
    excerpt: params.source?.excerpt,
  });
  if (!sanitized.ok) {
    throw new Error(`OBSIDIAN_SANITIZER_BLOCKED:${sanitized.reasons.join(',') || 'policy'}`);
  }

  const poisonAssessment = assessMemoryPoisonRisk({
    title: sanitized.cleaned.title,
    summary: null,
    content: sanitized.cleaned.content,
    sourceRef: sanitized.cleaned.sourceRef || null,
  });
  if (poisonAssessment.blocked) {
    throw new Error('MEMORY_CONTENT_BLOCKED_BY_POISON_GUARD');
  }

  const confidenceInput = Number.isFinite(params.confidence) ? Math.max(0, Math.min(1, Number(params.confidence))) : 0.5;
  const confidence = poisonAssessment.reviewRequired ? Math.min(0.45, confidenceInput) : confidenceInput;
  const poisonTags = buildPoisonTags(poisonAssessment);

  const insertRow = {
    id,
    guild_id: params.guildId,
    channel_id: params.channelId || null,
    owner_user_id: ownerUserId,
    type: params.type,
    title: sanitized.cleaned.title || null,
    content: sanitized.cleaned.content,
    tags: [...(params.tags || []).filter(Boolean), ...poisonTags],
    confidence,
    created_by: params.actorId,
    updated_by: params.actorId,
    source_count: params.source ? 1 : 0,
  };

  const { data, error } = await client.from('memory_items').insert(insertRow).select('*').single();
  if (error) {
    throw new Error(error.message || 'MEMORY_CREATE_FAILED');
  }

  if (params.source) {
    const sourceRow = {
      memory_item_id: id,
      guild_id: params.guildId,
      channel_id: params.channelId || null,
      source_kind: params.source.sourceKind || 'admin_edit',
      source_message_id: params.source.sourceMessageId || null,
      source_author_id: params.source.sourceAuthorId || null,
      source_ref: sanitized.cleaned.sourceRef || null,
      excerpt: sanitized.cleaned.excerpt || null,
      source_ts: new Date().toISOString(),
    };

    const { error: sourceError } = await client.from('memory_sources').insert(sourceRow);
    if (sourceError) {
      throw new Error(sourceError.message || 'MEMORY_SOURCE_CREATE_FAILED');
    }
  }

  // Generate and store embedding asynchronously (best-effort, never blocks creation)
  if (isEmbeddingEnabled()) {
    const embeddingText = [insertRow.title, insertRow.content].filter(Boolean).join(' ').trim();
    void generateEmbedding(embeddingText).then((emb) => {
      if (emb) return storeMemoryEmbedding(id, emb);
    }).catch(debugCatchError(logger, '[MEMORY] embedding'));
  }

  return data;
}

export async function addMemoryFeedback(params: FeedbackParams) {
  const client = ensureSupabase();

  const { data: existing, error: existingError } = await client
    .from('memory_items')
    .select('id, guild_id, pinned, status')
    .eq('id', params.memoryId)
    .eq('guild_id', params.guildId)
    .single();

  if (existingError || !existing) {
    throw new Error('MEMORY_NOT_FOUND');
  }

  const feedbackRow = {
    memory_item_id: params.memoryId,
    guild_id: params.guildId,
    action: params.action,
    actor_id: params.actorId,
    reason: params.reason || null,
    patch: params.patch || null,
  };

  const { error: feedbackError } = await client.from('memory_feedback').insert(feedbackRow);
  if (feedbackError) {
    throw new Error(feedbackError.message || 'MEMORY_FEEDBACK_FAILED');
  }

  const updatePatch: Record<string, unknown> = {
    updated_by: params.actorId,
  };

  if (params.action === 'pin') updatePatch.pinned = true;
  if (params.action === 'unpin') updatePatch.pinned = false;
  if (params.action === 'deprecate') updatePatch.status = 'deprecated';
  if (params.action === 'restore') updatePatch.status = 'active';
  if (params.action === 'approve') {
    updatePatch.approved_by = params.actorId;
    updatePatch.approved_at = new Date().toISOString();
  }
  if (params.action === 'edit' && params.patch) {
    if (typeof params.patch.content === 'string') updatePatch.content = params.patch.content;
    if (typeof params.patch.summary === 'string') updatePatch.summary = params.patch.summary;
    if (typeof params.patch.title === 'string') updatePatch.title = params.patch.title;
  }

  const { error: updateError } = await client
    .from('memory_items')
    .update(updatePatch)
    .eq('id', params.memoryId)
    .eq('guild_id', params.guildId);

  if (updateError) {
    throw new Error(updateError.message || 'MEMORY_UPDATE_FAILED');
  }
}

export async function listMemoryConflicts(params: { guildId: string; status: MemoryConflictStatus; limit: number }) {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('memory_conflicts')
    .select('id, conflict_key, item_a_id, item_b_id, status, created_at')
    .eq('guild_id', params.guildId)
    .eq('status', params.status)
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (error) {
    throw new Error(error.message || 'MEMORY_CONFLICTS_FAILED');
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    conflictKey: String(row.conflict_key || ''),
    itemAId: String(row.item_a_id || ''),
    itemBId: String(row.item_b_id || ''),
    status: String(row.status || ''),
    createdAt: String(row.created_at || ''),
  }));
}

export async function resolveMemoryConflict(params: {
  conflictId: number;
  guildId: string;
  actorId: string;
  status: Extract<MemoryConflictStatus, 'resolved' | 'ignored'>;
  resolution?: string;
  keepItemId?: string;
}) {
  const client = ensureSupabase();

  const { data: conflictRows, error: conflictReadError } = await client
    .from('memory_conflicts')
    .select('id, guild_id, item_a_id, item_b_id, status')
    .eq('id', params.conflictId)
    .eq('guild_id', params.guildId)
    .limit(1);

  if (conflictReadError) {
    throw new Error(conflictReadError.message || 'MEMORY_CONFLICT_READ_FAILED');
  }

  const conflict = (conflictRows || [])[0] as Record<string, unknown> | undefined;
  if (!conflict) {
    throw new Error('MEMORY_CONFLICT_NOT_FOUND');
  }

  const itemAId = String(conflict.item_a_id || '').trim();
  const itemBId = String(conflict.item_b_id || '').trim();
  const candidates = [itemAId, itemBId].filter(Boolean);

  if (params.status === 'resolved' && params.keepItemId && !candidates.includes(params.keepItemId)) {
    throw new Error('INVALID_KEEP_ITEM_ID');
  }

  const now = new Date().toISOString();
  const updatePatch = {
    status: params.status,
    resolution: params.resolution || null,
    resolved_by: params.actorId,
    resolved_at: now,
    updated_at: now,
  };

  const { error: conflictUpdateError } = await client
    .from('memory_conflicts')
    .update(updatePatch)
    .eq('id', params.conflictId)
    .eq('guild_id', params.guildId);

  if (conflictUpdateError) {
    throw new Error(conflictUpdateError.message || 'MEMORY_CONFLICT_UPDATE_FAILED');
  }

  if (params.status === 'resolved' && params.keepItemId) {
    const toDeprecate = candidates.filter((id) => id !== params.keepItemId);
    if (toDeprecate.length > 0) {
      const { error: deprecateError } = await client
        .from('memory_items')
        .update({
          status: 'deprecated',
          updated_by: params.actorId,
        })
        .eq('guild_id', params.guildId)
        .in('id', toDeprecate);

      if (deprecateError) {
        throw new Error(deprecateError.message || 'MEMORY_CONFLICT_DEPRECATE_FAILED');
      }

      const feedbackRows = toDeprecate.map((memoryItemId) => ({
        memory_item_id: memoryItemId,
        guild_id: params.guildId,
        action: 'deprecate',
        actor_id: params.actorId,
        reason: params.resolution || `resolve_conflict:${params.conflictId}`,
        patch: {
          conflictId: params.conflictId,
          keepItemId: params.keepItemId,
        },
      }));
      const { error: feedbackError } = await client.from('memory_feedback').insert(feedbackRows);
      if (feedbackError) {
        throw new Error(feedbackError.message || 'MEMORY_CONFLICT_FEEDBACK_FAILED');
      }
    }
  }

  return {
    id: params.conflictId,
    guildId: params.guildId,
    status: params.status,
    resolvedBy: params.actorId,
    resolvedAt: now,
    keepItemId: params.keepItemId || null,
    itemAId,
    itemBId,
  };
}

export async function queueMemoryJob(params: QueueJobParams) {
  const client = ensureSupabase();
  const id = `mjob_${crypto.randomUUID()}`;

  const row = {
    id,
    guild_id: params.guildId,
    job_type: params.jobType,
    status: 'queued',
    next_attempt_at: new Date().toISOString(),
    input: {
      actorId: params.actorId,
      ...params.input,
    },
    window_started_at: params.windowStartedAt || null,
    window_ended_at: params.windowEndedAt || null,
  };

  const { data, error } = await client.from('memory_jobs').insert(row).select('*').single();
  if (error) {
    throw new Error(error.message || 'MEMORY_JOB_QUEUE_FAILED');
  }

  return data;
}
