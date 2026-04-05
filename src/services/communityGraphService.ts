import { SOCIAL_RECENCY_HALF_LIFE_DAYS } from '../config';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { hasSocialGraphConsent } from './agent/agentConsentService';

export type CommunityInteractionEventType = 'reply' | 'mention' | 'reaction' | 'co_presence';

const toDiscordId = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!/^\d{6,30}$/.test(text)) {
    return '';
  }
  return text;
};

const toIso = (value: unknown): string => {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
};

const eventWeight = (eventType: CommunityInteractionEventType): number => {
  if (eventType === 'reply') return 1.0;
  if (eventType === 'mention') return 0.7;
  if (eventType === 'reaction') return 0.4;
  return 0.2;
};

const clampWeight = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(3, numeric));
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizeSummaryDays = (days: number | undefined): number => {
  const raw = Number(days);
  if (!Number.isFinite(raw)) {
    return 14;
  }
  return Math.max(1, Math.min(90, Math.trunc(raw)));
};

const recencyScoreFromIso = (iso: string): number => {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return 0.45;
  }
  const ageDays = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  return clamp01(Math.exp(-ageDays / SOCIAL_RECENCY_HALF_LIFE_DAYS));
};

const dynamicRelationshipScore = (params: {
  affinity: number;
  trust: number;
  recency: number;
  reciprocity: number;
}): { dynamicAffinity: number; dynamicTrust: number } => {
  const dynamicAffinity = clamp01((params.affinity * 0.55) + (params.recency * 0.25) + (params.reciprocity * 0.20));
  const dynamicTrust = clamp01((params.trust * 0.60) + (params.recency * 0.25) + (params.reciprocity * 0.15));
  return {
    dynamicAffinity: Number(dynamicAffinity.toFixed(4)),
    dynamicTrust: Number(dynamicTrust.toFixed(4)),
  };
};

const computeAffinity = (params: {
  interactionCount: number;
  replyCount: number;
  mentionCount: number;
  reactionCount: number;
  coPresenceCount: number;
}): number => {
  const base =
    (params.replyCount * 1.0)
    + (params.mentionCount * 0.7)
    + (params.reactionCount * 0.4)
    + (params.coPresenceCount * 0.2);
  const normalized = Math.log1p(Math.max(0, base)) / Math.log(32);
  const withVolume = normalized + Math.min(0.2, Math.log1p(Math.max(0, params.interactionCount)) / 20);
  return Math.max(0, Math.min(1, Number(withVolume.toFixed(4))));
};

const pickEarlierIso = (a: string, b: string): string => {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) {
    return b;
  }
  if (!Number.isFinite(bMs)) {
    return a;
  }
  return aMs <= bMs ? a : b;
};

const pickLaterIso = (a: string, b: string): string => {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) {
    return b;
  }
  if (!Number.isFinite(bMs)) {
    return a;
  }
  return aMs >= bMs ? a : b;
};

const upsertCommunityActorProfile = async (params: {
  guildId: string;
  userId: string;
  eventTs: string;
}): Promise<void> => {
  const client = getSupabaseClient();
  const { data: current, error: currentError } = await client
    .from('community_actor_profiles')
    .select('first_seen_at,last_seen_at')
    .eq('guild_id', params.guildId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (currentError) {
    throw new Error(currentError.message || 'COMMUNITY_ACTOR_PROFILE_SELECT_FAILED');
  }

  const cur = current as Record<string, unknown> | null;
  const currentFirst = String(cur?.first_seen_at || '').trim();
  const currentLast = String(cur?.last_seen_at || '').trim();
  const mergedFirst = currentFirst ? pickEarlierIso(currentFirst, params.eventTs) : params.eventTs;
  const mergedLast = currentLast ? pickLaterIso(currentLast, params.eventTs) : params.eventTs;

  const { error: upsertError } = await client
    .from('community_actor_profiles')
    .upsert({
      guild_id: params.guildId,
      user_id: params.userId,
      first_seen_at: mergedFirst,
      last_seen_at: mergedLast,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id,user_id' });

  if (upsertError) {
    throw new Error(upsertError.message || 'COMMUNITY_ACTOR_PROFILE_UPSERT_FAILED');
  }
};

export const recordCommunityInteractionEvent = async (params: {
  guildId: string;
  actorUserId: string;
  targetUserId: string;
  channelId?: string;
  sourceMessageId?: string;
  eventType: CommunityInteractionEventType;
  eventTs?: string;
  weight?: number;
  metadata?: Record<string, unknown>;
  isPrivateThread?: boolean;
}): Promise<void> => {
  if (!isSupabaseConfigured()) {
    return;
  }

  // Skip private thread interactions from social graph unless explicitly allowed
  if (params.isPrivateThread) {
    return;
  }

  const guildId = toDiscordId(params.guildId);
  const actorUserId = toDiscordId(params.actorUserId);
  const targetUserId = toDiscordId(params.targetUserId);
  if (!guildId || !actorUserId || !targetUserId || actorUserId === targetUserId) {
    return;
  }

  const [actorConsent, targetConsent] = await Promise.all([
    hasSocialGraphConsent({ guildId, userId: actorUserId }),
    hasSocialGraphConsent({ guildId, userId: targetUserId }),
  ]);
  if (!actorConsent || !targetConsent) {
    return;
  }

  const client = getSupabaseClient();
  const eventType = params.eventType;
  const eventTs = toIso(params.eventTs);
  const weight = clampWeight(params.weight, eventWeight(eventType));

  const { error: insertError } = await client
    .from('community_interaction_events')
    .insert({
      guild_id: guildId,
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      channel_id: toDiscordId(params.channelId) || null,
      source_message_id: String(params.sourceMessageId || '').trim() || null,
      event_type: eventType,
      event_ts: eventTs,
      weight,
      metadata: params.metadata || {},
    });

  if (insertError) {
    throw new Error(insertError.message || 'COMMUNITY_INTERACTION_INSERT_FAILED');
  }

  const { data: current, error: selectError } = await client
    .from('community_relationship_edges')
    .select('interaction_count,reply_count,mention_count,reaction_count,co_presence_count,first_interaction_at,last_interaction_at')
    .eq('guild_id', guildId)
    .eq('src_user_id', actorUserId)
    .eq('dst_user_id', targetUserId)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message || 'COMMUNITY_EDGE_SELECT_FAILED');
  }

  // Atomic-safe: start from DB values if present but use them in the same upsert
  // to minimise TOCTOU window. True atomicity requires server-side SQL increment.
  const prev = current as Record<string, unknown> | null;
  const interactionCount = Math.max(0, Number(prev?.interaction_count || 0)) + 1;
  const replyCount = Math.max(0, Number(prev?.reply_count || 0)) + (eventType === 'reply' ? 1 : 0);
  const mentionCount = Math.max(0, Number(prev?.mention_count || 0)) + (eventType === 'mention' ? 1 : 0);
  const reactionCount = Math.max(0, Number(prev?.reaction_count || 0)) + (eventType === 'reaction' ? 1 : 0);
  const coPresenceCount = Math.max(0, Number(prev?.co_presence_count || 0)) + (eventType === 'co_presence' ? 1 : 0);

  const first = String(prev?.first_interaction_at || '').trim();
  const firstInteractionAt = first ? (Date.parse(first) <= Date.parse(eventTs) ? first : eventTs) : eventTs;
  const last = String(prev?.last_interaction_at || '').trim();
  const lastInteractionAt = last ? (Date.parse(last) >= Date.parse(eventTs) ? last : eventTs) : eventTs;

  const affinityScore = computeAffinity({
    interactionCount,
    replyCount,
    mentionCount,
    reactionCount,
    coPresenceCount,
  });

  const trustScore = Math.max(0, Math.min(1, Number((affinityScore * 0.85).toFixed(4))));

  const { error: upsertError } = await client
    .from('community_relationship_edges')
    .upsert({
      guild_id: guildId,
      src_user_id: actorUserId,
      dst_user_id: targetUserId,
      interaction_count: interactionCount,
      reply_count: replyCount,
      mention_count: mentionCount,
      reaction_count: reactionCount,
      co_presence_count: coPresenceCount,
      affinity_score: affinityScore,
      trust_score: trustScore,
      first_interaction_at: firstInteractionAt,
      last_interaction_at: lastInteractionAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id,src_user_id,dst_user_id' });

  if (upsertError) {
    throw new Error(upsertError.message || 'COMMUNITY_EDGE_UPSERT_FAILED');
  }

  await Promise.all([
    upsertCommunityActorProfile({ guildId, userId: actorUserId, eventTs }),
    upsertCommunityActorProfile({ guildId, userId: targetUserId, eventTs }),
  ]);
};

export const buildSocialContextHints = async (params: {
  guildId: string;
  requesterUserId?: string;
  maxItems?: number;
}): Promise<string[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const guildId = toDiscordId(params.guildId);
  const requesterUserId = toDiscordId(params.requesterUserId);
  const maxItems = Math.max(1, Math.min(12, Math.trunc(Number(params.maxItems || 4))));
  if (!guildId || !requesterUserId) {
    return [];
  }

  const client = getSupabaseClient();

  const [outboundRes, inboundRes] = await Promise.all([
    client
      .from('community_relationship_edges')
      .select('dst_user_id, affinity_score, trust_score, interaction_count, last_interaction_at')
      .eq('guild_id', guildId)
      .eq('src_user_id', requesterUserId)
      .order('affinity_score', { ascending: false })
      .order('last_interaction_at', { ascending: false })
      .limit(maxItems),
    client
      .from('community_relationship_edges')
      .select('src_user_id, affinity_score, trust_score, interaction_count, last_interaction_at')
      .eq('guild_id', guildId)
      .eq('dst_user_id', requesterUserId)
      .order('affinity_score', { ascending: false })
      .order('last_interaction_at', { ascending: false })
      .limit(maxItems),
  ]);

  if (outboundRes.error || inboundRes.error) {
    return [];
  }

  const inboundByUser = new Map<string, { affinity: number; trust: number }>();
  for (const row of (inboundRes.data || []) as Array<Record<string, unknown>>) {
    const userId = String(row.src_user_id || '').trim();
    if (!userId) continue;
    inboundByUser.set(userId, {
      affinity: Number(row.affinity_score || 0),
      trust: Number(row.trust_score || 0),
    });
  }

  const outboundByUser = new Map<string, { affinity: number; trust: number }>();
  for (const row of (outboundRes.data || []) as Array<Record<string, unknown>>) {
    const userId = String(row.dst_user_id || '').trim();
    if (!userId) continue;
    outboundByUser.set(userId, {
      affinity: Number(row.affinity_score || 0),
      trust: Number(row.trust_score || 0),
    });
  }

  const outHints = ((outboundRes.data || []) as Array<Record<string, unknown>>)
    .slice(0, maxItems)
    .map((row) => {
      const userId = String(row.dst_user_id || '').trim();
      const affinity = Number(row.affinity_score || 0);
      const trust = Number(row.trust_score || 0);
      const interactions = Math.max(0, Math.trunc(Number(row.interaction_count || 0)));
      const lastAt = String(row.last_interaction_at || '').trim();
      const reverse = inboundByUser.get(userId);
      const recency = recencyScoreFromIso(lastAt);
      const reciprocity = reverse ? clamp01(((reverse.affinity || 0) + (reverse.trust || 0)) / 2) : 0;
      const dynamic = dynamicRelationshipScore({ affinity, trust, recency, reciprocity });
      if (!userId) {
        return '';
      }
      return `[social:outbound] user=${userId} affinity=${affinity.toFixed(2)} trust=${trust.toFixed(2)} dynamic_affinity=${dynamic.dynamicAffinity.toFixed(2)} dynamic_trust=${dynamic.dynamicTrust.toFixed(2)} recency=${recency.toFixed(2)} reciprocity=${reciprocity.toFixed(2)} interactions=${interactions} last=${lastAt || 'n/a'}`;
    })
    .filter(Boolean);

  const inHints = ((inboundRes.data || []) as Array<Record<string, unknown>>)
    .slice(0, maxItems)
    .map((row) => {
      const userId = String(row.src_user_id || '').trim();
      const affinity = Number(row.affinity_score || 0);
      const trust = Number(row.trust_score || 0);
      const interactions = Math.max(0, Math.trunc(Number(row.interaction_count || 0)));
      const lastAt = String(row.last_interaction_at || '').trim();
      const reverse = outboundByUser.get(userId);
      const recency = recencyScoreFromIso(lastAt);
      const reciprocity = reverse ? clamp01(((reverse.affinity || 0) + (reverse.trust || 0)) / 2) : 0;
      const dynamic = dynamicRelationshipScore({ affinity, trust, recency, reciprocity });
      if (!userId) {
        return '';
      }
      return `[social:inbound] user=${userId} affinity=${affinity.toFixed(2)} trust=${trust.toFixed(2)} dynamic_affinity=${dynamic.dynamicAffinity.toFixed(2)} dynamic_trust=${dynamic.dynamicTrust.toFixed(2)} recency=${recency.toFixed(2)} reciprocity=${reciprocity.toFixed(2)} interactions=${interactions} last=${lastAt || 'n/a'}`;
    })
    .filter(Boolean);

  // Interleave outbound and inbound so both directions get fair representation
  const merged: string[] = [];
  const maxOut = outHints.length;
  const maxIn = inHints.length;
  for (let i = 0; merged.length < maxItems && (i < maxOut || i < maxIn); i++) {
    if (i < maxOut && merged.length < maxItems) merged.push(outHints[i]);
    if (i < maxIn && merged.length < maxItems) merged.push(inHints[i]);
  }
  return merged;
};

/**
 * Batch-fetch relationship strengths between a requester and multiple target users.
 * Returns a Map of targetUserId → max(affinity_score) from both directions.
 * Used by agentMemoryService to boost memory scoring for socially connected users.
 */
export const getRelationshipStrengths = async (params: {
  guildId: string;
  requesterUserId: string;
  targetUserIds: string[];
}): Promise<Map<string, number>> => {
  const result = new Map<string, number>();
  if (!params.requesterUserId || params.targetUserIds.length === 0 || !isSupabaseConfigured()) {
    return result;
  }

  try {
    const client = getSupabaseClient();

    // Query both directions in parallel
    const [outRes, inRes] = await Promise.all([
      client
        .from('community_relationship_edges')
        .select('dst_user_id, affinity_score')
        .eq('guild_id', params.guildId)
        .eq('src_user_id', params.requesterUserId)
        .in('dst_user_id', params.targetUserIds),
      client
        .from('community_relationship_edges')
        .select('src_user_id, affinity_score')
        .eq('guild_id', params.guildId)
        .eq('dst_user_id', params.requesterUserId)
        .in('src_user_id', params.targetUserIds),
    ]);

    if (outRes.data) {
      for (const row of outRes.data as Array<{ dst_user_id: string; affinity_score: number }>) {
        const current = result.get(row.dst_user_id) ?? 0;
        result.set(row.dst_user_id, Math.max(current, Number(row.affinity_score ?? 0)));
      }
    }
    if (inRes.data) {
      for (const row of inRes.data as Array<{ src_user_id: string; affinity_score: number }>) {
        const current = result.get(row.src_user_id) ?? 0;
        result.set(row.src_user_id, Math.max(current, Number(row.affinity_score ?? 0)));
      }
    }

    return result;
  } catch {
    return result;
  }
};

export const getCommunityGraphOperationalSummary = async (params: {
  guildId: string;
  days?: number;
  topEdgesLimit?: number;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = toDiscordId(params.guildId);
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = normalizeSummaryDays(params.days);
  const topEdgesLimit = Math.max(1, Math.min(10, Math.trunc(Number(params.topEdgesLimit || 5))));
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const client = getSupabaseClient();

  const [
    ingestedRes,
    activeEdgesRes,
    activeActorsRes,
    recentEventsRes,
    topEdgesRes,
  ] = await Promise.all([
    client
      .from('community_interaction_events')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .gte('event_ts', sinceIso),
    client
      .from('community_relationship_edges')
      .select('src_user_id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .gte('last_interaction_at', sinceIso),
    client
      .from('community_actor_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .gte('last_seen_at', sinceIso),
    client
      .from('community_interaction_events')
      .select('event_type,event_ts')
      .eq('guild_id', guildId)
      .gte('event_ts', sinceIso)
      .order('event_ts', { ascending: false })
      .limit(5000),
    client
      .from('community_relationship_edges')
      .select('src_user_id,dst_user_id,interaction_count,affinity_score,trust_score,last_interaction_at')
      .eq('guild_id', guildId)
      .gte('last_interaction_at', sinceIso)
      .order('interaction_count', { ascending: false })
      .order('affinity_score', { ascending: false })
      .limit(topEdgesLimit),
  ]);

  if (ingestedRes.error) {
    throw new Error(ingestedRes.error.message || 'COMMUNITY_GRAPH_INGESTED_COUNT_FAILED');
  }
  if (activeEdgesRes.error) {
    throw new Error(activeEdgesRes.error.message || 'COMMUNITY_GRAPH_ACTIVE_EDGES_FAILED');
  }
  if (activeActorsRes.error) {
    throw new Error(activeActorsRes.error.message || 'COMMUNITY_GRAPH_ACTIVE_ACTORS_FAILED');
  }
  if (recentEventsRes.error) {
    throw new Error(recentEventsRes.error.message || 'COMMUNITY_GRAPH_RECENT_EVENTS_FAILED');
  }
  if (topEdgesRes.error) {
    throw new Error(topEdgesRes.error.message || 'COMMUNITY_GRAPH_TOP_EDGES_FAILED');
  }

  const recentEvents = (recentEventsRes.data || []) as Array<Record<string, unknown>>;
  const eventTypeCounts: Record<CommunityInteractionEventType, number> = {
    reply: 0,
    mention: 0,
    reaction: 0,
    co_presence: 0,
  };

  let latestEventAt: string | null = null;
  for (const row of recentEvents) {
    const eventType = String(row.event_type || '').trim() as CommunityInteractionEventType;
    if (eventType in eventTypeCounts) {
      eventTypeCounts[eventType] += 1;
    }
    const eventTs = String(row.event_ts || '').trim();
    if (!latestEventAt && eventTs) {
      latestEventAt = eventTs;
    }
  }

  const topEdges = ((topEdgesRes.data || []) as Array<Record<string, unknown>>).map((row) => ({
    srcUserId: String(row.src_user_id || '').trim(),
    dstUserId: String(row.dst_user_id || '').trim(),
    interactionCount: Math.max(0, Math.trunc(Number(row.interaction_count || 0))),
    affinityScore: Number(Number(row.affinity_score || 0).toFixed(4)),
    trustScore: Number(Number(row.trust_score || 0).toFixed(4)),
    lastInteractionAt: String(row.last_interaction_at || '').trim() || null,
  }));

  return {
    guildId,
    days,
    since: sinceIso,
    socialEventsIngested: Math.max(0, Number(ingestedRes.count || 0)),
    activeEdges: Math.max(0, Number(activeEdgesRes.count || 0)),
    activeActors: Math.max(0, Number(activeActorsRes.count || 0)),
    latestEventAt,
    eventTypeCounts,
    topEdges,
    generatedAt: new Date().toISOString(),
  };
};
