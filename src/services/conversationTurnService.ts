import logger from '../logger';
import { parseIntegerEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type ConversationTurnType = 'user' | 'assistant' | 'tool' | 'system';

const THREAD_TABLE = 'agent_conversation_threads';
const TURN_TABLE = 'agent_conversation_turns';
const THREAD_IDLE_MS = Math.max(5 * 60_000, parseIntegerEnv(process.env.AGENT_CONVERSATION_THREAD_IDLE_MS, 6 * 60 * 60_000));

const toText = (value: unknown, max = 2000): string => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

const nowIso = () => new Date().toISOString();

const sanitizeGuildId = (value: unknown): string => {
  const text = String(value || '').trim();
  return /^\d{6,30}$/.test(text) ? text : '';
};

const ensureConfigured = () => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return getSupabaseClient();
};

const getLatestThread = async (params: {
  guildId: string;
  requestedBy: string;
}): Promise<{ id: number; last_turn_at: string | null } | null> => {
  const client = ensureConfigured();
  const { data, error } = await client
    .from(THREAD_TABLE)
    .select('id,last_turn_at')
    .eq('guild_id', params.guildId)
    .eq('requested_by', params.requestedBy)
    .eq('status', 'active')
    .order('last_turn_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const id = Number((data as Record<string, unknown>).id);
  if (!Number.isFinite(id)) {
    return null;
  }

  return {
    id,
    last_turn_at: String((data as Record<string, unknown>).last_turn_at || '').trim() || null,
  };
};

const createThread = async (params: {
  guildId: string;
  requestedBy: string;
  sessionId: string;
  title: string;
  sourceChannel?: string;
}): Promise<number> => {
  const client = ensureConfigured();
  const { data, error } = await client
    .from(THREAD_TABLE)
    .insert({
      guild_id: params.guildId,
      requested_by: params.requestedBy,
      source_channel: params.sourceChannel || null,
      title: toText(params.title, 200),
      status: 'active',
      last_session_id: params.sessionId,
      last_turn_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'CONVERSATION_THREAD_CREATE_FAILED');
  }

  const id = Number((data as Record<string, unknown>).id);
  if (!Number.isFinite(id)) {
    throw new Error('CONVERSATION_THREAD_ID_INVALID');
  }
  return id;
};

const resolveThreadId = async (params: {
  guildId: string;
  requestedBy: string;
  sessionId: string;
  title: string;
  sourceChannel?: string;
}): Promise<number> => {
  const latest = await getLatestThread({ guildId: params.guildId, requestedBy: params.requestedBy });
  if (!latest) {
    return createThread(params);
  }

  const lastTurnAtMs = Date.parse(String(latest.last_turn_at || ''));
  if (!Number.isFinite(lastTurnAtMs) || (Date.now() - lastTurnAtMs) > THREAD_IDLE_MS) {
    return createThread(params);
  }

  return latest.id;
};

const getNextTurnIndex = async (threadId: number): Promise<number> => {
  const client = ensureConfigured();
  const { data, error } = await client
    .from(TURN_TABLE)
    .select('turn_index')
    .eq('thread_id', threadId)
    .order('turn_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return 1;
  }

  const current = Number((data as Record<string, unknown>).turn_index);
  if (!Number.isFinite(current)) {
    return 1;
  }
  return Math.max(1, Math.trunc(current) + 1);
};

const appendTurn = async (params: {
  guildId: string;
  requestedBy: string;
  sessionId: string;
  threadId?: number | null;
  turnType: ConversationTurnType;
  content: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
  sourceChannel?: string;
}): Promise<{ threadId: number; turnIndex: number }> => {
  const guildId = sanitizeGuildId(params.guildId);
  if (!guildId || !params.sessionId || !params.createdBy) {
    throw new Error('VALIDATION');
  }

  const content = toText(params.content, 8000);
  if (!content) {
    throw new Error('EMPTY_CONTENT');
  }

  const threadId = Number.isFinite(Number(params.threadId))
    ? Number(params.threadId)
    : await resolveThreadId({
      guildId,
      requestedBy: params.requestedBy,
      sessionId: params.sessionId,
      title: content.slice(0, 180),
      sourceChannel: params.sourceChannel,
    });

  const turnIndex = await getNextTurnIndex(threadId);

  const client = ensureConfigured();
  const { error: turnError } = await client
    .from(TURN_TABLE)
    .insert({
      thread_id: threadId,
      guild_id: guildId,
      session_id: params.sessionId,
      turn_index: turnIndex,
      turn_type: params.turnType,
      content,
      metadata: params.metadata || {},
      created_by: params.createdBy,
      created_at: nowIso(),
    });

  if (turnError) {
    throw new Error(turnError.message || 'CONVERSATION_TURN_INSERT_FAILED');
  }

  const { error: threadUpdateError } = await client
    .from(THREAD_TABLE)
    .update({
      last_turn_at: nowIso(),
      last_session_id: params.sessionId,
      updated_at: nowIso(),
    })
    .eq('id', threadId);

  if (threadUpdateError) {
    logger.warn('[CONVERSATION-TURN] thread update failed thread=%d: %s', threadId, threadUpdateError.message);
  }

  return { threadId, turnIndex };
};

export const bindSessionUserTurn = async (params: {
  guildId: string;
  requestedBy: string;
  sessionId: string;
  goal: string;
  sourceChannel?: string;
}) => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return appendTurn({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    sessionId: params.sessionId,
    turnType: 'user',
    content: params.goal,
    createdBy: params.requestedBy,
    sourceChannel: params.sourceChannel,
  });
};

export const bindSessionAssistantTurn = async (params: {
  guildId: string;
  requestedBy: string;
  sessionId: string;
  threadId?: number | null;
  content: string;
  status: string;
  error?: string | null;
}) => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return appendTurn({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    sessionId: params.sessionId,
    threadId: params.threadId,
    turnType: 'assistant',
    content: params.content,
    createdBy: 'assistant',
    metadata: {
      status: params.status,
      error: params.error || null,
    },
  });
};

export const listConversationThreads = async (params: {
  guildId: string;
  requestedBy?: string;
  limit?: number;
}) => {
  const guildId = sanitizeGuildId(params.guildId);
  if (!guildId) {
    throw new Error('VALIDATION');
  }
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit || 50))));

  const client = ensureConfigured();
  let query = client
    .from(THREAD_TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .order('last_turn_at', { ascending: false })
    .limit(limit);

  const requestedBy = String(params.requestedBy || '').trim();
  if (requestedBy) {
    query = query.eq('requested_by', requestedBy);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'CONVERSATION_THREAD_LIST_FAILED');
  }
  return data || [];
};

export const listConversationTurns = async (params: {
  guildId: string;
  threadId: number;
  limit?: number;
}) => {
  const guildId = sanitizeGuildId(params.guildId);
  const threadId = Number(params.threadId);
  if (!guildId || !Number.isFinite(threadId) || threadId <= 0) {
    throw new Error('VALIDATION');
  }
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit || 200))));

  const client = ensureConfigured();
  const { data, error } = await client
    .from(TURN_TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('thread_id', threadId)
    .order('turn_index', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'CONVERSATION_TURN_LIST_FAILED');
  }
  return data || [];
};

export const getConversationThreadBySession = async (params: {
  guildId: string;
  sessionId: string;
}) => {
  const guildId = sanitizeGuildId(params.guildId);
  const sessionId = String(params.sessionId || '').trim();
  if (!guildId || !sessionId) {
    throw new Error('VALIDATION');
  }

  const client = ensureConfigured();
  const { data: sessionRow, error: sessionError } = await client
    .from('agent_sessions')
    .select('conversation_thread_id')
    .eq('id', sessionId)
    .eq('guild_id', guildId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(sessionError.message || 'CONVERSATION_SESSION_READ_FAILED');
  }

  const threadId = Number((sessionRow as Record<string, unknown> | null)?.conversation_thread_id || 0);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return null;
  }

  const turns = await listConversationTurns({ guildId, threadId, limit: 300 });
  return {
    threadId,
    turns,
  };
};

export const fetchRecentTurnsForUser = async (params: {
  guildId: string;
  requestedBy: string;
  limit?: number;
}): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> => {
  if (!isSupabaseConfigured()) return [];
  const guildId = sanitizeGuildId(params.guildId);
  if (!guildId || !params.requestedBy) return [];

  try {
    const latest = await getLatestThread({ guildId, requestedBy: params.requestedBy });
    if (!latest) return [];
    const lastMs = Date.parse(String(latest.last_turn_at || ''));
    if (!Number.isFinite(lastMs) || (Date.now() - lastMs) > THREAD_IDLE_MS) return [];

    const limit = Math.max(2, Math.min(10, Number(params.limit || 4)));
    const client = ensureConfigured();
    const { data, error } = await client
      .from(TURN_TABLE)
      .select('turn_type,content')
      .eq('guild_id', guildId)
      .eq('thread_id', latest.id)
      .in('turn_type', ['user', 'assistant'])
      .order('turn_index', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return (data as Array<{ turn_type: string; content: string }>)
      .reverse()
      .map((row) => ({
        role: row.turn_type === 'user' ? 'user' as const : 'assistant' as const,
        content: toText(row.content, 300),
      }));
  } catch {
    return [];
  }
};
