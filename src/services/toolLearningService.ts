import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type LearningScope = 'task_routing';
export type LearningCandidateStatus = 'pending' | 'approved' | 'rejected' | 'applied';
export type LearningRuleStatus = 'active' | 'inactive';

type ToolLearningLogParams = {
  guildId: string;
  requestedBy: string;
  scope: LearningScope;
  toolName: string;
  inputText?: string;
  outputSummary?: string;
  outcomeScore: number;
  reason?: string;
  metadata?: Record<string, unknown>;
};

type GenerateRoutingCandidatesParams = {
  guildId: string;
  days: number;
  minSamples: number;
  minOutcomeScore: number;
  actorId: string;
};

export type ToolLearningCandidate = {
  id: number;
  guildId: string;
  scope: LearningScope;
  signalKey: string;
  signalPattern: string;
  recommendedRoute: 'knowledge' | 'execution' | 'mixed' | 'casual';
  recommendedChannel: 'docs' | 'vibe';
  supportCount: number;
  avgOutcomeScore: number;
  status: LearningCandidateStatus;
  evidence: Record<string, unknown>;
  proposedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolLearningRule = {
  id: number;
  guildId: string;
  scope: LearningScope;
  signalKey: string;
  signalPattern: string;
  recommendedRoute: 'knowledge' | 'execution' | 'mixed' | 'casual';
  recommendedChannel: 'docs' | 'vibe';
  confidence: number;
  supportCount: number;
  status: LearningRuleStatus;
  sourceCandidateId: number | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const clamp01 = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

const toRoute = (value: unknown): 'knowledge' | 'execution' | 'mixed' | 'casual' | null => {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'knowledge' || v === 'execution' || v === 'mixed' || v === 'casual') return v;
  return null;
};

const toChannel = (value: unknown): 'docs' | 'vibe' | null => {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'docs' || v === 'vibe') return v;
  return null;
};

const normalizeGuildId = (value: unknown): string => {
  const text = String(value || '').trim();
  return /^\d{6,30}$/.test(text) ? text : '';
};

const normalizeReason = (value: unknown): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 220);
};

const makeSignalKey = (reason: string): string => {
  return reason
    .replace(/[^a-z0-9가-힣\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const makeSignalPattern = (reason: string): string => {
  const tokens = reason
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 4)
    .map((t) => escapeRegExp(t));

  if (tokens.length === 0) {
    return '.*';
  }
  if (tokens.length === 1) {
    return tokens[0];
  }
  return `(${tokens.join('|')})`;
};

const normalizeCandidateRow = (row: Record<string, unknown>): ToolLearningCandidate => ({
  id: Number(row.id || 0),
  guildId: String(row.guild_id || ''),
  scope: 'task_routing',
  signalKey: String(row.signal_key || ''),
  signalPattern: String(row.signal_pattern || ''),
  recommendedRoute: (toRoute(row.recommended_route) || 'mixed'),
  recommendedChannel: (toChannel(row.recommended_channel) || 'docs'),
  supportCount: Math.max(0, Math.trunc(Number(row.support_count || 0))),
  avgOutcomeScore: clamp01(row.avg_outcome_score),
  status: (['pending', 'approved', 'rejected', 'applied'].includes(String(row.status || ''))
    ? String(row.status)
    : 'pending') as LearningCandidateStatus,
  evidence: (row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
    ? row.evidence
    : {}) as Record<string, unknown>,
  proposedBy: row.proposed_by ? String(row.proposed_by) : null,
  decidedBy: row.decided_by ? String(row.decided_by) : null,
  decidedAt: row.decided_at ? String(row.decided_at) : null,
  createdAt: String(row.created_at || ''),
  updatedAt: String(row.updated_at || ''),
});

const normalizeRuleRow = (row: Record<string, unknown>): ToolLearningRule => ({
  id: Number(row.id || 0),
  guildId: String(row.guild_id || ''),
  scope: 'task_routing',
  signalKey: String(row.signal_key || ''),
  signalPattern: String(row.signal_pattern || ''),
  recommendedRoute: (toRoute(row.recommended_route) || 'mixed'),
  recommendedChannel: (toChannel(row.recommended_channel) || 'docs'),
  confidence: clamp01(row.confidence),
  supportCount: Math.max(0, Math.trunc(Number(row.support_count || 0))),
  status: (String(row.status || '') === 'inactive' ? 'inactive' : 'active'),
  sourceCandidateId: Number.isFinite(Number(row.source_candidate_id)) ? Number(row.source_candidate_id) : null,
  updatedBy: row.updated_by ? String(row.updated_by) : null,
  createdAt: String(row.created_at || ''),
  updatedAt: String(row.updated_at || ''),
});

export const recordToolLearningLog = async (params: ToolLearningLogParams): Promise<void> => {
  if (!isSupabaseConfigured()) return;
  const guildId = normalizeGuildId(params.guildId);
  if (!guildId) return;

  const client = getSupabaseClient();
  await client.from('agent_tool_learning_logs').insert({
    guild_id: guildId,
    requested_by: String(params.requestedBy || 'system').trim() || 'system',
    scope: params.scope,
    tool_name: String(params.toolName || '').trim().slice(0, 120),
    input_text: String(params.inputText || '').slice(0, 2000),
    output_summary: String(params.outputSummary || '').slice(0, 2000),
    outcome_score: clamp01(params.outcomeScore),
    reason: String(params.reason || '').slice(0, 300),
    metadata: params.metadata || {},
  });
};

export const generateTaskRoutingLearningCandidates = async (params: GenerateRoutingCandidatesParams): Promise<{
  generated: number;
  skipped: number;
  considered: number;
}> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  const guildId = normalizeGuildId(params.guildId);
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = Math.max(1, Math.min(90, Math.trunc(Number(params.days) || 14)));
  const minSamples = Math.max(2, Math.min(100, Math.trunc(Number(params.minSamples) || 4)));
  const minOutcomeScore = clamp01(params.minOutcomeScore);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_action_logs')
    .select('summary, artifacts, created_at')
    .eq('guild_id', guildId)
    .eq('action_name', 'task_routing_feedback')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(error.message || 'TASK_ROUTING_FEEDBACK_QUERY_FAILED');
  }

  const groups = new Map<string, {
    signalKey: string;
    signalPattern: string;
    route: 'knowledge' | 'execution' | 'mixed' | 'casual';
    channel: 'docs' | 'vibe';
    count: number;
    sum: number;
    examples: string[];
  }>();

  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const artifacts = Array.isArray(row.artifacts) ? row.artifacts : [];
    const first = (artifacts[0] && typeof artifacts[0] === 'object') ? (artifacts[0] as Record<string, unknown>) : {};
    const route = toRoute(first.route);
    const channel = toChannel(first.channel);
    const outcomeScore = clamp01(first.outcomeScore);
    const reasonRaw = normalizeReason(first.reason || row.summary || '');
    const signalKey = makeSignalKey(reasonRaw);

    if (!route || !channel || !signalKey || signalKey.length < 4) {
      continue;
    }

    const key = `${signalKey}::${route}::${channel}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        signalKey,
        signalPattern: makeSignalPattern(signalKey),
        route,
        channel,
        count: 1,
        sum: outcomeScore,
        examples: [reasonRaw].filter(Boolean).slice(0, 3),
      });
      continue;
    }

    existing.count += 1;
    existing.sum += outcomeScore;
    if (reasonRaw && existing.examples.length < 3 && !existing.examples.includes(reasonRaw)) {
      existing.examples.push(reasonRaw);
    }
  }

  let generated = 0;
  let skipped = 0;
  const considered = groups.size;

  for (const group of groups.values()) {
    const avgOutcomeScore = group.count > 0 ? group.sum / group.count : 0;
    if (group.count < minSamples || avgOutcomeScore < minOutcomeScore) {
      skipped += 1;
      continue;
    }

    const evidence = {
      source: 'task_routing_feedback',
      supportCount: group.count,
      avgOutcomeScore: Number(avgOutcomeScore.toFixed(4)),
      examples: group.examples,
      generatedAt: new Date().toISOString(),
      lookbackDays: days,
    };

    const { error: upsertError } = await client
      .from('agent_tool_learning_candidates')
      .upsert({
        guild_id: guildId,
        scope: 'task_routing',
        signal_key: group.signalKey,
        signal_pattern: group.signalPattern,
        recommended_route: group.route,
        recommended_channel: group.channel,
        support_count: group.count,
        avg_outcome_score: avgOutcomeScore,
        status: 'pending',
        evidence,
        proposed_by: String(params.actorId || 'system').trim() || 'system',
      }, { onConflict: 'guild_id,scope,signal_key,recommended_route,recommended_channel' });

    if (!upsertError) {
      generated += 1;
    }
  }

  return { generated, skipped, considered };
};

export const listToolLearningCandidates = async (params: {
  guildId: string;
  status?: LearningCandidateStatus;
  limit?: number;
}): Promise<ToolLearningCandidate[]> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = normalizeGuildId(params.guildId);
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit) || 50)));
  const client = getSupabaseClient();
  let query = client
    .from('agent_tool_learning_candidates')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'TOOL_LEARNING_CANDIDATE_LIST_FAILED');
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => normalizeCandidateRow(row));
};

export const decideToolLearningCandidate = async (params: {
  guildId: string;
  candidateId: number;
  decision: 'approved' | 'rejected' | 'applied';
  actorId: string;
  applyNow?: boolean;
}): Promise<{ candidate: ToolLearningCandidate; appliedRule?: ToolLearningRule | null }> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = normalizeGuildId(params.guildId);
  if (!guildId || !Number.isFinite(params.candidateId)) {
    throw new Error('VALIDATION');
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_tool_learning_candidates')
    .select('*')
    .eq('guild_id', guildId)
    .eq('id', params.candidateId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'TOOL_LEARNING_CANDIDATE_READ_FAILED');
  }
  if (!data) {
    throw new Error('TOOL_LEARNING_CANDIDATE_NOT_FOUND');
  }

  const candidate = normalizeCandidateRow(data as Record<string, unknown>);
  const now = new Date().toISOString();
  const nextStatus: LearningCandidateStatus = params.decision;

  const { data: updatedRow, error: updateError } = await client
    .from('agent_tool_learning_candidates')
    .update({
      status: nextStatus,
      decided_by: String(params.actorId || 'api').trim() || 'api',
      decided_at: now,
      updated_at: now,
    })
    .eq('guild_id', guildId)
    .eq('id', params.candidateId)
    .select('*')
    .single();

  if (updateError || !updatedRow) {
    throw new Error(updateError?.message || 'TOOL_LEARNING_CANDIDATE_DECISION_FAILED');
  }

  let appliedRule: ToolLearningRule | null = null;
  const shouldApply = params.applyNow === true || params.decision === 'applied';
  if (shouldApply && (params.decision === 'approved' || params.decision === 'applied')) {
    appliedRule = await upsertToolLearningRuleFromCandidate({
      guildId,
      candidate: normalizeCandidateRow(updatedRow as Record<string, unknown>),
      actorId: params.actorId,
    });

    if (params.decision === 'approved') {
      const { data: appliedCandidateRow } = await client
        .from('agent_tool_learning_candidates')
        .update({ status: 'applied', updated_at: now })
        .eq('guild_id', guildId)
        .eq('id', params.candidateId)
        .select('*')
        .single();
      if (appliedCandidateRow) {
        return { candidate: normalizeCandidateRow(appliedCandidateRow as Record<string, unknown>), appliedRule };
      }
    }
  }

  return { candidate: normalizeCandidateRow(updatedRow as Record<string, unknown>), appliedRule };
};

const upsertToolLearningRuleFromCandidate = async (params: {
  guildId: string;
  candidate: ToolLearningCandidate;
  actorId: string;
}): Promise<ToolLearningRule> => {
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('agent_tool_learning_rules')
    .upsert({
      guild_id: params.guildId,
      scope: params.candidate.scope,
      signal_key: params.candidate.signalKey,
      signal_pattern: params.candidate.signalPattern,
      recommended_route: params.candidate.recommendedRoute,
      recommended_channel: params.candidate.recommendedChannel,
      confidence: params.candidate.avgOutcomeScore,
      support_count: params.candidate.supportCount,
      status: 'active',
      source_candidate_id: params.candidate.id,
      updated_by: String(params.actorId || 'api').trim() || 'api',
      updated_at: now,
    }, { onConflict: 'guild_id,scope,signal_key,recommended_route,recommended_channel' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'TOOL_LEARNING_RULE_UPSERT_FAILED');
  }

  return normalizeRuleRow(data as Record<string, unknown>);
};

export const listToolLearningRules = async (params: {
  guildId: string;
  status?: LearningRuleStatus;
  limit?: number;
}): Promise<ToolLearningRule[]> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = normalizeGuildId(params.guildId);
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit) || 50)));
  const client = getSupabaseClient();
  let query = client
    .from('agent_tool_learning_rules')
    .select('*')
    .eq('guild_id', guildId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'TOOL_LEARNING_RULE_LIST_FAILED');
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => normalizeRuleRow(row));
};

export const buildToolLearningWeeklyReport = async (params: {
  guildId: string;
  days?: number;
}): Promise<Record<string, unknown>> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = normalizeGuildId(params.guildId);
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = Math.max(1, Math.min(90, Math.trunc(Number(params.days) || 7)));
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const client = getSupabaseClient();

  const [feedbackRes, candidateRes, ruleRes] = await Promise.all([
    client
      .from('agent_action_logs')
      .select('artifacts, created_at')
      .eq('guild_id', guildId)
      .eq('action_name', 'task_routing_feedback')
      .gte('created_at', sinceIso)
      .limit(5000),
    client
      .from('agent_tool_learning_candidates')
      .select('status, support_count, avg_outcome_score, recommended_route, recommended_channel, created_at')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .limit(1000),
    client
      .from('agent_tool_learning_rules')
      .select('status, confidence, support_count, recommended_route, recommended_channel, updated_at')
      .eq('guild_id', guildId)
      .limit(1000),
  ]);

  if (feedbackRes.error) {
    throw new Error(feedbackRes.error.message || 'TOOL_LEARNING_REPORT_FEEDBACK_QUERY_FAILED');
  }
  if (candidateRes.error) {
    throw new Error(candidateRes.error.message || 'TOOL_LEARNING_REPORT_CANDIDATE_QUERY_FAILED');
  }
  if (ruleRes.error) {
    throw new Error(ruleRes.error.message || 'TOOL_LEARNING_REPORT_RULE_QUERY_FAILED');
  }

  const feedbackRows = (feedbackRes.data || []) as Array<Record<string, unknown>>;
  const feedbackStats = new Map<string, { count: number; sum: number }>();
  for (const row of feedbackRows) {
    const artifacts = Array.isArray(row.artifacts) ? row.artifacts : [];
    const first = artifacts[0] && typeof artifacts[0] === 'object' ? artifacts[0] as Record<string, unknown> : {};
    const route = toRoute(first.route) || 'mixed';
    const channel = toChannel(first.channel) || 'docs';
    const key = `${route}:${channel}`;
    const score = clamp01(first.outcomeScore);
    const curr = feedbackStats.get(key) || { count: 0, sum: 0 };
    curr.count += 1;
    curr.sum += score;
    feedbackStats.set(key, curr);
  }

  const routePerformance = [...feedbackStats.entries()].map(([key, value]) => {
    const [route, channel] = key.split(':');
    return {
      route,
      channel,
      samples: value.count,
      avgOutcomeScore: Number((value.sum / Math.max(1, value.count)).toFixed(4)),
    };
  }).sort((a, b) => b.avgOutcomeScore - a.avgOutcomeScore);

  const candidateRows = (candidateRes.data || []) as Array<Record<string, unknown>>;
  const ruleRows = (ruleRes.data || []) as Array<Record<string, unknown>>;

  return {
    guildId,
    windowDays: days,
    generatedAt: new Date().toISOString(),
    feedback: {
      totalSamples: feedbackRows.length,
      routePerformance,
    },
    candidates: {
      total: candidateRows.length,
      pending: candidateRows.filter((row) => String(row.status) === 'pending').length,
      approved: candidateRows.filter((row) => String(row.status) === 'approved').length,
      rejected: candidateRows.filter((row) => String(row.status) === 'rejected').length,
      applied: candidateRows.filter((row) => String(row.status) === 'applied').length,
      avgSupportCount: candidateRows.length > 0
        ? Number((candidateRows.reduce((acc, row) => acc + Math.max(0, Math.trunc(Number(row.support_count || 0))), 0) / candidateRows.length).toFixed(2))
        : 0,
    },
    rules: {
      total: ruleRows.length,
      active: ruleRows.filter((row) => String(row.status || 'active') !== 'inactive').length,
      inactive: ruleRows.filter((row) => String(row.status || '') === 'inactive').length,
      avgConfidence: ruleRows.length > 0
        ? Number((ruleRows.reduce((acc, row) => acc + clamp01(row.confidence), 0) / ruleRows.length).toFixed(4))
        : 0,
    },
  };
};
