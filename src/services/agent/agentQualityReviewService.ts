import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

type ReviewStrategy = 'baseline' | 'tot' | 'got';

const toStrategy = (value: unknown): ReviewStrategy => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'tot' || normalized === 'got') {
    return normalized;
  }
  return 'baseline';
};

const normalizeDays = (days: number | undefined): number => {
  const raw = Number(days);
  if (!Number.isFinite(raw)) {
    return 14;
  }
  return Math.max(1, Math.min(90, Math.trunc(raw)));
};

export const recordAgentAnswerQualityReview = async (params: {
  guildId: string;
  reviewerId: string;
  strategy: ReviewStrategy;
  isHallucination: boolean;
  sessionId?: string;
  question?: string;
  answerExcerpt?: string;
  labelConfidence?: number;
  reviewNote?: string;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = String(params.guildId || '').trim();
  const reviewerId = String(params.reviewerId || '').trim();
  if (!guildId || !reviewerId) {
    throw new Error('VALIDATION');
  }

  const labelConfidenceRaw = Number(params.labelConfidence);
  const labelConfidence = Number.isFinite(labelConfidenceRaw)
    ? Math.max(0, Math.min(1, labelConfidenceRaw))
    : null;

  const client = getSupabaseClient();
  const { error } = await client
    .from('agent_answer_quality_reviews')
    .insert({
      guild_id: guildId,
      session_id: String(params.sessionId || '').trim() || null,
      strategy: toStrategy(params.strategy),
      question: String(params.question || '').trim().slice(0, 2000) || null,
      answer_excerpt: String(params.answerExcerpt || '').trim().slice(0, 4000) || null,
      is_hallucination: params.isHallucination === true,
      label_confidence: labelConfidence,
      reviewer_id: reviewerId,
      review_note: String(params.reviewNote || '').trim().slice(0, 2000) || null,
    });

  if (error) {
    throw new Error(error.message || 'AGENT_QUALITY_REVIEW_INSERT_FAILED');
  }
};

export const listAgentAnswerQualityReviews = async (params: {
  guildId: string;
  days?: number;
  limit?: number;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = normalizeDays(params.days);
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit || 50))));
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_answer_quality_reviews')
    .select('id,guild_id,session_id,strategy,question,answer_excerpt,is_hallucination,label_confidence,reviewer_id,review_note,created_at')
    .eq('guild_id', guildId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'AGENT_QUALITY_REVIEW_LIST_FAILED');
  }

  return data || [];
};

export const getAgentAnswerQualityReviewSummary = async (params: {
  guildId: string;
  days?: number;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = normalizeDays(params.days);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_answer_quality_reviews')
    .select('strategy,is_hallucination,label_confidence,created_at')
    .eq('guild_id', guildId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error) {
    throw new Error(error.message || 'AGENT_QUALITY_REVIEW_SUMMARY_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const byStrategy: Record<ReviewStrategy, { total: number; hallucinations: number; ratePct: number | null }> = {
    baseline: { total: 0, hallucinations: 0, ratePct: null },
    tot: { total: 0, hallucinations: 0, ratePct: null },
    got: { total: 0, hallucinations: 0, ratePct: null },
  };

  for (const row of rows) {
    const strategy = toStrategy(row.strategy);
    const item = byStrategy[strategy];
    item.total += 1;
    if (row.is_hallucination === true) {
      item.hallucinations += 1;
    }
  }

  for (const key of ['baseline', 'tot', 'got'] as const) {
    const item = byStrategy[key];
    item.ratePct = item.total > 0 ? Number(((item.hallucinations / item.total) * 100).toFixed(2)) : null;
  }

  return {
    guildId,
    days,
    sampleCount: rows.length,
    byStrategy,
    deltaGotVsBaselinePct:
      byStrategy.got.ratePct !== null && byStrategy.baseline.ratePct !== null
        ? Number((byStrategy.got.ratePct - byStrategy.baseline.ratePct).toFixed(2))
        : null,
    generatedAt: new Date().toISOString(),
  };
};
