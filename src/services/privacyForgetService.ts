import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../logger';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { withObsidianFileLock } from '../utils/obsidianFileLock';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type ForgetTableCounts = Record<string, number>;

type ForgetPreview = {
  scope: 'guild' | 'user';
  guildId?: string;
  userId?: string;
  supabase: {
    counts: ForgetTableCounts;
    totalCandidates: number;
  };
  obsidian: {
    attempted: boolean;
    candidatePaths: string[];
  };
};

type ForgetResult = {
  scope: 'guild' | 'user';
  guildId?: string;
  userId?: string;
  supabase: {
    counts: ForgetTableCounts;
    totalDeleted: number;
  };
  obsidian: {
    attempted: boolean;
    removedPaths: string[];
  };
};

const FORGET_OBSIDIAN_ENABLED = String(process.env.FORGET_OBSIDIAN_ENABLED || 'true').trim().toLowerCase() !== 'false';
const OBSIDIAN_VAULT_ROOT = getObsidianVaultRoot();
const FORGET_GUILD_TABLES = [
  'memory_feedback',
  'memory_conflicts',
  'memory_jobs',
  'memory_job_deadletters',
  'memory_retrieval_logs',
  'guild_lore_docs',
  'memory_items',
  'community_interaction_events',
  'community_relationship_edges',
  'community_actor_profiles',
  'agent_action_logs',
  'agent_sessions',
  'agent_conversation_turns',
  'agent_conversation_threads',
  'agent_action_policies',
  'agent_action_approval_requests',
] as const;

const sanitizeDiscordId = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!/^\d{6,30}$/.test(text)) {
    return '';
  }
  return text;
};

const resolveInsideVault = (...segments: string[]): string | null => {
  if (!OBSIDIAN_VAULT_ROOT) {
    return null;
  }

  const root = path.resolve(OBSIDIAN_VAULT_ROOT);
  const resolved = path.resolve(root, ...segments);
  const withSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved === root || resolved.startsWith(withSep)) {
    return resolved;
  }
  return null;
};

const getGuildLockKey = (guildId: string): string => `obsidian:guild:${guildId}`;

const isMissingTableError = (error: any): boolean => {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist') || message.includes('relation');
};

const addCount = (counts: ForgetTableCounts, key: string, count: number | null | undefined) => {
  const value = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
  counts[key] = (counts[key] || 0) + value;
};

const sumCounts = (counts: ForgetTableCounts): number => Object.values(counts).reduce((sum, count) => sum + count, 0);

const deleteByGuild = async (table: string, guildId: string): Promise<number> => {
  const client = getSupabaseClient();
  const { count, error } = await client
    .from(table)
    .delete({ count: 'exact' })
    .eq('guild_id', guildId);

  if (error) {
    if (isMissingTableError(error)) {
      return 0;
    }
    throw new Error(`${table}:${error.message || 'DELETE_FAILED'}`);
  }

  return Number(count || 0);
};

const countByGuild = async (table: string, guildId: string): Promise<number> => {
  const client = getSupabaseClient();
  const { count, error } = await client
    .from(table)
    .select('id', { head: true, count: 'exact' })
    .eq('guild_id', guildId);

  if (error) {
    if (isMissingTableError(error)) {
      return 0;
    }
    throw new Error(`${table}:${error.message || 'COUNT_FAILED'}`);
  }
  return Number(count || 0);
};

const countByColumn = async (table: string, column: string, value: string, guildId?: string): Promise<number> => {
  const client = getSupabaseClient();
  let query = client
    .from(table)
    .select('id', { head: true, count: 'exact' })
    .eq(column, value);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { count, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return 0;
    }
    throw new Error(`${table}:${error.message || 'COUNT_FAILED'}`);
  }
  return Number(count || 0);
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const removeIfExists = async (targetPath: string): Promise<boolean> => {
  if (!(await pathExists(targetPath))) {
    return false;
  }
  await fs.rm(targetPath, { recursive: true, force: true });
  return true;
};

const loadGuildFolderCandidates = async (guildId: string): Promise<string[]> => {
  const safeGuildId = sanitizeDiscordId(guildId);
  if (!safeGuildId) {
    return [];
  }

  const byMap = new Set<string>([safeGuildId]);
  const mapJson = String(process.env.OBSIDIAN_SYNC_GUILD_MAP_JSON || '').trim();
  const mapFile = String(process.env.OBSIDIAN_SYNC_GUILD_MAP_FILE || '').trim();

  const applyMap = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return;
    }
    for (const [folderName, mappedGuild] of Object.entries(raw as Record<string, unknown>)) {
      if (String(mappedGuild || '').trim() === safeGuildId) {
        const folder = String(folderName || '').trim();
        if (/^[0-9A-Za-z._-]{1,120}$/.test(folder)) {
          byMap.add(folder);
        }
      }
    }
  };

  if (mapJson) {
    try {
      applyMap(JSON.parse(mapJson));
    } catch {
      // Ignore map parse errors on erase path.
    }
  }

  if (mapFile) {
    try {
      const raw = await fs.readFile(mapFile, 'utf-8');
      applyMap(JSON.parse(raw));
    } catch {
      // Ignore map parse errors on erase path.
    }
  }

  return [...byMap].filter(Boolean);
};

const deleteGuildObsidian = async (guildId: string): Promise<string[]> => {
  if (!FORGET_OBSIDIAN_ENABLED || !OBSIDIAN_VAULT_ROOT) {
    return [];
  }

  const safeGuildId = sanitizeDiscordId(guildId);
  if (!safeGuildId) {
    return [];
  }

  return withObsidianFileLock({
    vaultRoot: OBSIDIAN_VAULT_ROOT,
    key: getGuildLockKey(safeGuildId),
    task: async () => {
      const folderCandidates = await loadGuildFolderCandidates(safeGuildId);
      const removed: string[] = [];

      for (const folderName of folderCandidates) {
        const guildPath = resolveInsideVault('guilds', folderName);
        if (!guildPath) continue;
        if (await removeIfExists(guildPath)) {
          removed.push(guildPath);
        }
      }

      return removed;
    },
  });
};

const getGuildObsidianCandidates = async (guildId: string): Promise<string[]> => {
  if (!FORGET_OBSIDIAN_ENABLED || !OBSIDIAN_VAULT_ROOT) {
    return [];
  }

  const safeGuildId = sanitizeDiscordId(guildId);
  if (!safeGuildId) {
    return [];
  }

  const folderCandidates = await loadGuildFolderCandidates(safeGuildId);
  return folderCandidates
    .map((folderName) => resolveInsideVault('guilds', folderName))
    .filter((value): value is string => Boolean(value));
};

const deleteUserObsidian = async (params: { guildId?: string; userId: string }): Promise<string[]> => {
  if (!FORGET_OBSIDIAN_ENABLED || !OBSIDIAN_VAULT_ROOT) {
    return [];
  }

  const safeUserId = sanitizeDiscordId(params.userId);
  if (!safeUserId) {
    return [];
  }

  const safeGuildId = params.guildId ? sanitizeDiscordId(params.guildId) : undefined;

  return withObsidianFileLock({
    vaultRoot: OBSIDIAN_VAULT_ROOT,
    key: safeGuildId ? getGuildLockKey(safeGuildId) : `obsidian:user:${safeUserId}`,
    task: async () => {
      const removed: string[] = [];
      const candidatePaths = new Set<string>();

      const usersDir = resolveInsideVault('users', safeUserId);
      const usersFile = resolveInsideVault('users', `${safeUserId}.md`);
      if (usersDir) candidatePaths.add(usersDir);
      if (usersFile) candidatePaths.add(usersFile);

      if (safeGuildId) {
        const folderCandidates = await loadGuildFolderCandidates(safeGuildId);
        for (const folderName of folderCandidates) {
          const guildUserDir = resolveInsideVault('guilds', folderName, 'users', safeUserId);
          const guildUserFile = resolveInsideVault('guilds', folderName, 'users', `${safeUserId}.md`);
          if (guildUserDir) candidatePaths.add(guildUserDir);
          if (guildUserFile) candidatePaths.add(guildUserFile);
        }
      }

      for (const targetPath of candidatePaths) {
        if (await removeIfExists(targetPath)) {
          removed.push(targetPath);
        }
      }

      return removed;
    },
  });
};

const getUserObsidianCandidates = async (params: { guildId?: string; userId: string }): Promise<string[]> => {
  if (!FORGET_OBSIDIAN_ENABLED || !OBSIDIAN_VAULT_ROOT) {
    return [];
  }

  const safeUserId = sanitizeDiscordId(params.userId);
  if (!safeUserId) {
    return [];
  }

  const safeGuildId = params.guildId ? sanitizeDiscordId(params.guildId) : undefined;

  const candidatePaths = new Set<string>();
  const usersDir = resolveInsideVault('users', safeUserId);
  const usersFile = resolveInsideVault('users', `${safeUserId}.md`);
  if (usersDir) candidatePaths.add(usersDir);
  if (usersFile) candidatePaths.add(usersFile);

  if (safeGuildId) {
    const folderCandidates = await loadGuildFolderCandidates(safeGuildId);
    for (const folderName of folderCandidates) {
      const guildUserDir = resolveInsideVault('guilds', folderName, 'users', safeUserId);
      const guildUserFile = resolveInsideVault('guilds', folderName, 'users', `${safeUserId}.md`);
      if (guildUserDir) candidatePaths.add(guildUserDir);
      if (guildUserFile) candidatePaths.add(guildUserFile);
    }
  }

  return [...candidatePaths];
};

export const previewForgetGuildRagData = async (guildIdRaw: string): Promise<ForgetPreview> => {
  const guildId = String(guildIdRaw || '').trim();
  if (!guildId) {
    throw new Error('GUILD_ID_REQUIRED');
  }
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const counts: ForgetTableCounts = {};
  for (const table of FORGET_GUILD_TABLES) {
    addCount(counts, table, await countByGuild(table, guildId));
  }

  return {
    scope: 'guild',
    guildId,
    supabase: {
      counts,
      totalCandidates: sumCounts(counts),
    },
    obsidian: {
      attempted: FORGET_OBSIDIAN_ENABLED,
      candidatePaths: await getGuildObsidianCandidates(guildId),
    },
  };
};

export const previewForgetUserRagData = async (params: {
  userId: string;
  guildId?: string;
}): Promise<ForgetPreview> => {
  const userId = String(params.userId || '').trim();
  const guildId = String(params.guildId || '').trim() || undefined;
  if (!userId) {
    throw new Error('USER_ID_REQUIRED');
  }
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const counts: ForgetTableCounts = {};
  addCount(counts, 'memory_sources.source_author_id', await countByColumn('memory_sources', 'source_author_id', userId, guildId));
  {
    const client = getSupabaseClient();
    let query = client
      .from('memory_items')
      .select('id', { head: true, count: 'exact' })
      .or(`owner_user_id.eq.${userId},created_by.eq.${userId},updated_by.eq.${userId}`);

    if (guildId) {
      query = query.eq('guild_id', guildId);
    }

    const { count, error } = await query;
    if (error) {
      throw new Error(`memory_items:${error.message || 'COUNT_FAILED'}`);
    }
    addCount(counts, 'memory_items.user_linked', count);
  }
  addCount(counts, 'memory_feedback.actor_id', await countByColumn('memory_feedback', 'actor_id', userId, guildId));
  addCount(counts, 'community_interaction_events.actor_user_id', await countByColumn('community_interaction_events', 'actor_user_id', userId, guildId));
  addCount(counts, 'community_interaction_events.target_user_id', await countByColumn('community_interaction_events', 'target_user_id', userId, guildId));
  addCount(counts, 'community_relationship_edges.src_user_id', await countByColumn('community_relationship_edges', 'src_user_id', userId, guildId));
  addCount(counts, 'community_relationship_edges.dst_user_id', await countByColumn('community_relationship_edges', 'dst_user_id', userId, guildId));
  addCount(counts, 'community_actor_profiles.user_id', await countByColumn('community_actor_profiles', 'user_id', userId, guildId));
  addCount(counts, 'agent_action_logs.requested_by', await countByColumn('agent_action_logs', 'requested_by', userId, guildId));
  addCount(counts, 'agent_sessions.requested_by', await countByColumn('agent_sessions', 'requested_by', userId, guildId));
  addCount(counts, 'agent_conversation_threads.requested_by', await countByColumn('agent_conversation_threads', 'requested_by', userId, guildId));
  addCount(counts, 'agent_conversation_turns.created_by', await countByColumn('agent_conversation_turns', 'created_by', userId, guildId));
  addCount(counts, 'agent_action_approval_requests.requested_by', await countByColumn('agent_action_approval_requests', 'requested_by', userId, guildId));
  addCount(counts, 'agent_action_approval_requests.approved_by', await countByColumn('agent_action_approval_requests', 'approved_by', userId, guildId));

  return {
    scope: 'user',
    guildId,
    userId,
    supabase: {
      counts,
      totalCandidates: sumCounts(counts),
    },
    obsidian: {
      attempted: FORGET_OBSIDIAN_ENABLED,
      candidatePaths: await getUserObsidianCandidates({ guildId, userId }),
    },
  };
};

export const forgetGuildRagData = async (params: {
  guildId: string;
  reason?: string;
  requestedBy?: string;
  deleteObsidian?: boolean;
}): Promise<ForgetResult> => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('GUILD_ID_REQUIRED');
  }

  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const counts: ForgetTableCounts = {};
  for (const table of FORGET_GUILD_TABLES) {
    addCount(counts, table, await deleteByGuild(table, guildId));
  }

  let removedPaths: string[] = [];
  if (params.deleteObsidian !== false) {
    removedPaths = await deleteGuildObsidian(guildId);
  }

  const totalDeleted = sumCounts(counts);
  logger.warn(
    '[PRIVACY-FORGET] guild purge guild=%s requestedBy=%s reason=%s deleted=%d obsidianPaths=%d',
    guildId,
    String(params.requestedBy || 'system'),
    String(params.reason || 'n/a'),
    totalDeleted,
    removedPaths.length,
  );

  return {
    scope: 'guild',
    guildId,
    supabase: {
      counts,
      totalDeleted,
    },
    obsidian: {
      attempted: params.deleteObsidian !== false,
      removedPaths,
    },
  };
};

export const forgetUserRagData = async (params: {
  userId: string;
  guildId?: string;
  reason?: string;
  requestedBy?: string;
  deleteObsidian?: boolean;
}): Promise<ForgetResult> => {
  const userId = String(params.userId || '').trim();
  const guildId = String(params.guildId || '').trim() || undefined;

  if (!userId) {
    throw new Error('USER_ID_REQUIRED');
  }

  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const client = getSupabaseClient();
  const counts: ForgetTableCounts = {};

  // Collect memory item IDs tied to the user either as source author or item owner/editor.
  const memoryIds = new Set<string>();

  let sourceQuery = client
    .from('memory_sources')
    .select('memory_item_id')
    .eq('source_author_id', userId)
    .limit(5000);
  if (guildId) {
    sourceQuery = sourceQuery.eq('guild_id', guildId);
  }
  const { data: sourceRows, error: sourceSelectError } = await sourceQuery;
  if (sourceSelectError) {
    throw new Error(`memory_sources:${sourceSelectError.message || 'SELECT_FAILED'}`);
  }

  for (const row of (sourceRows || []) as Array<{ memory_item_id?: string }>) {
    const id = String(row.memory_item_id || '').trim();
    if (id) {
      memoryIds.add(id);
    }
  }

  let itemOwnerQuery = client
    .from('memory_items')
    .select('id')
    .or(`owner_user_id.eq.${userId},created_by.eq.${userId},updated_by.eq.${userId}`)
    .limit(5000);
  if (guildId) {
    itemOwnerQuery = itemOwnerQuery.eq('guild_id', guildId);
  }
  const { data: itemOwnerRows, error: itemOwnerError } = await itemOwnerQuery;
  if (itemOwnerError) {
    throw new Error(`memory_items:${itemOwnerError.message || 'SELECT_FAILED'}`);
  }

  for (const row of (itemOwnerRows || []) as Array<{ id?: string }>) {
    const id = String(row.id || '').trim();
    if (id) {
      memoryIds.add(id);
    }
  }

  // Delete user-linked source rows first.
  let sourceDeleteQuery = client
    .from('memory_sources')
    .delete({ count: 'exact' })
    .eq('source_author_id', userId);
  if (guildId) {
    sourceDeleteQuery = sourceDeleteQuery.eq('guild_id', guildId);
  }
  const { count: sourceDeleted, error: sourceDeleteError } = await sourceDeleteQuery;
  if (sourceDeleteError) {
    throw new Error(`memory_sources:${sourceDeleteError.message || 'DELETE_FAILED'}`);
  }
  addCount(counts, 'memory_sources', sourceDeleted);

  let feedbackDeleteQuery = client
    .from('memory_feedback')
    .delete({ count: 'exact' })
    .eq('actor_id', userId);
  if (guildId) {
    feedbackDeleteQuery = feedbackDeleteQuery.eq('guild_id', guildId);
  }
  const { count: feedbackDeleted, error: feedbackDeleteError } = await feedbackDeleteQuery;
  if (feedbackDeleteError) {
    throw new Error(`memory_feedback:${feedbackDeleteError.message || 'DELETE_FAILED'}`);
  }
  addCount(counts, 'memory_feedback', feedbackDeleted);

  let interactionActorDeleteQuery = client
    .from('community_interaction_events')
    .delete({ count: 'exact' })
    .eq('actor_user_id', userId);
  if (guildId) {
    interactionActorDeleteQuery = interactionActorDeleteQuery.eq('guild_id', guildId);
  }
  const { count: interactionActorDeleted, error: interactionActorDeleteError } = await interactionActorDeleteQuery;
  if (interactionActorDeleteError) {
    throw new Error(`community_interaction_events:${interactionActorDeleteError.message || 'DELETE_FAILED(actor_user_id)'}`);
  }
  addCount(counts, 'community_interaction_events.actor_user_id', interactionActorDeleted);

  let interactionTargetDeleteQuery = client
    .from('community_interaction_events')
    .delete({ count: 'exact' })
    .eq('target_user_id', userId);
  if (guildId) {
    interactionTargetDeleteQuery = interactionTargetDeleteQuery.eq('guild_id', guildId);
  }
  const { count: interactionTargetDeleted, error: interactionTargetDeleteError } = await interactionTargetDeleteQuery;
  if (interactionTargetDeleteError) {
    throw new Error(`community_interaction_events:${interactionTargetDeleteError.message || 'DELETE_FAILED(target_user_id)'}`);
  }
  addCount(counts, 'community_interaction_events.target_user_id', interactionTargetDeleted);

  let edgeSrcDeleteQuery = client
    .from('community_relationship_edges')
    .delete({ count: 'exact' })
    .eq('src_user_id', userId);
  if (guildId) {
    edgeSrcDeleteQuery = edgeSrcDeleteQuery.eq('guild_id', guildId);
  }
  const { count: edgeSrcDeleted, error: edgeSrcDeleteError } = await edgeSrcDeleteQuery;
  if (edgeSrcDeleteError) {
    throw new Error(`community_relationship_edges:${edgeSrcDeleteError.message || 'DELETE_FAILED(src_user_id)'}`);
  }
  addCount(counts, 'community_relationship_edges.src_user_id', edgeSrcDeleted);

  let edgeDstDeleteQuery = client
    .from('community_relationship_edges')
    .delete({ count: 'exact' })
    .eq('dst_user_id', userId);
  if (guildId) {
    edgeDstDeleteQuery = edgeDstDeleteQuery.eq('guild_id', guildId);
  }
  const { count: edgeDstDeleted, error: edgeDstDeleteError } = await edgeDstDeleteQuery;
  if (edgeDstDeleteError) {
    throw new Error(`community_relationship_edges:${edgeDstDeleteError.message || 'DELETE_FAILED(dst_user_id)'}`);
  }
  addCount(counts, 'community_relationship_edges.dst_user_id', edgeDstDeleted);

  let profileDeleteQuery = client
    .from('community_actor_profiles')
    .delete({ count: 'exact' })
    .eq('user_id', userId);
  if (guildId) {
    profileDeleteQuery = profileDeleteQuery.eq('guild_id', guildId);
  }
  const { count: profileDeleted, error: profileDeleteError } = await profileDeleteQuery;
  if (profileDeleteError) {
    throw new Error(`community_actor_profiles:${profileDeleteError.message || 'DELETE_FAILED(user_id)'}`);
  }
  addCount(counts, 'community_actor_profiles.user_id', profileDeleted);

  let actionLogsDeleteQuery = client
    .from('agent_action_logs')
    .delete({ count: 'exact' })
    .eq('requested_by', userId);
  if (guildId) {
    actionLogsDeleteQuery = actionLogsDeleteQuery.eq('guild_id', guildId);
  }
  const { count: actionLogsDeleted, error: actionLogsDeleteError } = await actionLogsDeleteQuery;
  if (actionLogsDeleteError) {
    throw new Error(`agent_action_logs:${actionLogsDeleteError.message || 'DELETE_FAILED'}`);
  }
  addCount(counts, 'agent_action_logs', actionLogsDeleted);

  let conversationThreadsDeleteQuery = client
    .from('agent_conversation_threads')
    .delete({ count: 'exact' })
    .eq('requested_by', userId);
  if (guildId) {
    conversationThreadsDeleteQuery = conversationThreadsDeleteQuery.eq('guild_id', guildId);
  }
  const { count: conversationThreadsDeleted, error: conversationThreadsDeleteError } = await conversationThreadsDeleteQuery;
  if (conversationThreadsDeleteError) {
    throw new Error(`agent_conversation_threads:${conversationThreadsDeleteError.message || 'DELETE_FAILED(requested_by)'}`);
  }
  addCount(counts, 'agent_conversation_threads.requested_by', conversationThreadsDeleted);

  let conversationTurnsByAuthorDeleteQuery = client
    .from('agent_conversation_turns')
    .delete({ count: 'exact' })
    .eq('created_by', userId);
  if (guildId) {
    conversationTurnsByAuthorDeleteQuery = conversationTurnsByAuthorDeleteQuery.eq('guild_id', guildId);
  }
  const { count: conversationTurnsByAuthorDeleted, error: conversationTurnsByAuthorDeleteError } = await conversationTurnsByAuthorDeleteQuery;
  if (conversationTurnsByAuthorDeleteError) {
    throw new Error(`agent_conversation_turns:${conversationTurnsByAuthorDeleteError.message || 'DELETE_FAILED(created_by)'}`);
  }
  addCount(counts, 'agent_conversation_turns.created_by', conversationTurnsByAuthorDeleted);

  let sessionIdsQuery = client
    .from('agent_sessions')
    .select('id')
    .eq('requested_by', userId);
  if (guildId) {
    sessionIdsQuery = sessionIdsQuery.eq('guild_id', guildId);
  }
  const { data: sessionRows, error: sessionIdsError } = await sessionIdsQuery;
  if (sessionIdsError) {
    throw new Error(`agent_sessions:${sessionIdsError.message || 'SELECT_FAILED(ids)'}`);
  }
  const sessionIds = (sessionRows || [])
    .map((row) => String((row as { id?: unknown }).id || '').trim())
    .filter(Boolean);
  if (sessionIds.length > 0) {
    let conversationTurnsBySessionDeleteQuery = client
      .from('agent_conversation_turns')
      .delete({ count: 'exact' })
      .in('session_id', sessionIds);
    if (guildId) {
      conversationTurnsBySessionDeleteQuery = conversationTurnsBySessionDeleteQuery.eq('guild_id', guildId);
    }
    const { count: conversationTurnsBySessionDeleted, error: conversationTurnsBySessionDeleteError } = await conversationTurnsBySessionDeleteQuery;
    if (conversationTurnsBySessionDeleteError) {
      throw new Error(`agent_conversation_turns:${conversationTurnsBySessionDeleteError.message || 'DELETE_FAILED(session_id)'}`);
    }
    addCount(counts, 'agent_conversation_turns.session_id', conversationTurnsBySessionDeleted);
  }

  let sessionsDeleteQuery = client
    .from('agent_sessions')
    .delete({ count: 'exact' })
    .eq('requested_by', userId);
  if (guildId) {
    sessionsDeleteQuery = sessionsDeleteQuery.eq('guild_id', guildId);
  }
  const { count: sessionsDeleted, error: sessionsDeleteError } = await sessionsDeleteQuery;
  if (sessionsDeleteError) {
    throw new Error(`agent_sessions:${sessionsDeleteError.message || 'DELETE_FAILED'}`);
  }
  addCount(counts, 'agent_sessions', sessionsDeleted);

  let approvalRequestedDeleteQuery = client
    .from('agent_action_approval_requests')
    .delete({ count: 'exact' })
    .eq('requested_by', userId);
  if (guildId) {
    approvalRequestedDeleteQuery = approvalRequestedDeleteQuery.eq('guild_id', guildId);
  }
  const { count: approvalsRequestedDeleted, error: approvalsRequestedDeleteError } = await approvalRequestedDeleteQuery;
  if (approvalsRequestedDeleteError) {
    throw new Error(`agent_action_approval_requests:${approvalsRequestedDeleteError.message || 'DELETE_FAILED(requested_by)'}`);
  }
  addCount(counts, 'agent_action_approval_requests.requested_by', approvalsRequestedDeleted);

  let approvalApprovedDeleteQuery = client
    .from('agent_action_approval_requests')
    .delete({ count: 'exact' })
    .eq('approved_by', userId);
  if (guildId) {
    approvalApprovedDeleteQuery = approvalApprovedDeleteQuery.eq('guild_id', guildId);
  }
  const { count: approvalsApprovedDeleted, error: approvalsApprovedDeleteError } = await approvalApprovedDeleteQuery;
  if (approvalsApprovedDeleteError) {
    throw new Error(`agent_action_approval_requests:${approvalsApprovedDeleteError.message || 'DELETE_FAILED(approved_by)'}`);
  }
  addCount(counts, 'agent_action_approval_requests.approved_by', approvalsApprovedDeleted);

  if (memoryIds.size > 0) {
    let itemDeleteQuery = client
      .from('memory_items')
      .delete({ count: 'exact' })
      .in('id', [...memoryIds]);

    if (guildId) {
      itemDeleteQuery = itemDeleteQuery.eq('guild_id', guildId);
    }

    const { count: itemDeleted, error: itemDeleteError } = await itemDeleteQuery;
    if (itemDeleteError) {
      throw new Error(`memory_items:${itemDeleteError.message || 'DELETE_FAILED'}`);
    }
    addCount(counts, 'memory_items', itemDeleted);
  }

  let removedPaths: string[] = [];
  if (params.deleteObsidian !== false) {
    removedPaths = await deleteUserObsidian({ guildId, userId });
  }

  const totalDeleted = sumCounts(counts);
  logger.warn(
    '[PRIVACY-FORGET] user purge guild=%s user=%s requestedBy=%s reason=%s deleted=%d obsidianPaths=%d',
    guildId || 'all',
    userId,
    String(params.requestedBy || 'system'),
    String(params.reason || 'n/a'),
    totalDeleted,
    removedPaths.length,
  );

  return {
    scope: 'user',
    guildId,
    userId,
    supabase: {
      counts,
      totalDeleted,
    },
    obsidian: {
      attempted: params.deleteObsidian !== false,
      removedPaths,
    },
  };
};
