import { parseIntegerEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type OpencodeChangeRequestStatus =
  | 'draft'
  | 'review_pending'
  | 'approved'
  | 'rejected'
  | 'queued_for_publish'
  | 'published'
  | 'failed';

export type OpencodePublishJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type OpencodeRiskTier = 'low' | 'medium' | 'high' | 'critical';

const CHANGE_REQUEST_TABLE = String(process.env.OPENCODE_CHANGE_REQUEST_TABLE || 'agent_opencode_change_requests').trim();
const PUBLISH_QUEUE_TABLE = String(process.env.OPENCODE_PUBLISH_QUEUE_TABLE || 'agent_opencode_publish_queue').trim();
const DEFAULT_LIMIT = Math.max(1, Math.min(200, parseIntegerEnv(process.env.OPENCODE_QUEUE_LIST_DEFAULT_LIMIT, 50)));

const CHANGE_REQUEST_STATUSES: OpencodeChangeRequestStatus[] = ['draft', 'review_pending', 'approved', 'rejected', 'queued_for_publish', 'published', 'failed'];
const PUBLISH_JOB_STATUSES: OpencodePublishJobStatus[] = ['queued', 'running', 'succeeded', 'failed', 'canceled'];
const RISK_TIERS: OpencodeRiskTier[] = ['low', 'medium', 'high', 'critical'];

const ensureConfigured = () => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return getSupabaseClient();
};

const nowIso = () => new Date().toISOString();

const toStatus = (value: unknown): OpencodeChangeRequestStatus => {
  const text = String(value || '').trim().toLowerCase();
  if (CHANGE_REQUEST_STATUSES.includes(text as OpencodeChangeRequestStatus)) {
    return text as OpencodeChangeRequestStatus;
  }
  return 'draft';
};

const toJobStatus = (value: unknown): OpencodePublishJobStatus => {
  const text = String(value || '').trim().toLowerCase();
  if (PUBLISH_JOB_STATUSES.includes(text as OpencodePublishJobStatus)) {
    return text as OpencodePublishJobStatus;
  }
  return 'queued';
};

const toTextArray = (value: unknown, max = 300): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, max);
};

const toRiskTier = (value: unknown): OpencodeRiskTier => {
  const text = String(value || '').trim().toLowerCase();
  if (RISK_TIERS.includes(text as OpencodeRiskTier)) {
    return text as OpencodeRiskTier;
  }
  return 'medium';
};

const toScoreCard = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const safeKey = String(key || '').trim().slice(0, 80);
    if (!safeKey) {
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[safeKey] = Number(raw.toFixed(4));
      continue;
    }
    if (typeof raw === 'string') {
      out[safeKey] = raw.trim().slice(0, 400);
      continue;
    }
    if (typeof raw === 'boolean') {
      out[safeKey] = raw;
    }
  }

  return out;
};

export const isOpencodeChangeRequestStatus = (value: string): value is OpencodeChangeRequestStatus => {
  return CHANGE_REQUEST_STATUSES.includes(value as OpencodeChangeRequestStatus);
};

export const isOpencodePublishJobStatus = (value: string): value is OpencodePublishJobStatus => {
  return PUBLISH_JOB_STATUSES.includes(value as OpencodePublishJobStatus);
};

export const createOpencodeChangeRequest = async (params: {
  guildId: string;
  requestedBy: string;
  title: string;
  summary?: string;
  targetBaseBranch?: string;
  proposedBranch?: string;
  sourceActionLogId?: number;
  riskTier?: OpencodeRiskTier;
  scoreCard?: Record<string, unknown>;
  evidenceBundleId?: string;
  files?: string[];
  diffPatch?: string;
  metadata?: Record<string, unknown>;
}) => {
  const guildId = String(params.guildId || '').trim();
  const requestedBy = String(params.requestedBy || '').trim() || 'api';
  const title = String(params.title || '').trim();
  if (!guildId || !title) {
    throw new Error('VALIDATION');
  }

  const client = ensureConfigured();
  const { data, error } = await client
    .from(CHANGE_REQUEST_TABLE)
    .insert({
      guild_id: guildId,
      requested_by: requestedBy,
      title: title.slice(0, 240),
      summary: String(params.summary || '').trim().slice(0, 4000) || null,
      source_action_log_id: Number.isFinite(Number(params.sourceActionLogId)) ? Number(params.sourceActionLogId) : null,
      target_base_branch: String(params.targetBaseBranch || 'main').trim().slice(0, 120),
      proposed_branch: String(params.proposedBranch || '').trim().slice(0, 120) || null,
      status: 'review_pending',
      risk_tier: toRiskTier(params.riskTier),
      score_card: toScoreCard(params.scoreCard),
      evidence_bundle_id: String(params.evidenceBundleId || '').trim().slice(0, 160) || null,
      files: (params.files || []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 500),
      diff_patch: String(params.diffPatch || '').trim() || null,
      metadata: params.metadata || {},
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'OPENCODE_CHANGE_REQUEST_CREATE_FAILED');
  }

  return data;
};

export const listOpencodeChangeRequests = async (params: {
  guildId: string;
  status?: OpencodeChangeRequestStatus;
  limit?: number;
}) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit || DEFAULT_LIMIT))));

  const client = ensureConfigured();
  let query = client
    .from(CHANGE_REQUEST_TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'OPENCODE_CHANGE_REQUEST_LIST_FAILED');
  }
  return data || [];
};

export const decideOpencodeChangeRequest = async (params: {
  guildId: string;
  changeRequestId: number;
  decision: 'approve' | 'reject' | 'published' | 'failed';
  actorId: string;
  note?: string;
  publishUrl?: string;
}) => {
  const guildId = String(params.guildId || '').trim();
  const changeRequestId = Number(params.changeRequestId);
  if (!guildId || !Number.isFinite(changeRequestId) || changeRequestId <= 0) {
    throw new Error('VALIDATION');
  }

  const status: OpencodeChangeRequestStatus = params.decision === 'approve'
    ? 'approved'
    : params.decision === 'reject'
      ? 'rejected'
      : params.decision === 'published'
        ? 'published'
        : 'failed';

  const client = ensureConfigured();
  const updatePayload: Record<string, unknown> = {
    status,
    approved_by: String(params.actorId || 'api').trim().slice(0, 120),
    approved_at: nowIso(),
    updated_at: nowIso(),
  };

  if (params.note) {
    updatePayload.review_note = String(params.note).trim().slice(0, 2000);
  }
  if (params.publishUrl) {
    updatePayload.publish_url = String(params.publishUrl).trim().slice(0, 1000);
  }

  const { data, error } = await client
    .from(CHANGE_REQUEST_TABLE)
    .update(updatePayload)
    .eq('id', changeRequestId)
    .eq('guild_id', guildId)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'OPENCODE_CHANGE_REQUEST_DECIDE_FAILED');
  }
  if (!data) {
    throw new Error('OPENCODE_CHANGE_REQUEST_NOT_FOUND');
  }
  return data;
};

export const enqueueOpencodePublishJob = async (params: {
  guildId: string;
  changeRequestId: number;
  requestedBy: string;
  provider?: string;
  payload?: Record<string, unknown>;
}) => {
  const guildId = String(params.guildId || '').trim();
  const changeRequestId = Number(params.changeRequestId);
  const requestedBy = String(params.requestedBy || '').trim() || 'api';
  if (!guildId || !Number.isFinite(changeRequestId) || changeRequestId <= 0) {
    throw new Error('VALIDATION');
  }

  const client = ensureConfigured();

  const { data: reqRow, error: reqError } = await client
    .from(CHANGE_REQUEST_TABLE)
    .select('id,status')
    .eq('id', changeRequestId)
    .eq('guild_id', guildId)
    .maybeSingle();

  if (reqError) {
    throw new Error(reqError.message || 'OPENCODE_CHANGE_REQUEST_READ_FAILED');
  }
  if (!reqRow) {
    throw new Error('OPENCODE_CHANGE_REQUEST_NOT_FOUND');
  }

  const status = toStatus((reqRow as Record<string, unknown>).status);
  if (status !== 'approved' && status !== 'queued_for_publish') {
    throw new Error('OPENCODE_CHANGE_REQUEST_NOT_APPROVED');
  }

  const { data: existingActiveJob, error: existingActiveJobError } = await client
    .from(PUBLISH_QUEUE_TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('change_request_id', changeRequestId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingActiveJobError) {
    throw new Error(existingActiveJobError.message || 'OPENCODE_PUBLISH_JOB_READ_FAILED');
  }
  if (existingActiveJob) {
    return {
      ...(existingActiveJob as Record<string, unknown>),
      deduplicated: true,
    };
  }

  const { data, error } = await client
    .from(PUBLISH_QUEUE_TABLE)
    .insert({
      guild_id: guildId,
      change_request_id: changeRequestId,
      requested_by: requestedBy,
      provider: String(params.provider || 'github').trim().slice(0, 60),
      status: 'queued',
      payload: params.payload || {},
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'OPENCODE_PUBLISH_JOB_CREATE_FAILED');
  }

  await client
    .from(CHANGE_REQUEST_TABLE)
    .update({
      status: 'queued_for_publish',
      updated_at: nowIso(),
    })
    .eq('id', changeRequestId)
    .eq('guild_id', guildId);

  return data;
};

export const listOpencodePublishJobs = async (params: {
  guildId: string;
  status?: OpencodePublishJobStatus;
  limit?: number;
}) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit || DEFAULT_LIMIT))));

  const client = ensureConfigured();
  let query = client
    .from(PUBLISH_QUEUE_TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'OPENCODE_PUBLISH_JOB_LIST_FAILED');
  }
  return data || [];
};

export const summarizeOpencodeQueueReadiness = async (params: {
  guildId: string;
}) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const [requests, jobs] = await Promise.all([
    listOpencodeChangeRequests({ guildId, limit: 200 }),
    listOpencodePublishJobs({ guildId, limit: 200 }),
  ]);

  const countBy = (rows: Array<Record<string, unknown>>, key: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const value = String(row[key] || '').trim().toLowerCase() || 'unknown';
      out[value] = (out[value] || 0) + 1;
    }
    return out;
  };

  const highRiskEvidenceMissing = (requests as Array<Record<string, unknown>>).filter((row) => {
    const tier = String(row.risk_tier || '').trim().toLowerCase();
    if (tier !== 'high' && tier !== 'critical') {
      return false;
    }
    return !String(row.evidence_bundle_id || '').trim();
  }).length;

  const evidenceAttached = (requests as Array<Record<string, unknown>>).filter((row) => {
    return Boolean(String(row.evidence_bundle_id || '').trim());
  }).length;

  return {
    guildId,
    changeRequests: {
      total: requests.length,
      byStatus: countBy(requests as Array<Record<string, unknown>>, 'status'),
      byRiskTier: countBy(requests as Array<Record<string, unknown>>, 'risk_tier'),
      evidenceCoverage: {
        attached: evidenceAttached,
        missing: Math.max(0, requests.length - evidenceAttached),
        highRiskMissing: highRiskEvidenceMissing,
      },
      recentFiles: toTextArray((requests[0] as Record<string, unknown> | undefined)?.files, 20),
    },
    publishJobs: {
      total: jobs.length,
      byStatus: countBy(jobs as Array<Record<string, unknown>>, 'status'),
    },
    generatedAt: nowIso(),
  };
};
