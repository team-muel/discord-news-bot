import crypto from 'crypto';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { getAgentPrivacyPolicySnapshot } from './agentPrivacyPolicyService';
import type { AgentPolicyGateDecision, AgentDeliberationMode } from './multiAgentService';

type SampleRow = {
  id: number;
  guild_id: string;
  session_id: string;
  decision: AgentPolicyGateDecision;
  expected_decision: AgentPolicyGateDecision | null;
  risk_score: number;
  mode: AgentDeliberationMode;
  reasons: string[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export const recordPrivacyGateSample = async (params: {
  guildId: string;
  sessionId: string;
  mode: AgentDeliberationMode;
  decision: AgentPolicyGateDecision;
  riskScore: number;
  reasons: string[];
  goal: string;
}): Promise<void> => {
  if (!isSupabaseConfigured()) {
    return;
  }

  const goalText = String(params.goal || '');
  const goalHash = crypto.createHash('sha256').update(goalText).digest('hex');

  try {
    const client = getSupabaseClient();
    await client.from('agent_privacy_gate_samples').insert({
      guild_id: params.guildId,
      session_id: params.sessionId,
      mode: params.mode,
      decision: params.decision,
      risk_score: Math.max(0, Math.min(100, Math.trunc(params.riskScore))),
      reasons: params.reasons,
      goal_hash: goalHash,
      goal_length: goalText.length,
    });
  } catch {
    // best-effort audit logging
  }
};

export const listPrivacyGateSamples = async (params: {
  guildId: string;
  limit?: number;
  status?: 'reviewed' | 'unreviewed';
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const limit = Math.max(1, Math.min(200, Math.trunc(params.limit ?? 50)));
  const client = getSupabaseClient();
  let query = client
    .from('agent_privacy_gate_samples')
    .select('id, guild_id, session_id, mode, decision, expected_decision, risk_score, reasons, reviewed_by, reviewed_at, created_at')
    .eq('guild_id', params.guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.status === 'reviewed') {
    query = query.not('expected_decision', 'is', null);
  }
  if (params.status === 'unreviewed') {
    query = query.is('expected_decision', null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'PRIVACY_SAMPLES_LIST_FAILED');
  }
  return (data || []) as SampleRow[];
};

export const reviewPrivacyGateSample = async (params: {
  sampleId: number;
  expectedDecision: AgentPolicyGateDecision;
  reviewedBy: string;
  note?: string;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_privacy_gate_samples')
    .update({
      expected_decision: params.expectedDecision,
      reviewed_by: params.reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: params.note || null,
    })
    .eq('id', params.sampleId)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'PRIVACY_SAMPLE_REVIEW_FAILED');
  }
  return data;
};

const scoreDecision = (decision: AgentPolicyGateDecision): number => {
  if (decision === 'allow') return 0;
  if (decision === 'review') return 1;
  return 2;
};

export const buildPrivacyTuningRecommendation = async (params: {
  guildId: string;
  lookbackDays?: number;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const lookbackDays = Math.max(1, Math.min(90, Math.trunc(params.lookbackDays ?? 7)));
  const sinceIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_privacy_gate_samples')
    .select('decision, expected_decision')
    .eq('guild_id', params.guildId)
    .gte('created_at', sinceIso)
    .not('expected_decision', 'is', null)
    .limit(2000);

  if (error) {
    throw new Error(error.message || 'PRIVACY_TUNING_FETCH_FAILED');
  }

  const reviewed = (data || []) as Array<{ decision: AgentPolicyGateDecision; expected_decision: AgentPolicyGateDecision }>;
  let falsePositives = 0;
  let falseNegatives = 0;
  let exactMatches = 0;

  for (const row of reviewed) {
    const predicted = scoreDecision(row.decision);
    const expected = scoreDecision(row.expected_decision);
    if (predicted === expected) {
      exactMatches += 1;
      continue;
    }
    if (predicted > expected) {
      falsePositives += 1;
    } else {
      falseNegatives += 1;
    }
  }

  const policy = getAgentPrivacyPolicySnapshot(params.guildId);
  const delta = falseNegatives - falsePositives;
  let adjust = 0;
  if (delta >= 3) {
    adjust = -5;
  } else if (delta <= -3) {
    adjust = 5;
  }

  const nextReviewScore = Math.max(20, Math.min(95, policy.reviewScore + adjust));
  const rawBlock = policy.blockScore + adjust;
  const nextBlockScore = Math.max(nextReviewScore + 1, Math.min(100, rawBlock));

  return {
    guildId: params.guildId,
    lookbackDays,
    reviewedCount: reviewed.length,
    exactMatches,
    falsePositives,
    falseNegatives,
    current: {
      modeDefault: policy.modeDefault,
      reviewScore: policy.reviewScore,
      blockScore: policy.blockScore,
    },
    suggested: {
      reviewScore: nextReviewScore,
      blockScore: nextBlockScore,
      rationale: adjust === 0
        ? 'no_change_small_signal'
        : adjust < 0
          ? 'increase_strictness_detected_false_negatives'
          : 'decrease_strictness_detected_false_positives',
      confidence: reviewed.length >= 20 ? 'high' : reviewed.length >= 8 ? 'medium' : 'low',
    },
  };
};
