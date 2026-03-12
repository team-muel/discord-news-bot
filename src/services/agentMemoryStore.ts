import crypto from 'crypto';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const MEMORY_TYPES = ['episode', 'semantic', 'policy', 'preference'] as const;
const FEEDBACK_ACTIONS = ['pin', 'unpin', 'edit', 'deprecate', 'restore', 'approve', 'reject'] as const;
const CONFLICT_STATUSES = ['open', 'resolved', 'ignored'] as const;
const JOB_TYPES = ['short_summary', 'topic_synthesis', 'durable_extraction', 'reindex', 'conflict_scan', 'onboarding_snapshot'] as const;

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

const safeLike = (value: string): string => value.replace(/[%,]/g, ' ').trim();

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

export async function searchGuildMemory(params: SearchParams) {
  const client = ensureSupabase();
  const startedAt = Date.now();
  const cleanQuery = safeLike(params.query);

  let query = client
    .from('memory_items')
    .select('id, guild_id, channel_id, type, title, content, summary, confidence, pinned, updated_at, status')
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

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'MEMORY_SEARCH_FAILED');
  }

  const items = (data || []) as Array<Record<string, unknown>>;
  const ids = items.map((item) => String(item.id)).filter(Boolean);

  let citationsById = new Map<string, Array<{ sourceKind: string; sourceMessageId: string; sourceRef: string }>>();
  if (ids.length > 0) {
    const { data: sourceRows, error: sourceError } = await client
      .from('memory_sources')
      .select('memory_item_id, source_kind, source_message_id, source_ref')
      .in('memory_item_id', ids)
      .order('created_at', { ascending: false });

    if (sourceError) {
      throw new Error(sourceError.message || 'MEMORY_SOURCES_FAILED');
    }

    for (const row of (sourceRows || []) as Array<Record<string, unknown>>) {
      const memoryItemId = String(row.memory_item_id || '');
      if (!memoryItemId) continue;
      const current = citationsById.get(memoryItemId) || [];
      if (current.length < 3) {
        current.push(toCitation(row));
      }
      citationsById.set(memoryItemId, current);
    }
  }

  const responseItems = items.map((item) => {
    const id = String(item.id || '');
    const confidence = Number(item.confidence ?? 0.5);
    const recency = recencyScore(String(item.updated_at || ''));
    const pinnedBoost = item.pinned ? 1 : 0;
    const score = Math.max(0, Math.min(1, 0.55 * confidence + 0.30 * recency + 0.15 * pinnedBoost));

    return {
      id,
      type: String(item.type || ''),
      title: String(item.title || ''),
      content: String(item.content || ''),
      summary: String(item.summary || ''),
      confidence,
      pinned: Boolean(item.pinned),
      score,
      citations: citationsById.get(id) || [],
      updatedAt: String(item.updated_at || ''),
    };
  });

  const avgScore = responseItems.length > 0
    ? responseItems.reduce((acc, row) => acc + Number(row.score || 0), 0) / responseItems.length
    : 0;
  const avgCitations = responseItems.length > 0
    ? responseItems.reduce((acc, row) => acc + (Array.isArray(row.citations) ? row.citations.length : 0), 0) / responseItems.length
    : 0;

  await logRetrievalEvent({
    guildId: params.guildId,
    query: cleanQuery,
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
  const confidence = Number.isFinite(params.confidence) ? Math.max(0, Math.min(1, Number(params.confidence))) : 0.5;

  const insertRow = {
    id,
    guild_id: params.guildId,
    channel_id: params.channelId || null,
    owner_user_id: toMaybeUserId(params.ownerUserId)
      || toMaybeUserId(params.source?.sourceAuthorId)
      || toMaybeUserId(params.actorId),
    type: params.type,
    title: params.title || null,
    content: params.content,
    tags: (params.tags || []).filter(Boolean),
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
      source_ref: params.source.sourceRef || null,
      excerpt: params.source.excerpt || null,
      source_ts: new Date().toISOString(),
    };

    const { error: sourceError } = await client.from('memory_sources').insert(sourceRow);
    if (sourceError) {
      throw new Error(sourceError.message || 'MEMORY_SOURCE_CREATE_FAILED');
    }
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
