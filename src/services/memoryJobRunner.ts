import crypto from 'crypto';
import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const MEMORY_JOBS_ENABLED = parseBooleanEnv(process.env.MEMORY_JOBS_ENABLED, true);
const MEMORY_JOBS_POLL_INTERVAL_MS = Math.max(5_000, parseIntegerEnv(process.env.MEMORY_JOBS_POLL_INTERVAL_MS, 20_000));
const MEMORY_JOBS_MAX_RETRIES = Math.max(1, parseIntegerEnv(process.env.MEMORY_JOBS_MAX_RETRIES, 3));
const MEMORY_JOBS_BACKOFF_BASE_MS = Math.max(1_000, parseIntegerEnv(process.env.MEMORY_JOBS_BACKOFF_BASE_MS, 15_000));
const MEMORY_JOBS_BACKOFF_MAX_MS = Math.max(MEMORY_JOBS_BACKOFF_BASE_MS, parseIntegerEnv(process.env.MEMORY_JOBS_BACKOFF_MAX_MS, 30 * 60_000));
const MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED = parseBooleanEnv(process.env.MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED, true);
const MEMORY_DEADLETTER_RECOVERY_INTERVAL_MS = Math.max(15_000, parseIntegerEnv(process.env.MEMORY_DEADLETTER_RECOVERY_INTERVAL_MS, 120_000));
const MEMORY_DEADLETTER_RECOVERY_BATCH_SIZE = Math.max(1, parseIntegerEnv(process.env.MEMORY_DEADLETTER_RECOVERY_BATCH_SIZE, 3));
const MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS = Math.max(1, parseIntegerEnv(process.env.MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS, 3));

let pollTimer: NodeJS.Timeout | null = null;
let recoveryTimer: NodeJS.Timeout | null = null;
let inFlight = false;
let recoveryInFlight = false;

type MemoryRunnerStats = {
  startedAt: string | null;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastRecoveryAt: string | null;
  lastRecoveryErrorAt: string | null;
  lastRecoveryErrorMessage: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  recoveredDeadletters: number;
  recoveryFailures: number;
};

const runnerStats: MemoryRunnerStats = {
  startedAt: null,
  lastTickAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastRecoveryAt: null,
  lastRecoveryErrorAt: null,
  lastRecoveryErrorMessage: null,
  processed: 0,
  succeeded: 0,
  failed: 0,
  recoveredDeadletters: 0,
  recoveryFailures: 0,
};

const nowIso = () => new Date().toISOString();

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

const clampConfidence = (value: unknown, fallback = 0.55): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
};

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

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const computeBackoffMs = (attempt: number): number => {
  const exp = Math.max(0, attempt - 1);
  const delay = MEMORY_JOBS_BACKOFF_BASE_MS * Math.pow(2, exp);
  return Math.min(MEMORY_JOBS_BACKOFF_MAX_MS, delay);
};

const toNextAttemptIso = (attempt: number): string => {
  const delayMs = computeBackoffMs(attempt);
  return new Date(Date.now() + delayMs).toISOString();
};

const buildJobSummary = async (guildId: string) => {
  const client = getSupabaseClient();
  const { count: totalItems } = await client
    .from('memory_items')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('status', 'active');

  const { count: openConflicts } = await client
    .from('memory_conflicts')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('status', 'open');

  return {
    activeMemoryItems: totalItems || 0,
    openConflicts: openConflicts || 0,
  };
};

const processShortSummary = async (params: {
  guildId: string;
  windowStartedAt?: string;
  windowEndedAt?: string;
}) => {
  const client = getSupabaseClient();

  let query = client
    .from('memory_sources')
    .select('source_kind, source_message_id, source_ref, source_ts')
    .eq('guild_id', params.guildId)
    .order('source_ts', { ascending: false })
    .limit(200);

  if (params.windowStartedAt) {
    query = query.gte('source_ts', params.windowStartedAt);
  }
  if (params.windowEndedAt) {
    query = query.lte('source_ts', params.windowEndedAt);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'SHORT_SUMMARY_QUERY_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const byKind = new Map<string, number>();
  const samples: Array<{ sourceKind: string; sourceMessageId: string; sourceRef: string }> = [];

  for (const row of rows) {
    const sourceKind = String(row.source_kind || 'unknown');
    byKind.set(sourceKind, (byKind.get(sourceKind) || 0) + 1);

    if (samples.length < 6) {
      samples.push({
        sourceKind,
        sourceMessageId: String(row.source_message_id || ''),
        sourceRef: String(row.source_ref || ''),
      });
    }
  }

  return {
    sourceTotal: rows.length,
    sourceByKind: Object.fromEntries(byKind),
    sampleSources: samples,
  };
};

const processTopicSynthesis = async (guildId: string) => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('memory_items')
    .select('type, tags, pinned, confidence')
    .eq('guild_id', guildId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(300);

  if (error) {
    throw new Error(error.message || 'TOPIC_SYNTHESIS_QUERY_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const byType = new Map<string, number>();
  const tagFrequency = new Map<string, number>();
  let pinnedCount = 0;
  let confidenceSum = 0;

  for (const row of rows) {
    const type = String(row.type || 'unknown');
    byType.set(type, (byType.get(type) || 0) + 1);
    if (row.pinned) {
      pinnedCount += 1;
    }

    confidenceSum += clampConfidence(row.confidence, 0.5);

    const tags = Array.isArray(row.tags) ? row.tags : [];
    for (const tag of tags) {
      const key = String(tag || '').trim();
      if (!key) continue;
      tagFrequency.set(key, (tagFrequency.get(key) || 0) + 1);
    }
  }

  const topTags = [...tagFrequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  return {
    activeItems: rows.length,
    byType: Object.fromEntries(byType),
    pinnedCount,
    avgConfidence: rows.length > 0 ? Number((confidenceSum / rows.length).toFixed(3)) : 0,
    topTags,
  };
};

const processDurableExtraction = async (params: {
  guildId: string;
  input: Record<string, unknown>;
}) => {
  const client = getSupabaseClient();
  const input = params.input;
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : null;
  const summary = typeof input.summary === 'string' ? input.summary.trim() : null;
  const requestedType = typeof input.type === 'string' ? input.type.trim() : 'semantic';
  const type = ['episode', 'semantic', 'policy', 'preference'].includes(requestedType) ? requestedType : 'semantic';

  if (!content) {
    return {
      inserted: false,
      reason: 'EMPTY_CONTENT',
    };
  }

  const conflictKey = `content:${crypto.createHash('sha1').update(normalizeText(content)).digest('hex').slice(0, 16)}`;

  const { data: existing, error: existingError } = await client
    .from('memory_items')
    .select('id')
    .eq('guild_id', params.guildId)
    .eq('conflict_key', conflictKey)
    .eq('status', 'active')
    .limit(1);

  if (existingError) {
    throw new Error(existingError.message || 'DURABLE_EXTRACTION_CHECK_FAILED');
  }

  if ((existing || []).length > 0) {
    return {
      inserted: false,
      reason: 'DUPLICATE_BY_CONFLICT_KEY',
      conflictKey,
    };
  }

  const row = {
    id: `mem_${crypto.randomUUID()}`,
    guild_id: params.guildId,
    owner_user_id: toMaybeUserId(input.ownerUserId) || toMaybeUserId(input.sourceAuthorId),
    type,
    title,
    content,
    summary,
    confidence: clampConfidence(input.confidence, 0.58),
    created_by: 'memory-job-runner',
    updated_by: 'memory-job-runner',
    source_count: 1,
    conflict_key: conflictKey,
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
  };

  const { error: insertError } = await client.from('memory_items').insert(row);
  if (insertError) {
    throw new Error(insertError.message || 'DURABLE_EXTRACTION_INSERT_FAILED');
  }

  return {
    inserted: true,
    reason: 'INSERTED',
    conflictKey,
    memoryItemId: row.id,
  };
};

const processConflictScan = async (guildId: string) => {
  const client = getSupabaseClient();

  const { data: items, error: itemsError } = await client
    .from('memory_items')
    .select('id, conflict_key')
    .eq('guild_id', guildId)
    .eq('status', 'active')
    .not('conflict_key', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(400);

  if (itemsError) {
    throw new Error(itemsError.message || 'CONFLICT_SCAN_QUERY_FAILED');
  }

  const rows = (items || []) as Array<Record<string, unknown>>;
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const id = String(row.id || '');
    const key = String(row.conflict_key || '');
    if (!id || !key) continue;
    const list = byKey.get(key) || [];
    list.push(id);
    byKey.set(key, list);
  }

  const candidates = [...byKey.entries()].filter(([, ids]) => ids.length >= 2);
  if (candidates.length === 0) {
    return {
      scannedKeys: byKey.size,
      createdConflicts: 0,
    };
  }

  let createdConflicts = 0;
  for (const [conflictKey, ids] of candidates) {
    const itemAId = ids[0];
    const itemBId = ids[1];

    const { data: existing, error: existingError } = await client
      .from('memory_conflicts')
      .select('id')
      .eq('guild_id', guildId)
      .eq('conflict_key', conflictKey)
      .eq('status', 'open')
      .limit(1);

    if (existingError) {
      throw new Error(existingError.message || 'CONFLICT_SCAN_EXISTS_FAILED');
    }

    if ((existing || []).length > 0) {
      continue;
    }

    const { error: insertError } = await client.from('memory_conflicts').insert({
      guild_id: guildId,
      conflict_key: conflictKey,
      item_a_id: itemAId,
      item_b_id: itemBId,
      status: 'open',
      detected_by: 'system',
    });

    if (insertError) {
      throw new Error(insertError.message || 'CONFLICT_SCAN_INSERT_FAILED');
    }

    createdConflicts += 1;
  }

  return {
    scannedKeys: byKey.size,
    candidateKeys: candidates.length,
    createdConflicts,
  };
};

const processOnboardingSnapshot = async (params: {
  guildId: string;
  input: Record<string, unknown>;
}) => {
  const guildName = String(params.input.guildName || '').trim();
  const reason = String(params.input.reason || 'onboarding').trim();

  const content = [
    'Guild onboarding baseline snapshot',
    `guildId=${params.guildId}`,
    `guildName=${guildName || 'unknown'}`,
    `reason=${reason}`,
    `capturedAt=${nowIso()}`,
    'notes=initial profile generated for onboarding quality and policy bootstrap',
  ].join('\n');

  return processDurableExtraction({
    guildId: params.guildId,
    input: {
      type: 'policy',
      title: `Onboarding Snapshot ${guildName || params.guildId}`,
      summary: 'Initial guild onboarding snapshot for memory bootstrap.',
      content,
      tags: ['onboarding', 'snapshot', 'bootstrap'],
      confidence: 0.75,
      ownerUserId: params.input.ownerUserId,
      sourceAuthorId: params.input.ownerUserId,
    },
  });
};

const processJobByType = async (job: {
  guild_id: string;
  job_type: string;
  input: Record<string, unknown> | null;
  window_started_at?: string;
  window_ended_at?: string;
}) => {
  if (job.job_type === 'short_summary') {
    return processShortSummary({
      guildId: job.guild_id,
      windowStartedAt: job.window_started_at,
      windowEndedAt: job.window_ended_at,
    });
  }

  if (job.job_type === 'topic_synthesis') {
    return processTopicSynthesis(job.guild_id);
  }

  if (job.job_type === 'durable_extraction') {
    return processDurableExtraction({ guildId: job.guild_id, input: job.input || {} });
  }

  if (job.job_type === 'conflict_scan') {
    return processConflictScan(job.guild_id);
  }

  if (job.job_type === 'onboarding_snapshot') {
    return processOnboardingSnapshot({ guildId: job.guild_id, input: job.input || {} });
  }

  if (job.job_type === 'reindex') {
    return {
      reindexed: true,
      note: 'reindex placeholder - no vector backend wired yet',
    };
  }

  return {
    note: 'unsupported job type',
  };
};

const processQueuedJob = async () => {
  const client = getSupabaseClient();

  const { data: queuedRows, error: queuedError } = await client
    .from('memory_jobs')
    .select('id, guild_id, job_type, attempts, input, output, window_started_at, window_ended_at')
    .eq('status', 'queued')
    .lte('next_attempt_at', nowIso())
    .order('created_at', { ascending: true })
    .limit(1);

  if (queuedError) {
    throw new Error(queuedError.message || 'MEMORY_JOBS_QUERY_FAILED');
  }

  const queued = (queuedRows || [])[0] as {
    id: string;
    guild_id: string;
    job_type: string;
    attempts: number;
    input: Record<string, unknown> | null;
    output: Record<string, unknown> | null;
    window_started_at?: string;
    window_ended_at?: string;
  } | undefined;

  if (!queued) {
    return;
  }

  const nextAttempts = Math.max(0, Number(queued.attempts || 0)) + 1;
  const { data: claimedRows, error: claimError } = await client
    .from('memory_jobs')
    .update({ status: 'running', started_at: nowIso(), attempts: nextAttempts, next_attempt_at: null })
    .eq('id', queued.id)
    .eq('status', 'queued')
    .select('id, guild_id, job_type, attempts, input, output, window_started_at, window_ended_at')
    .limit(1);

  if (claimError) {
    throw new Error(claimError.message || 'MEMORY_JOB_CLAIM_FAILED');
  }

  const claimed = (claimedRows || [])[0] as typeof queued | undefined;
  if (!claimed) {
    return;
  }

  try {
    runnerStats.processed += 1;
    const summary = await buildJobSummary(claimed.guild_id);
    const jobResult = await processJobByType(claimed);
    const output: Record<string, unknown> = {
      runnerVersion: 'v2',
      completedAt: nowIso(),
      summary,
      jobResult,
      note: `processed ${claimed.job_type}`,
    };

    const { error: completeError } = await client
      .from('memory_jobs')
      .update({
        status: 'completed',
        output,
        completed_at: nowIso(),
        error: null,
        deadlettered_at: null,
        deadletter_reason: null,
        next_attempt_at: null,
      })
      .eq('id', claimed.id)
      .eq('status', 'running');

    if (completeError) {
      throw new Error(completeError.message || 'MEMORY_JOB_COMPLETE_FAILED');
    }

    runnerStats.succeeded += 1;
    runnerStats.lastSuccessAt = nowIso();
    runnerStats.lastErrorAt = null;
    runnerStats.lastErrorMessage = null;

    logger.info('[MEMORY-JOBS] completed job=%s type=%s guild=%s', claimed.id, claimed.job_type, claimed.guild_id);
  } catch (error) {
    const message = toErrorMessage(error);
    const shouldFail = nextAttempts >= MEMORY_JOBS_MAX_RETRIES;
    const nextAttemptAt = shouldFail ? null : toNextAttemptIso(nextAttempts);
    runnerStats.failed += 1;
    runnerStats.lastErrorAt = nowIso();
    runnerStats.lastErrorMessage = message;

    const { error: failError } = await client
      .from('memory_jobs')
      .update({
        status: shouldFail ? 'failed' : 'queued',
        error: message,
        started_at: shouldFail ? nowIso() : null,
        completed_at: shouldFail ? nowIso() : null,
        next_attempt_at: nextAttemptAt,
        deadlettered_at: shouldFail ? nowIso() : null,
        deadletter_reason: shouldFail ? message : null,
      })
      .eq('id', claimed.id)
      .eq('status', 'running');

    if (failError) {
      logger.error('[MEMORY-JOBS] failed to update job failure state: %o', failError);
    }

    if (shouldFail) {
      const { error: deadletterError } = await client
        .from('memory_job_deadletters')
        .insert({
          job_id: claimed.id,
          guild_id: claimed.guild_id,
          job_type: claimed.job_type,
          attempts: nextAttempts,
          error: message,
          input: claimed.input || null,
          output: claimed.output || null,
          failed_at: nowIso(),
        });

      if (deadletterError) {
        logger.error('[MEMORY-JOBS] failed to insert deadletter: %o', deadletterError);
      }
    }

    logger.error('[MEMORY-JOBS] job error id=%s type=%s attempt=%d: %s', claimed.id, claimed.job_type, nextAttempts, message);
  }
};

const tick = async () => {
  if (inFlight || !MEMORY_JOBS_ENABLED || !isSupabaseConfigured()) {
    return;
  }

  runnerStats.lastTickAt = nowIso();
  inFlight = true;
  try {
    await processQueuedJob();
  } catch (error) {
    logger.error('[MEMORY-JOBS] tick error: %o', error);
  } finally {
    inFlight = false;
  }
};

export const startMemoryJobRunner = () => {
  if (!MEMORY_JOBS_ENABLED) {
    logger.info('[MEMORY-JOBS] disabled by MEMORY_JOBS_ENABLED=false');
    return;
  }

  if (!isSupabaseConfigured()) {
    logger.info('[MEMORY-JOBS] skipped: SUPABASE is not configured');
    return;
  }

  if (pollTimer) {
    return;
  }

  runnerStats.startedAt = nowIso();

  pollTimer = setInterval(() => {
    void tick();
  }, MEMORY_JOBS_POLL_INTERVAL_MS);

  if (MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED) {
    recoveryTimer = setInterval(() => {
      void recoveryTick();
    }, MEMORY_DEADLETTER_RECOVERY_INTERVAL_MS);
  }

  void tick();
  if (MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED) {
    void recoveryTick();
  }
  logger.info('[MEMORY-JOBS] runner started intervalMs=%d maxRetries=%d', MEMORY_JOBS_POLL_INTERVAL_MS, MEMORY_JOBS_MAX_RETRIES);
};

export const stopMemoryJobRunner = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
};

export const getMemoryJobRunnerStats = () => {
  return {
    enabled: MEMORY_JOBS_ENABLED,
    inFlight,
    recoveryInFlight,
    pollIntervalMs: MEMORY_JOBS_POLL_INTERVAL_MS,
    maxRetries: MEMORY_JOBS_MAX_RETRIES,
    backoffBaseMs: MEMORY_JOBS_BACKOFF_BASE_MS,
    backoffMaxMs: MEMORY_JOBS_BACKOFF_MAX_MS,
    deadletterAutoRecoveryEnabled: MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED,
    deadletterRecoveryIntervalMs: MEMORY_DEADLETTER_RECOVERY_INTERVAL_MS,
    deadletterRecoveryBatchSize: MEMORY_DEADLETTER_RECOVERY_BATCH_SIZE,
    deadletterMaxRecoveryAttempts: MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS,
    ...runnerStats,
  };
};

export const getMemoryJobQueueStats = async (guildId?: string) => {
  if (!isSupabaseConfigured()) {
    return {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      canceled: 0,
      retryScheduled: 0,
      deadlettered: 0,
      total: 0,
    };
  }

  const client = getSupabaseClient();
  let query = client.from('memory_jobs').select('status, next_attempt_at, deadlettered_at').limit(1000);
  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'MEMORY_JOB_QUEUE_STATS_FAILED');
  }

  const stats = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
    retryScheduled: 0,
    deadlettered: 0,
    total: 0,
  };

  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const status = String(row.status || '').toLowerCase();
    if (status === 'queued') stats.queued += 1;
    if (status === 'running') stats.running += 1;
    if (status === 'completed') stats.completed += 1;
    if (status === 'failed') stats.failed += 1;
    if (status === 'canceled') stats.canceled += 1;
    if (status === 'queued' && row.next_attempt_at && Date.parse(String(row.next_attempt_at)) > Date.now()) {
      stats.retryScheduled += 1;
    }
    if (row.deadlettered_at) {
      stats.deadlettered += 1;
    }
    stats.total += 1;
  }

  return stats;
};

export const listMemoryJobDeadletters = async (params: { guildId?: string; limit: number }) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const client = getSupabaseClient();
  let query = client
    .from('memory_job_deadletters')
    .select('id, job_id, guild_id, job_type, attempts, error, failed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (params.guildId) {
    query = query.eq('guild_id', params.guildId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'MEMORY_JOB_DEADLETTERS_FAILED');
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    jobId: String(row.job_id || ''),
    guildId: String(row.guild_id || ''),
    jobType: String(row.job_type || ''),
    attempts: Number(row.attempts || 0),
    error: String(row.error || ''),
    failedAt: String(row.failed_at || ''),
    createdAt: String(row.created_at || ''),
  }));
};

export const requeueDeadletterJob = async (params: { deadletterId: number; actorId: string }) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const client = getSupabaseClient();
  const { data: deadletters, error: deadletterError } = await client
    .from('memory_job_deadletters')
    .select('id, job_id, guild_id, job_type, input, recovery_status, recovery_attempts')
    .eq('id', params.deadletterId)
    .limit(1);

  if (deadletterError) {
    throw new Error(deadletterError.message || 'MEMORY_JOB_DEADLETTER_READ_FAILED');
  }

  const deadletter = (deadletters || [])[0] as Record<string, unknown> | undefined;
  if (!deadletter) {
    throw new Error('DEADLETTER_NOT_FOUND');
  }
  if (String(deadletter.recovery_status || '') === 'requeued') {
    throw new Error('DEADLETTER_ALREADY_REQUEUED');
  }

  const now = nowIso();
  const recoveryAttempts = Math.max(0, Number(deadletter.recovery_attempts || 0));
  const updatePayload = {
    status: 'queued',
    error: null,
    started_at: null,
    completed_at: null,
    deadlettered_at: null,
    deadletter_reason: null,
    next_attempt_at: now,
    attempts: 0,
    input: {
      ...(typeof deadletter.input === 'object' && deadletter.input ? deadletter.input as Record<string, unknown> : {}),
      requeuedBy: params.actorId,
      requeuedAt: now,
    },
  };

  const jobId = String(deadletter.job_id || '');
  if (jobId) {
    const { error: updateError } = await client
      .from('memory_jobs')
      .update(updatePayload)
      .eq('id', jobId)
      .limit(1);

    if (updateError) {
      const nextRecoveryAttempts = recoveryAttempts + 1;
      await client
        .from('memory_job_deadletters')
        .update({
          recovery_attempts: nextRecoveryAttempts,
          recovery_status: nextRecoveryAttempts >= MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS ? 'ignored' : 'pending',
          last_recovery_error: updateError.message || 'MEMORY_JOB_REQUEUE_FAILED',
        })
        .eq('id', params.deadletterId)
        .limit(1);
      throw new Error(updateError.message || 'MEMORY_JOB_REQUEUE_FAILED');
    }

    await client
      .from('memory_job_deadletters')
      .update({
        recovery_attempts: recoveryAttempts + 1,
        recovery_status: 'requeued',
        recovered_at: now,
        last_recovery_error: null,
      })
      .eq('id', params.deadletterId)
      .limit(1);

    return {
      requeued: true,
      jobId,
      source: 'existing_job',
    };
  }

  const newJobId = `mjob_${crypto.randomUUID()}`;
  const { error: insertError } = await client
    .from('memory_jobs')
    .insert({
      id: newJobId,
      guild_id: String(deadletter.guild_id || ''),
      job_type: String(deadletter.job_type || 'short_summary'),
      status: 'queued',
      attempts: 0,
      next_attempt_at: now,
      input: {
        ...(typeof deadletter.input === 'object' && deadletter.input ? deadletter.input as Record<string, unknown> : {}),
        requeuedBy: params.actorId,
        requeuedAt: now,
      },
    });

  if (insertError) {
    const nextRecoveryAttempts = recoveryAttempts + 1;
    await client
      .from('memory_job_deadletters')
      .update({
        recovery_attempts: nextRecoveryAttempts,
        recovery_status: nextRecoveryAttempts >= MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS ? 'ignored' : 'pending',
        last_recovery_error: insertError.message || 'MEMORY_JOB_REQUEUE_INSERT_FAILED',
      })
      .eq('id', params.deadletterId)
      .limit(1);
    throw new Error(insertError.message || 'MEMORY_JOB_REQUEUE_INSERT_FAILED');
  }

  await client
    .from('memory_job_deadletters')
    .update({
      recovery_attempts: recoveryAttempts + 1,
      recovery_status: 'requeued',
      recovered_at: now,
      last_recovery_error: null,
    })
    .eq('id', params.deadletterId)
    .limit(1);

  return {
    requeued: true,
    jobId: newJobId,
    source: 'new_job',
  };
};

export const cancelMemoryJob = async (params: { jobId: string; actorId: string }) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const client = getSupabaseClient();
  const now = nowIso();
  const { data, error } = await client
    .from('memory_jobs')
    .update({
      status: 'canceled',
      completed_at: now,
      error: 'CANCELED_BY_ADMIN',
      output: {
        canceledBy: params.actorId,
        canceledAt: now,
      },
    })
    .eq('id', params.jobId)
    .in('status', ['queued', 'running'])
    .select('id, status')
    .limit(1);

  if (error) {
    throw new Error(error.message || 'MEMORY_JOB_CANCEL_FAILED');
  }

  const canceled = (data || [])[0] as Record<string, unknown> | undefined;
  if (!canceled) {
    throw new Error('JOB_NOT_CANCELABLE');
  }

  return {
    jobId: String(canceled.id || params.jobId),
    status: String(canceled.status || 'canceled'),
  };
};

const processDeadletterRecoveryBatch = async () => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('memory_job_deadletters')
    .select('id')
    .eq('recovery_status', 'pending')
    .lt('recovery_attempts', MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(MEMORY_DEADLETTER_RECOVERY_BATCH_SIZE);

  if (error) {
    throw new Error(error.message || 'MEMORY_DEADLETTER_RECOVERY_QUERY_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return;
  }

  for (const row of rows) {
    const deadletterId = Number(row.id || 0);
    if (!Number.isFinite(deadletterId) || deadletterId <= 0) {
      continue;
    }

    try {
      await requeueDeadletterJob({ deadletterId, actorId: 'auto-recovery' });
      runnerStats.recoveredDeadletters += 1;
      runnerStats.lastRecoveryAt = nowIso();
      runnerStats.lastRecoveryErrorAt = null;
      runnerStats.lastRecoveryErrorMessage = null;
      logger.info('[MEMORY-JOBS] auto recovery requeued deadletter=%d', deadletterId);
    } catch (error) {
      runnerStats.recoveryFailures += 1;
      runnerStats.lastRecoveryErrorAt = nowIso();
      runnerStats.lastRecoveryErrorMessage = toErrorMessage(error);
      logger.error('[MEMORY-JOBS] auto recovery failed deadletter=%d error=%s', deadletterId, toErrorMessage(error));
    }
  }
};

const recoveryTick = async () => {
  if (!MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED || recoveryInFlight || !isSupabaseConfigured()) {
    return;
  }

  recoveryInFlight = true;
  try {
    await processDeadletterRecoveryBatch();
  } catch (error) {
    runnerStats.recoveryFailures += 1;
    runnerStats.lastRecoveryErrorAt = nowIso();
    runnerStats.lastRecoveryErrorMessage = toErrorMessage(error);
    logger.error('[MEMORY-JOBS] recovery tick error: %o', error);
  } finally {
    recoveryInFlight = false;
  }
};
