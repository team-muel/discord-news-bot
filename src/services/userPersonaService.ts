import { createMemoryItem } from './agent/agentMemoryStore';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type PersonaSnapshotParams = {
  guildId: string;
  targetUserId: string;
  requesterUserId?: string;
  isAdmin?: boolean;
  relationLimit?: number;
  noteLimit?: number;
};

type PersonalCommentParams = {
  guildId: string;
  targetUserId: string;
  authorUserId: string;
  content: string;
  channelId?: string;
  visibility?: 'private' | 'guild';
};

const sanitizeDiscordId = (value: unknown): string => {
  const text = String(value || '').trim();
  return /^\d{6,30}$/.test(text) ? text : '';
};

const cleanText = (value: unknown, max = 1000): string => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || '').trim()).filter(Boolean);
};

const uniqueTags = (tags: string[]): string[] => [...new Set(tags.map((tag) => cleanText(tag, 40)).filter(Boolean))].slice(0, 16);

const hasSensitivePattern = (text: string): boolean => {
  const value = String(text || '');
  const patterns = [
    /(?:password|passwd|비밀번호|토큰|token|api\s*key|secret)/i,
    /(?:\b\d{2,3}-\d{3,4}-\d{4}\b)/,
    /(?:\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b)/,
    /(?:주민등록|신분증|여권|계좌번호|카드번호)/,
  ];
  return patterns.some((re) => re.test(value));
};

const resolveVisibilityFromTags = (tags: string[]): 'private' | 'guild' => {
  const normalized = tags.map((tag) => String(tag || '').trim().toLowerCase());
  if (normalized.includes('visibility:guild')) {
    return 'guild';
  }
  return 'private';
};

export const getUserPersonaSnapshot = async (params: PersonaSnapshotParams) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = sanitizeDiscordId(params.guildId);
  const targetUserId = sanitizeDiscordId(params.targetUserId);
  const requesterUserId = sanitizeDiscordId(params.requesterUserId);
  const isAdmin = Boolean(params.isAdmin);
  if (!guildId || !targetUserId) {
    throw new Error('VALIDATION');
  }

  const relationLimit = Math.max(1, Math.min(10, Math.trunc(params.relationLimit || 4)));
  const noteLimit = Math.max(1, Math.min(10, Math.trunc(params.noteLimit || 4)));
  const client = getSupabaseClient();

  const [profileRes, outboundRes, inboundRes, notesRes] = await Promise.all([
    client
      .from('community_actor_profiles')
      .select('user_id, role_tags, preferred_topics, communication_style, escalation_risk, confidence, profile_summary, first_seen_at, last_seen_at, updated_at')
      .eq('guild_id', guildId)
      .eq('user_id', targetUserId)
      .maybeSingle(),
    client
      .from('community_relationship_edges')
      .select('dst_user_id, affinity_score, trust_score, interaction_count, last_interaction_at')
      .eq('guild_id', guildId)
      .eq('src_user_id', targetUserId)
      .order('affinity_score', { ascending: false })
      .order('last_interaction_at', { ascending: false })
      .limit(relationLimit),
    client
      .from('community_relationship_edges')
      .select('src_user_id, affinity_score, trust_score, interaction_count, last_interaction_at')
      .eq('guild_id', guildId)
      .eq('dst_user_id', targetUserId)
      .order('affinity_score', { ascending: false })
      .order('last_interaction_at', { ascending: false })
      .limit(relationLimit),
    client
      .from('memory_items')
      .select('id, type, title, summary, content, confidence, tags, pinned, updated_at, created_by')
      .eq('guild_id', guildId)
      .eq('owner_user_id', targetUserId)
      .eq('status', 'active')
      .in('type', ['preference', 'semantic'])
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(noteLimit),
  ]);

  if (profileRes.error) throw new Error(profileRes.error.message || 'PERSONA_PROFILE_QUERY_FAILED');
  if (outboundRes.error) throw new Error(outboundRes.error.message || 'PERSONA_RELATION_OUT_QUERY_FAILED');
  if (inboundRes.error) throw new Error(inboundRes.error.message || 'PERSONA_RELATION_IN_QUERY_FAILED');
  if (notesRes.error) throw new Error(notesRes.error.message || 'PERSONA_NOTES_QUERY_FAILED');

  const profileRaw = profileRes.data as Record<string, unknown> | null;
  const outboundRows = (outboundRes.data || []) as Array<Record<string, unknown>>;
  const inboundRows = (inboundRes.data || []) as Array<Record<string, unknown>>;
  const noteRows = (notesRes.data || []) as Array<Record<string, unknown>>;

  const filteredNotes = noteRows
    .map((row) => {
      const tags = parseStringArray(row.tags);
      const visibility = resolveVisibilityFromTags(tags);
      const createdBy = String(row.created_by || '');
      const canView = isAdmin
        || requesterUserId === targetUserId
        || requesterUserId === createdBy
        || visibility === 'guild';
      return {
        row,
        tags,
        visibility,
        canView,
      };
    })
    .filter((item) => item.canView)
    .map((item) => ({
      id: String(item.row.id || ''),
      type: String(item.row.type || ''),
      title: cleanText(item.row.title, 80),
      summary: cleanText(item.row.summary || item.row.content, 240),
      confidence: Number(item.row.confidence || 0),
      pinned: Boolean(item.row.pinned),
      tags: item.tags,
      visibility: item.visibility,
      updatedAt: String(item.row.updated_at || ''),
      createdBy: String(item.row.created_by || ''),
    }));

  return {
    guildId,
    targetUserId,
    profile: profileRaw ? {
      userId: String(profileRaw.user_id || targetUserId),
      roleTags: parseStringArray(profileRaw.role_tags),
      preferredTopics: parseStringArray(profileRaw.preferred_topics),
      communicationStyle: cleanText(profileRaw.communication_style, 200),
      escalationRisk: Number(profileRaw.escalation_risk || 0),
      confidence: Number(profileRaw.confidence || 0),
      summary: cleanText(profileRaw.profile_summary, 260),
      firstSeenAt: String(profileRaw.first_seen_at || ''),
      lastSeenAt: String(profileRaw.last_seen_at || ''),
      updatedAt: String(profileRaw.updated_at || ''),
    } : null,
    relations: {
      outbound: outboundRows.map((row) => ({
        userId: String(row.dst_user_id || ''),
        affinity: Number(row.affinity_score || 0),
        trust: Number(row.trust_score || 0),
        interactions: Math.max(0, Number(row.interaction_count || 0)),
        lastAt: String(row.last_interaction_at || ''),
      })),
      inbound: inboundRows.map((row) => ({
        userId: String(row.src_user_id || ''),
        affinity: Number(row.affinity_score || 0),
        trust: Number(row.trust_score || 0),
        interactions: Math.max(0, Number(row.interaction_count || 0)),
        lastAt: String(row.last_interaction_at || ''),
      })),
    },
    notes: filteredNotes,
    noteVisibility: {
      totalFetched: noteRows.length,
      visible: filteredNotes.length,
      hidden: Math.max(0, noteRows.length - filteredNotes.length),
    },
  };
};

export const createUserPersonalComment = async (params: PersonalCommentParams) => {
  const guildId = sanitizeDiscordId(params.guildId);
  const targetUserId = sanitizeDiscordId(params.targetUserId);
  const authorUserId = sanitizeDiscordId(params.authorUserId);
  const channelId = sanitizeDiscordId(params.channelId);
  const content = String(params.content || '').trim();

  if (!guildId || !targetUserId || !authorUserId || content.length < 4) {
    throw new Error('VALIDATION');
  }
  if (hasSensitivePattern(content)) {
    throw new Error('SENSITIVE_COMMENT_BLOCKED');
  }

  const visibility = params.visibility === 'guild' ? 'guild' : 'private';
  const tags = uniqueTags([
    'persona-note',
    'manual-comment',
    `user:${targetUserId}`,
    `author:${authorUserId}`,
    `visibility:${visibility}`,
  ]);

  const created = await createMemoryItem({
    guildId,
    channelId: channelId || undefined,
    type: 'preference',
    title: `persona:${targetUserId}`,
    content: content.slice(0, 1200),
    tags,
    confidence: 0.75,
    actorId: authorUserId,
    ownerUserId: targetUserId,
    source: {
      sourceKind: 'admin_edit',
      sourceAuthorId: authorUserId,
      sourceRef: `discord://guild/${guildId}/persona/${targetUserId}`,
      excerpt: content.slice(0, 280),
    },
  });

  return {
    id: String((created as { id?: unknown })?.id || ''),
    guildId,
    targetUserId,
    visibility,
  };
};
