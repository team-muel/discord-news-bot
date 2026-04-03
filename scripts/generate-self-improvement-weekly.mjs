/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'self-improvement');
const ROLLBACK_WEEKLY_MARKDOWN = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'rollback-rehearsals', 'WEEKLY_SUMMARY.md');
const MEMORY_QUEUE_OBSERVABILITY_DIR = path.join(ROOT, 'docs', 'planning', 'memory-queue-observability');
const VALID_SINKS = new Set(['markdown', 'stdout']);

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
const ACTION_APPROVAL_TABLE = String(process.env.ACTION_APPROVAL_TABLE || 'agent_action_approval_requests').trim();

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
};

const parseBool = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const parseSinks = (raw) => {
  const tokens = String(raw || '')
    .split(/[;,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const values = tokens.length > 0 ? tokens : ['markdown'];
  const deduped = [...new Set(values)].filter((sink) => VALID_SINKS.has(sink));
  return deduped.length > 0 ? deduped : ['markdown'];
};

const OPENJARVIS_SERVE_URL = String(process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000').trim();
const OPENJARVIS_OPTIMIZE_ENABLED = parseBool(process.env.OPENJARVIS_OPTIMIZE_ENABLED, false);

/**
 * D-02: Trigger jarvis.optimize after weekly self-improvement patterns are persisted.
 * Sends pattern summary to OpenJarvis serve endpoint for model/prompt optimization.
 * Graceful no-op when disabled or unreachable.
 */
const triggerJarvisOptimize = async (patterns) => {
  if (!OPENJARVIS_OPTIMIZE_ENABLED) {
    console.log('[SELF-IMPROVEMENT] jarvis.optimize trigger skipped (OPENJARVIS_OPTIMIZE_ENABLED=false)');
    return;
  }
  try {
    const hints = patterns.slice(0, 10).map((p) => ({
      id: p.id,
      severity: p.severity,
      signal: p.signal,
      patchProposal: p.patchProposal,
    }));
    const resp = await fetch(`${OPENJARVIS_SERVE_URL}/v1/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hints, source: 'weekly-self-improvement' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (resp.ok) {
      const data = await resp.json();
      console.log(`[SELF-IMPROVEMENT] jarvis.optimize triggered: ${JSON.stringify(data).slice(0, 200)}`);
    } else {
      console.log(`[SELF-IMPROVEMENT] jarvis.optimize returned ${resp.status}`);
    }
  } catch (err) {
    console.log(`[SELF-IMPROVEMENT] jarvis.optimize failed (non-blocking): ${err?.message || err}`);
  }
};

const toMsWindow = (days, fallbackDays) => {
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackDays * 24 * 60 * 60 * 1000;
  }
  return Math.trunc(parsed * 24 * 60 * 60 * 1000);
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const avgOrNull = (values) => {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (nums.length === 0) {
    return null;
  }
  const sum = nums.reduce((acc, value) => acc + value, 0);
  return Number((sum / nums.length).toFixed(4));
};

const isGlobalGuildReport = (value) => {
  const normalized = String(value ?? '').trim();
  return !normalized || normalized === '*';
};

const pickPreferredReport = (rows, kind, guildId) => {
  const matches = rows.filter((row) => row.report_kind === kind);
  if (matches.length === 0) return null;
  if (!guildId) return matches[0] || null;

  const exact = matches.find((row) => String(row.guild_id || '').trim() === guildId);
  if (exact) return exact;

  const global = matches.find((row) => isGlobalGuildReport(row.guild_id));
  if (global) return global;

  return matches[0] || null;
};

const isMissingRelationError = (error, tableName) => {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes(String(tableName || '').toLowerCase());
};

const fetchLabeledQualitySignals = async (client, params) => {
  const empty = {
    retrieval: {
      sampleRuns: 0,
      byVariant: {
        baseline: { samples: 0, recallAtKAvg: null },
        tot: { samples: 0, recallAtKAvg: null },
        got: { samples: 0, recallAtKAvg: null },
      },
      deltaGotVsBaseline: null,
    },
    hallucination: {
      sampleReviews: 0,
      byStrategy: {
        baseline: { total: 0, hallucinations: 0, failRatePct: null },
        tot: { total: 0, hallucinations: 0, failRatePct: null },
        got: { total: 0, hallucinations: 0, failRatePct: null },
      },
      deltaGotVsBaselinePct: null,
    },
    availability: {
      retrievalEvalRuns: 'ok',
      answerQualityReviews: 'ok',
    },
  };

  const fromIso = new Date(Date.now() - params.windowMs).toISOString();

  let retrievalRows = [];
  try {
    let retrievalQuery = client
      .from('retrieval_eval_runs')
      .select('id, guild_id, summary, status, created_at')
      .eq('status', 'completed')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false })
      .limit(200);

    if (params.guildId) {
      retrievalQuery = retrievalQuery.eq('guild_id', params.guildId);
    }

    const retrievalRes = await retrievalQuery;
    if (retrievalRes.error) {
      if (params.allowMissingQualityTables && isMissingRelationError(retrievalRes.error, 'retrieval_eval_runs')) {
        empty.availability.retrievalEvalRuns = 'missing_table';
      } else {
        throw new Error(retrievalRes.error.message || 'RETRIEVAL_EVAL_RUNS_QUERY_FAILED');
      }
    } else {
      retrievalRows = retrievalRes.data || [];
    }
  } catch (error) {
    if (params.allowMissingQualityTables && isMissingRelationError(error, 'retrieval_eval_runs')) {
      empty.availability.retrievalEvalRuns = 'missing_table';
    } else {
      throw error;
    }
  }

  const recallByVariant = {
    baseline: [],
    tot: [],
    got: [],
  };
  for (const row of retrievalRows) {
    const variants = row?.summary?.variants && typeof row.summary.variants === 'object'
      ? row.summary.variants
      : null;
    if (!variants) {
      continue;
    }

    for (const variant of ['baseline', 'tot', 'got']) {
      const recallAtK = Number(variants?.[variant]?.recallAtK);
      if (Number.isFinite(recallAtK)) {
        recallByVariant[variant].push(recallAtK);
      }
    }
  }

  empty.retrieval.sampleRuns = retrievalRows.length;
  empty.retrieval.byVariant.baseline = {
    samples: recallByVariant.baseline.length,
    recallAtKAvg: avgOrNull(recallByVariant.baseline),
  };
  empty.retrieval.byVariant.tot = {
    samples: recallByVariant.tot.length,
    recallAtKAvg: avgOrNull(recallByVariant.tot),
  };
  empty.retrieval.byVariant.got = {
    samples: recallByVariant.got.length,
    recallAtKAvg: avgOrNull(recallByVariant.got),
  };

  const gotRecall = empty.retrieval.byVariant.got.recallAtKAvg;
  const baselineRecall = empty.retrieval.byVariant.baseline.recallAtKAvg;
  empty.retrieval.deltaGotVsBaseline =
    gotRecall !== null && baselineRecall !== null
      ? Number((gotRecall - baselineRecall).toFixed(4))
      : null;

  let reviewRows = [];
  try {
    let reviewQuery = client
      .from('agent_answer_quality_reviews')
      .select('strategy, is_hallucination, created_at, guild_id')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (params.guildId) {
      reviewQuery = reviewQuery.eq('guild_id', params.guildId);
    }

    const reviewRes = await reviewQuery;
    if (reviewRes.error) {
      if (params.allowMissingQualityTables && isMissingRelationError(reviewRes.error, 'agent_answer_quality_reviews')) {
        empty.availability.answerQualityReviews = 'missing_table';
      } else {
        throw new Error(reviewRes.error.message || 'ANSWER_QUALITY_REVIEW_QUERY_FAILED');
      }
    } else {
      reviewRows = reviewRes.data || [];
    }
  } catch (error) {
    if (params.allowMissingQualityTables && isMissingRelationError(error, 'agent_answer_quality_reviews')) {
      empty.availability.answerQualityReviews = 'missing_table';
    } else {
      throw error;
    }
  }

  const byStrategy = {
    baseline: { total: 0, hallucinations: 0, failRatePct: null },
    tot: { total: 0, hallucinations: 0, failRatePct: null },
    got: { total: 0, hallucinations: 0, failRatePct: null },
  };

  for (const row of reviewRows) {
    const strategyRaw = String(row?.strategy || '').trim().toLowerCase();
    const strategy = strategyRaw === 'got' || strategyRaw === 'tot' ? strategyRaw : 'baseline';
    byStrategy[strategy].total += 1;
    if (row?.is_hallucination === true) {
      byStrategy[strategy].hallucinations += 1;
    }
  }

  for (const key of ['baseline', 'tot', 'got']) {
    const item = byStrategy[key];
    item.failRatePct = item.total > 0
      ? Number(((item.hallucinations / item.total) * 100).toFixed(2))
      : null;
  }

  empty.hallucination.sampleReviews = reviewRows.length;
  empty.hallucination.byStrategy = byStrategy;
  const gotRate = byStrategy.got.failRatePct;
  const baselineRate = byStrategy.baseline.failRatePct;
  empty.hallucination.deltaGotVsBaselinePct =
    gotRate !== null && baselineRate !== null
      ? Number((gotRate - baselineRate).toFixed(2))
      : null;

  return empty;
};

const fetchOpencodePilotSignals = async (client, params) => {
  const result = {
    availability: {
      actionLogs: 'ok',
      approvals: 'ok',
    },
    executions: {
      total: 0,
      success: 0,
      failed: 0,
      approvalRequired: 0,
      approvalRequiredRate: null,
    },
    approvals: {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
    },
  };

  const sinceIso = new Date(Date.now() - params.windowMs).toISOString();

  let logRows = [];
  try {
    let logQuery = client
      .from('agent_action_logs')
      .select('guild_id, status, error, created_at')
      .eq('action_name', 'opencode.execute')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (params.guildId) {
      logQuery = logQuery.eq('guild_id', params.guildId);
    }

    const logRes = await logQuery;
    if (logRes.error) {
      if (params.allowMissingQualityTables && isMissingRelationError(logRes.error, 'agent_action_logs')) {
        result.availability.actionLogs = 'missing_table';
      } else {
        throw new Error(logRes.error.message || 'OPENCODE_ACTION_LOG_QUERY_FAILED');
      }
    } else {
      logRows = logRes.data || [];
    }
  } catch (error) {
    if (params.allowMissingQualityTables && isMissingRelationError(error, 'agent_action_logs')) {
      result.availability.actionLogs = 'missing_table';
    } else {
      throw error;
    }
  }

  result.executions.total = logRows.length;
  result.executions.success = logRows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'success').length;
  result.executions.failed = Math.max(0, result.executions.total - result.executions.success);
  result.executions.approvalRequired = logRows.filter((row) => String(row?.error || '').trim() === 'ACTION_APPROVAL_REQUIRED').length;
  result.executions.approvalRequiredRate =
    result.executions.total > 0
      ? Number((result.executions.approvalRequired / result.executions.total).toFixed(4))
      : null;

  try {
    const baseQuery = client
      .from(ACTION_APPROVAL_TABLE)
      .select('id,status,guild_id,action_name,created_at')
      .eq('action_name', 'opencode.execute')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(5000);

    const approvalRes = params.guildId
      ? await baseQuery.eq('guild_id', params.guildId)
      : await baseQuery;

    if (approvalRes.error) {
      if (params.allowMissingQualityTables && isMissingRelationError(approvalRes.error, ACTION_APPROVAL_TABLE)) {
        result.availability.approvals = 'missing_table';
      } else {
        throw new Error(approvalRes.error.message || 'OPENCODE_APPROVAL_QUERY_FAILED');
      }
    } else {
      const rows = approvalRes.data || [];
      result.approvals.pending = rows.filter((row) => String(row?.status || '').trim() === 'pending').length;
      result.approvals.approved = rows.filter((row) => String(row?.status || '').trim() === 'approved').length;
      result.approvals.rejected = rows.filter((row) => String(row?.status || '').trim() === 'rejected').length;
      result.approvals.expired = rows.filter((row) => String(row?.status || '').trim() === 'expired').length;
    }
  } catch (error) {
    if (params.allowMissingQualityTables && isMissingRelationError(error, ACTION_APPROVAL_TABLE)) {
      result.availability.approvals = 'missing_table';
    } else {
      throw error;
    }
  }

  return result;
};

const parseWeeklyMarkdownNumber = (markdown, key, fallback = 0) => {
  const pattern = new RegExp(`^-\\s*${key}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*$`, 'im');
  const match = String(markdown || '').match(pattern);
  return match?.[1] ? asNumber(match[1], fallback) : fallback;
};

const findLatestMemoryQueueMarkdown = () => {
  if (!fs.existsSync(MEMORY_QUEUE_OBSERVABILITY_DIR)) {
    return null;
  }
  const files = fs.readdirSync(MEMORY_QUEUE_OBSERVABILITY_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_memory-queue-weekly\.md$/i.test(name))
    .sort((a, b) => b.localeCompare(a));
  if (!files.length) return null;
  return path.join(MEMORY_QUEUE_OBSERVABILITY_DIR, files[0]);
};

const loadRollbackWeeklyFallback = () => {
  if (!fs.existsSync(ROLLBACK_WEEKLY_MARKDOWN)) {
    return null;
  }
  const markdown = fs.readFileSync(ROLLBACK_WEEKLY_MARKDOWN, 'utf8');
  return {
    report_key: `local-fallback:${path.basename(ROLLBACK_WEEKLY_MARKDOWN)}`,
    baseline_summary: {
      total_runs: parseWeeklyMarkdownNumber(markdown, 'total_runs', 0),
      pass: parseWeeklyMarkdownNumber(markdown, 'pass', 0),
      fail: parseWeeklyMarkdownNumber(markdown, 'fail', 0),
      p95_elapsed_ms: parseWeeklyMarkdownNumber(markdown, 'p95_elapsed_ms', 0),
    },
  };
};

const loadMemoryQueueWeeklyFallback = () => {
  const filePath = findLatestMemoryQueueMarkdown();
  if (!filePath) {
    return null;
  }
  const markdown = fs.readFileSync(filePath, 'utf8');
  return {
    report_key: `local-fallback:${path.basename(filePath)}`,
    baseline_summary: {
      jobs_total: parseWeeklyMarkdownNumber(markdown, 'jobs_total', 0),
      retry_rate_pct: parseWeeklyMarkdownNumber(markdown, 'retry_rate_pct', 0),
      queue_lag_p95_sec: parseWeeklyMarkdownNumber(markdown, 'queue_lag_p95_sec', 0),
      deadletter_pending: parseWeeklyMarkdownNumber(markdown, 'deadletter_pending', 0),
      deadletter_ignored: parseWeeklyMarkdownNumber(markdown, 'deadletter_ignored', 0),
    },
  };
};

const fetchLatestByKind = async (client, params) => {
  const fromIso = new Date(Date.now() - params.windowMs).toISOString();
  const query = client
    .from('agent_weekly_reports')
    .select('report_key,report_kind,baseline_summary,delta_summary,top_actions,created_at')
    .in('report_kind', ['go_no_go_weekly', 'llm_latency_weekly', 'hybrid_weekly', 'rollback_rehearsal_weekly', 'memory_queue_weekly'])
    .gte('created_at', fromIso)
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (params.provider) {
    query.eq('provider', params.provider);
  }
  if (params.actionPrefix) {
    query.eq('action_prefix', params.actionPrefix);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  const rows = data || [];
  return {
    goNoGo: pickPreferredReport(rows, 'go_no_go_weekly', params.guildId),
    llmLatency: pickPreferredReport(rows, 'llm_latency_weekly', params.guildId),
    hybrid: pickPreferredReport(rows, 'hybrid_weekly', params.guildId),
    rollbackWeekly: pickPreferredReport(rows, 'rollback_rehearsal_weekly', params.guildId),
    memoryQueueWeekly: pickPreferredReport(rows, 'memory_queue_weekly', params.guildId),
  };
};

const extractAgentRoleFromVerification = (verification) => {
  if (!Array.isArray(verification)) {
    return null;
  }
  for (const line of verification) {
    const text = String(line || '').trim().toLowerCase();
    const match = text.match(/^agent_role=(openjarvis|opencode|nemoclaw|opendev)$/);
    if (match) {
      return match[1];
    }
  }
  return null;
};

const fetchAgentRoleKpiSignals = async (client, params) => {
  const result = {
    availability: 'ok',
    sampleCount: 0,
    byRole: {
      openjarvis: { total: 0, failed: 0, retries: 0, p95DurationMs: 0, failRate: null, retryRate: null },
      opencode: { total: 0, failed: 0, retries: 0, p95DurationMs: 0, failRate: null, retryRate: null },
      nemoclaw: { total: 0, failed: 0, retries: 0, p95DurationMs: 0, failRate: null, retryRate: null },
      opendev: { total: 0, failed: 0, retries: 0, p95DurationMs: 0, failRate: null, retryRate: null },
    },
  };

  const fromIso = new Date(Date.now() - params.windowMs).toISOString();
  let rows = [];
  try {
    let query = client
      .from('agent_action_logs')
      .select('guild_id,status,retry_count,duration_ms,verification,created_at')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (params.guildId) {
      query = query.eq('guild_id', params.guildId);
    }

    const { data, error } = await query;
    if (error) {
      if (params.allowMissingQualityTables && isMissingRelationError(error, 'agent_action_logs')) {
        result.availability = 'missing_table';
        return result;
      }
      throw new Error(error.message || 'AGENT_ACTION_LOGS_QUERY_FAILED');
    }
    rows = data || [];
  } catch (error) {
    if (params.allowMissingQualityTables && isMissingRelationError(error, 'agent_action_logs')) {
      result.availability = 'missing_table';
      return result;
    }
    throw error;
  }

  const durationsByRole = {
    openjarvis: [],
    opencode: [],
    nemoclaw: [],
    opendev: [],
  };

  for (const row of rows) {
    const role = extractAgentRoleFromVerification(row?.verification);
    if (!role || !result.byRole[role]) {
      continue;
    }

    result.sampleCount += 1;
    result.byRole[role].total += 1;
    if (String(row?.status || '').trim().toLowerCase() !== 'success') {
      result.byRole[role].failed += 1;
    }

    const retries = asNumber(row?.retry_count, 0);
    if (retries > 0) {
      result.byRole[role].retries += 1;
    }

    const durationMs = asNumber(row?.duration_ms, null);
    if (durationMs !== null && durationMs >= 0) {
      durationsByRole[role].push(durationMs);
    }
  }

  for (const role of Object.keys(result.byRole)) {
    const current = result.byRole[role];
    const durations = [...durationsByRole[role]].sort((a, b) => a - b);
    const p95Index = durations.length > 0
      ? Math.max(0, Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1))
      : 0;
    current.p95DurationMs = durations.length > 0 ? durations[p95Index] : 0;
    current.failRate = current.total > 0 ? Number((current.failed / current.total).toFixed(4)) : null;
    current.retryRate = current.total > 0 ? Number((current.retries / current.total).toFixed(4)) : null;
  }

  return result;
};

const fetchPreviousWeekPatterns = async (client, params) => {
  const twoWeeksAgo = new Date(Date.now() - params.windowMs * 2).toISOString();
  const oneWeekAgo = new Date(Date.now() - params.windowMs).toISOString();
  try {
    let query = client
      .from('agent_weekly_reports')
      .select('baseline_summary, created_at')
      .eq('report_kind', 'self_improvement_patterns')
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', oneWeekAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (params.guildId) {
      query = query.eq('guild_id', params.guildId);
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    return data[0].baseline_summary || null;
  } catch {
    return null;
  }
};

const verifyPatternRegression = (currentPatterns, previousPatterns) => {
  if (!previousPatterns || !Array.isArray(previousPatterns.patterns)) {
    return { available: false, resolved: [], ongoing: [], newlyDetected: [], worsened: [] };
  }

  const prevById = new Map(previousPatterns.patterns.map((p) => [p.id, p]));
  const currIds = new Set(currentPatterns.map((p) => p.id));

  const resolved = previousPatterns.patterns
    .filter((p) => !currIds.has(p.id))
    .map((p) => ({ id: p.id, previousSeverity: p.severity, signal: p.signal }));

  const ongoing = [];
  const worsened = [];
  const severityRank = { low: 0, medium: 1, high: 2 };

  for (const curr of currentPatterns) {
    const prev = prevById.get(curr.id);
    if (!prev) continue;
    const prevRank = severityRank[prev.severity] ?? 0;
    const currRank = severityRank[curr.severity] ?? 0;
    if (currRank > prevRank) {
      worsened.push({ id: curr.id, previousSeverity: prev.severity, currentSeverity: curr.severity, signal: curr.signal });
    } else {
      ongoing.push({ id: curr.id, severity: curr.severity, signal: curr.signal });
    }
  }

  const newlyDetected = currentPatterns
    .filter((p) => !prevById.has(p.id))
    .map((p) => ({ id: p.id, severity: p.severity, signal: p.signal }));

  return { available: true, resolved, ongoing, newlyDetected, worsened };
};

const persistSelfImprovementPatterns = async (client, params) => {
  try {
    const payload = {
      report_key: `self_improvement_patterns:${params.generatedAt.slice(0, 10)}`,
      report_kind: 'self_improvement_patterns',
      guild_id: params.guildId || null,
      baseline_summary: {
        patterns: params.patterns.map((p) => ({
          id: p.id,
          severity: p.severity,
          signal: p.signal,
          patchProposal: p.patchProposal,
        })),
        regression: params.regression,
        totalPatterns: params.patterns.length,
        highSeverityCount: params.patterns.filter((p) => p.severity === 'high').length,
      },
      created_at: params.generatedAt,
    };
    const { error } = await client
      .from('agent_weekly_reports')
      .upsert(payload, { onConflict: 'report_key' });
    if (error) {
      console.log(`[SELF-IMPROVEMENT] pattern persistence failed: ${error.message}`);
    } else {
      console.log(`[SELF-IMPROVEMENT] patterns persisted: ${payload.report_key}`);
    }
  } catch (err) {
    console.log(`[SELF-IMPROVEMENT] pattern persistence error: ${err?.message || err}`);
  }
};

const toPatterns = (reports, qualitySignals, opencodeSignals, agentRoleKpi) => {
  const patterns = [];
  const go = reports.goNoGo?.baseline_summary || {};
  const llmDelta = reports.llmLatency?.delta_summary || {};
  const rollback = reports.rollbackWeekly?.baseline_summary || {};
  const memoryQueue = reports.memoryQueueWeekly?.baseline_summary || {};
  const qualityGate = go?.gate_verdict_counts?.quality || {};
  const noGoRootCause = go?.no_go_root_cause || {};
  const requiredActionCompletion = go?.required_action_completion || {};
  const recentRuns = reports.goNoGo?.top_actions?.recent_runs || [];

  const noGoCount = asNumber(go.no_go, 0);
  const dualFailCount = asNumber(noGoRootCause.reliability_quality_dual_fail, 0);
  const reliabilityOnlyFailCount = asNumber(noGoRootCause.reliability_only_fail, 0);
  const qualityOnlyFailCount = asNumber(noGoRootCause.quality_only_fail, 0);
  const pendingNoGoCount = asNumber(noGoRootCause.all_gates_pending, 0);
  const requiredActionCompletionRate = Number(requiredActionCompletion?.required_action_completion_rate);
  if (noGoCount > 0) {
    const noGoScopes = recentRuns
      .filter((run) => String(run?.overall || '').toLowerCase() === 'no-go')
      .map((run) => String(run?.scope || 'unknown'))
      .slice(0, 5);
    patterns.push({
      id: 'pattern-go-no-go-failures',
      severity: 'high',
      signal: `주간 no-go ${noGoCount}건`,
      detail: noGoScopes.length > 0 ? `no-go scope: ${noGoScopes.join(', ')}` : 'no-go run detected',
      patchProposal: '최근 no-go scope 기준으로 gate threshold/rollback playbook을 보정하고, 실패 scope별 재검증 스모크를 추가한다.',
      regressionChecks: ['npm run -s gates:validate', 'npm run -s gates:weekly-report -- --days=7'],
    });
  }

  if (dualFailCount > 0) {
    patterns.push({
      id: 'pattern-dual-gate-fail-cluster',
      severity: dualFailCount >= 3 ? 'high' : 'medium',
      signal: `reliability+quality 동시 실패 ${dualFailCount}건`,
      detail: '동시 실패군은 단일 파라미터 조정보다 provider/queue/retrieval 입력 분리가 우선 필요',
      patchProposal: 'no-go scope를 provider profile, queue pressure, retrieval quality 신호로 분해하는 triage 리포트를 weekly pipeline에 추가한다.',
      regressionChecks: ['npm run -s gates:weekly-report:normalized', 'npm run -s gates:weekly-report:self-improvement:dry'],
    });
  }

  if (reliabilityOnlyFailCount > 0) {
    patterns.push({
      id: 'pattern-reliability-only-fail',
      severity: 'medium',
      signal: `reliability 단독 실패 ${reliabilityOnlyFailCount}건`,
      detail: '품질 게이트는 통과했으나 지연/오류율/큐 지표의 임계치 이탈 발생',
      patchProposal: 'latency/error budget을 action prefix별로 나눠 상위 경로 timeout과 fallback 우선순위를 재조정한다.',
      regressionChecks: ['npm run -s perf:llm-latency:weekly:dry', 'npm run -s gates:validate:strict'],
    });
  }

  if (qualityOnlyFailCount > 0) {
    patterns.push({
      id: 'pattern-quality-only-fail',
      severity: 'medium',
      signal: `quality 단독 실패 ${qualityOnlyFailCount}건`,
      detail: '안전/거버넌스/신뢰성은 유지되나 citation/retrieval/session success 품질이 임계치 미달',
      patchProposal: 'quality-first profile 유지 기간을 강제하고 retrieval eval 샘플 밀도를 늘려 quality gate 재판정 신뢰도를 높인다.',
      regressionChecks: ['npm run -s gates:auto-judge:weekly:pending', 'npm run -s gates:weekly-report:all:dry'],
    });
  }

  if (pendingNoGoCount > 0) {
    patterns.push({
      id: 'pattern-legacy-pending-normalization',
      severity: 'medium',
      signal: `all-gates-pending no-go ${pendingNoGoCount}건`,
      detail: 'legacy 런의 메트릭 누락이 현재 KPI를 왜곡할 수 있음',
      patchProposal: 'normalized weekly report를 기준 KPI로 병행 운영하고, legacy pending 런은 closure evidence와 함께 별도 트랙으로 관리한다.',
      regressionChecks: ['npm run -s gates:weekly-report:normalized:dry', 'npm run -s gates:weekly-report:normalized'],
    });
  }

  if (Number.isFinite(requiredActionCompletionRate) && requiredActionCompletionRate < 0.95) {
    patterns.push({
      id: 'pattern-required-action-completion-gap',
      severity: requiredActionCompletionRate < 0.8 ? 'high' : 'medium',
      signal: `required action completion rate=${requiredActionCompletionRate}`,
      detail: 'no-go 후속 액션의 실제 완료 추정치가 목표(>=0.95) 미달',
      patchProposal: 'post-decision checklist 자동완료 조건을 강화하고 미완료 항목을 다음 체크포인트 blocking rule로 승격한다.',
      regressionChecks: ['npm run -s gates:validate:strict', 'npm run -s gates:weekly-report -- --days=7'],
    });
  }

  const qualityFailCount = asNumber(qualityGate.fail, 0);
  if (qualityFailCount > 0) {
    patterns.push({
      id: 'pattern-provider-profile-quality-fallback',
      severity: qualityFailCount > 2 ? 'high' : 'medium',
      signal: `quality gate fail ${qualityFailCount}건`,
      detail: 'quality gate fail 감지로 quality-optimized profile 회귀가 필요',
      patchProposal: 'runtime profile을 quality-first로 회귀하고, 회귀 기간 동안 citation/retrieval/hallucination 지표를 재측정해 fail count가 0으로 복귀하는지 검증한다.',
      regressionChecks: ['npm run -s gates:auto-judge:weekly:pending', 'npm run -s gates:weekly-report:all:dry'],
    });
  }

  const p95Delta = asNumber(llmDelta.p95_latency_ms, 0);
  if (p95Delta > 30) {
    patterns.push({
      id: 'pattern-llm-latency-regression',
      severity: p95Delta > 80 ? 'high' : 'medium',
      signal: `p95 latency delta +${p95Delta}ms`,
      detail: 'candidate window latency가 baseline 대비 악화',
      patchProposal: 'latency 상위 action을 우선 대상으로 provider fallback/timeout/budget profile을 조정한다.',
      regressionChecks: ['npm run -s perf:llm-latency', 'npm run -s perf:llm-latency:weekly:dry'],
    });
  }

  const successDelta = asNumber(llmDelta.success_rate_pct, 0);
  if (successDelta < -2) {
    patterns.push({
      id: 'pattern-llm-success-drop',
      severity: successDelta < -5 ? 'high' : 'medium',
      signal: `success rate delta ${successDelta}%`,
      detail: 'candidate window 성공률 하락',
      patchProposal: '실패코드 상위군(action/policy/runtime)을 분리해 prompt/policy/worker 단위 패치를 제안하고 승인 큐에 연결한다.',
      regressionChecks: ['npm run -s gates:weekly-report:all:dry', 'npm run -s gates:validate'],
    });
  }

  const rollbackFail = asNumber(rollback.fail, 0);
  if (rollbackFail > 0) {
    patterns.push({
      id: 'pattern-rollback-rehearsal-failure',
      severity: 'high',
      signal: `rollback rehearsal fail ${rollbackFail}건`,
      detail: `rollback p95 elapsed ${asNumber(rollback.p95_elapsed_ms, 0)}ms`,
      patchProposal: 'stage/queue/provider rollback 경로를 재리허설하고, 실패 케이스를 runbook 11.4에 복구 단계별 체크포인트로 고정한다.',
      regressionChecks: ['npm run -s rehearsal:stage-rollback:record:dry', 'npm run -s gates:weekly-report:rollback:dry'],
    });
  }

  const deadletterPending = asNumber(memoryQueue.deadletter_pending, 0);
  const deadletterIgnored = asNumber(memoryQueue.deadletter_ignored, 0);
  const retryRatePct = asNumber(memoryQueue.retry_rate_pct, 0);
  const queueLagP95Sec = asNumber(memoryQueue.queue_lag_p95_sec, 0);
  if (deadletterPending > 0 || deadletterIgnored > 0 || retryRatePct > 40 || queueLagP95Sec > 120) {
    patterns.push({
      id: 'pattern-memory-queue-pressure',
      severity: deadletterPending > 0 || deadletterIgnored > 0 ? 'high' : 'medium',
      signal: `deadletter_pending=${deadletterPending}, deadletter_ignored=${deadletterIgnored}, retry_rate_pct=${retryRatePct}, queue_lag_p95_sec=${queueLagP95Sec}`,
      detail: '메모리 큐 압력이 정책 임계치를 초과',
      patchProposal: 'MEMORY_JOBS_MAX_RETRIES/BACKOFF/DEADLETTER_RECOVERY 설정을 조정하고 고정 부하 시나리오에서 queue stats/deadletter requeue 경로를 회귀 검증한다.',
      regressionChecks: ['npm run -s memory:queue:report:dry', 'npm run -s gates:weekly-report:all:dry'],
    });
  }

  const recallDelta = asNumber(qualitySignals?.retrieval?.deltaGotVsBaseline, null);
  if (recallDelta !== null && recallDelta < -0.03) {
    patterns.push({
      id: 'pattern-labeled-recall-regression',
      severity: recallDelta < -0.08 ? 'high' : 'medium',
      signal: `labeled recall@k delta(got-baseline)=${recallDelta}`,
      detail: '라벨 기반 retrieval 평가에서 got 품질이 baseline 대비 하락',
      patchProposal: 'retrieval ranker active profile을 baseline 우선으로 임시 회귀하고, eval set/variant를 재실행해 recall@k delta가 0 이상으로 복귀하는지 검증한다.',
      regressionChecks: ['npm run -s gates:weekly-report:self-improvement:dry', 'npm run -s gates:weekly-report:all:dry'],
    });
  }

  const hallucinationDeltaPct = asNumber(qualitySignals?.hallucination?.deltaGotVsBaselinePct, null);
  if (hallucinationDeltaPct !== null && hallucinationDeltaPct > 1) {
    patterns.push({
      id: 'pattern-labeled-hallucination-drift',
      severity: hallucinationDeltaPct > 3 ? 'high' : 'medium',
      signal: `labeled hallucination fail rate delta(got-baseline)=+${hallucinationDeltaPct}%p`,
      detail: '인간 라벨 리뷰 기준 hallucination fail rate가 baseline 대비 악화',
      patchProposal: 'quality-first profile 유지 상태에서 got/tot cutover 조건을 강화하고, reviewer 샘플을 늘려 delusion cluster를 재라벨링한다.',
      regressionChecks: ['npm run -s gates:weekly-report:self-improvement:dry', 'npm run -s gates:auto-judge:weekly:pending'],
    });
  }

  const approvalRequiredRate = asNumber(opencodeSignals?.executions?.approvalRequiredRate, null);
  const opencodeTotal = asNumber(opencodeSignals?.executions?.total, 0);
  if (approvalRequiredRate !== null && opencodeTotal > 0 && approvalRequiredRate < 0.99) {
    patterns.push({
      id: 'pattern-opencode-approval-required-drift',
      severity: approvalRequiredRate < 0.9 ? 'high' : 'medium',
      signal: `opencode approval_required rate=${approvalRequiredRate}`,
      detail: 'opencode.execute 파일럿의 approval_required 고정 정책 준수율 저하',
      patchProposal: '길드별 opencode.execute 정책을 approval_required로 재보정하고, 자동 실행 경로를 차단한 뒤 승인 로그 누락을 회귀 점검한다.',
      regressionChecks: ['npm run -s gates:weekly-report:self-improvement:dry', 'npm run -s gates:auto-judge:weekly:pending'],
    });
  }

  const approvalPending = asNumber(opencodeSignals?.approvals?.pending, 0);
  if (approvalPending > 10) {
    patterns.push({
      id: 'pattern-opencode-approval-backlog',
      severity: approvalPending > 25 ? 'high' : 'medium',
      signal: `opencode approval pending=${approvalPending}`,
      detail: 'opencode 승인 큐 적체로 pilot execution 처리 지연이 발생',
      patchProposal: '승인 SLA를 설정하고 pending 만료/분류 정책을 적용해 운영자 승인 큐를 정리한다.',
      regressionChecks: ['npm run -s gates:weekly-report:self-improvement:dry'],
    });
  }

  const roleRows = Object.entries(agentRoleKpi?.byRole || {});
  for (const [role, row] of roleRows) {
    const total = asNumber(row?.total, 0);
    const failRate = asNumber(row?.failRate, null);
    const retryRate = asNumber(row?.retryRate, null);
    const p95DurationMs = asNumber(row?.p95DurationMs, 0);

    if (total >= 4 && failRate !== null && failRate >= 0.25) {
      patterns.push({
        id: `pattern-agent-role-failrate-${role}`,
        severity: failRate >= 0.4 ? 'high' : 'medium',
        signal: `${role} fail_rate=${failRate} (total=${total})`,
        detail: `${role} 실행군에서 실패율이 높아 병목 가능성이 큼 (p95=${p95DurationMs}ms, retry_rate=${retryRate ?? 'n/a'})`,
        patchProposal: `${role} 경로의 최근 실패코드 상위군을 분리해 가드레일/재시도 정책을 보정하고, 실패 재현 케이스를 회귀 테스트에 추가한다.`,
        regressionChecks: ['npm run -s gates:weekly-report:self-improvement:dry', 'npm run -s gates:validate'],
      });
    }
  }

  if (patterns.length === 0) {
    patterns.push({
      id: 'pattern-stable-window',
      severity: 'low',
      signal: '주요 회귀 신호 없음',
      detail: '현재 주간 윈도우에서 no-go/latency/성공률 경고 신호가 임계 미만',
      patchProposal: '상위 failure pattern 수집 범위를 길드/액션 prefix로 세분화해 self-improvement 샘플 밀도를 높인다.',
      regressionChecks: ['npm run -s gates:weekly-report:all:dry'],
    });
  }

  return patterns;
};

const buildRegressionSection = (regression) => {
  if (!regression || !regression.available) {
    return '- previous_week_data: unavailable (첫 주 또는 이전 주 데이터 없음)\n- comparison: skipped';
  }

  const lines = [];
  lines.push(`- previous_week_data: available`);
  lines.push(`- resolved_patterns: ${regression.resolved.length}`);
  for (const item of regression.resolved) {
    lines.push(`  - ✅ ${item.id} (was ${item.previousSeverity}): ${item.signal}`);
  }
  lines.push(`- ongoing_patterns: ${regression.ongoing.length}`);
  for (const item of regression.ongoing) {
    lines.push(`  - ⏳ ${item.id} (${item.severity}): ${item.signal}`);
  }
  lines.push(`- worsened_patterns: ${regression.worsened.length}`);
  for (const item of regression.worsened) {
    lines.push(`  - ⚠️ ${item.id} (${item.previousSeverity}→${item.currentSeverity}): ${item.signal}`);
  }
  lines.push(`- newly_detected: ${regression.newlyDetected.length}`);
  for (const item of regression.newlyDetected) {
    lines.push(`  - 🆕 ${item.id} (${item.severity}): ${item.signal}`);
  }

  const improvementScore = regression.resolved.length - regression.worsened.length;
  lines.push(`- improvement_score: ${improvementScore > 0 ? '+' : ''}${improvementScore} (resolved=${regression.resolved.length}, worsened=${regression.worsened.length})`);

  return lines.join('\n');
};

const buildMarkdown = (params) => {
  const goKey = params.reports.goNoGo?.report_key || 'missing';
  const llmKey = params.reports.llmLatency?.report_key || 'missing';
  const hybridKey = params.reports.hybrid?.report_key || 'missing';
  const rollbackKey = params.reports.rollbackWeekly?.report_key || 'missing';
  const memoryQueueKey = params.reports.memoryQueueWeekly?.report_key || 'missing';

  const rows = params.patterns
    .map((item, index) => {
      const checks = item.regressionChecks.map((cmd) => `  - ${cmd}`).join('\n');
      return [
        `### P-${String(index + 1).padStart(2, '0')} ${item.id}`,
        `- severity: ${item.severity}`,
        `- signal: ${item.signal}`,
        `- detail: ${item.detail}`,
        `- patch_proposal: ${item.patchProposal}`,
        '- regression_checks:',
        checks,
      ].join('\n');
    })
    .join('\n\n');

  const retrieval = params.qualitySignals?.retrieval || {};
  const hallucination = params.qualitySignals?.hallucination || {};
  const retrievalAvailability = params.qualitySignals?.availability?.retrievalEvalRuns || 'ok';
  const reviewAvailability = params.qualitySignals?.availability?.answerQualityReviews || 'ok';

  const retrievalBaselineAvg = retrieval?.byVariant?.baseline?.recallAtKAvg;
  const retrievalTotAvg = retrieval?.byVariant?.tot?.recallAtKAvg;
  const retrievalGotAvg = retrieval?.byVariant?.got?.recallAtKAvg;

  const hallucinationBaselineRate = hallucination?.byStrategy?.baseline?.failRatePct;
  const hallucinationTotRate = hallucination?.byStrategy?.tot?.failRatePct;
  const hallucinationGotRate = hallucination?.byStrategy?.got?.failRatePct;

  const opencode = params.opencodeSignals || {};
  const opencodeApprovalRate = opencode?.executions?.approvalRequiredRate;
  const goBaseline = params.reports.goNoGo?.baseline_summary || {};
  const rootCause = goBaseline?.no_go_root_cause || {};
  const actionCompletion = goBaseline?.required_action_completion || {};
  const roleKpi = params.agentRoleKpi || { availability: 'ok', sampleCount: 0, byRole: {} };
  const roleKpiLines = Object.entries(roleKpi.byRole || {})
    .map(([role, row]) => `- ${role}: total=${asNumber(row?.total, 0)}, failed=${asNumber(row?.failed, 0)}, fail_rate=${row?.failRate ?? 'n/a'}, retry_rate=${row?.retryRate ?? 'n/a'}, p95_duration_ms=${asNumber(row?.p95DurationMs, 0)}`)
    .join('\n');

  return `# Self-Improvement Weekly Proposals\n\n- generated_at: ${params.generatedAt}\n- window_days: ${params.windowDays}\n- guild_id: ${params.guildId || '*'}\n- provider: ${params.provider || '*'}\n- action_prefix: ${params.actionPrefix || '*'}\n\n## Source Snapshots\n\n- go_no_go_weekly: ${goKey}\n- llm_latency_weekly: ${llmKey}\n- hybrid_weekly: ${hybridKey}\n- rollback_rehearsal_weekly: ${rollbackKey}\n- memory_queue_weekly: ${memoryQueueKey}\n\n## Labeled Quality Signals (M-07)\n\n- retrieval_eval_runs_availability: ${retrievalAvailability}\n- retrieval_eval_runs_samples: ${asNumber(retrieval.sampleRuns, 0)}\n- recall_at_k_avg_baseline: ${retrievalBaselineAvg ?? 'n/a'}\n- recall_at_k_avg_tot: ${retrievalTotAvg ?? 'n/a'}\n- recall_at_k_avg_got: ${retrievalGotAvg ?? 'n/a'}\n- recall_at_k_delta_got_vs_baseline: ${retrieval.deltaGotVsBaseline ?? 'n/a'}\n\n- answer_quality_reviews_availability: ${reviewAvailability}\n- answer_quality_reviews_samples: ${asNumber(hallucination.sampleReviews, 0)}\n- hallucination_fail_rate_pct_baseline: ${hallucinationBaselineRate ?? 'n/a'}\n- hallucination_fail_rate_pct_tot: ${hallucinationTotRate ?? 'n/a'}\n- hallucination_fail_rate_pct_got: ${hallucinationGotRate ?? 'n/a'}\n- hallucination_delta_pct_got_vs_baseline: ${hallucination.deltaGotVsBaselinePct ?? 'n/a'}\n\n## Opencode Pilot Signals (M-05)\n\n- action_logs_availability: ${opencode?.availability?.actionLogs || 'ok'}\n- approvals_availability: ${opencode?.availability?.approvals || 'ok'}\n- opencode_executions_total: ${asNumber(opencode?.executions?.total, 0)}\n- opencode_executions_success: ${asNumber(opencode?.executions?.success, 0)}\n- opencode_executions_failed: ${asNumber(opencode?.executions?.failed, 0)}\n- opencode_approval_required_rate: ${opencodeApprovalRate ?? 'n/a'}\n- opencode_approvals_pending: ${asNumber(opencode?.approvals?.pending, 0)}\n- opencode_approvals_approved: ${asNumber(opencode?.approvals?.approved, 0)}\n- opencode_approvals_rejected: ${asNumber(opencode?.approvals?.rejected, 0)}\n- opencode_approvals_expired: ${asNumber(opencode?.approvals?.expired, 0)}\n\n## No-Go Root Cause and Action Completion

- no_go_root_reliability_quality_dual_fail: ${asNumber(rootCause?.reliability_quality_dual_fail, 0)}
- no_go_root_reliability_only_fail: ${asNumber(rootCause?.reliability_only_fail, 0)}
- no_go_root_quality_only_fail: ${asNumber(rootCause?.quality_only_fail, 0)}
- no_go_root_all_gates_pending: ${asNumber(rootCause?.all_gates_pending, 0)}
- required_action_completion_rate: ${Number.isFinite(Number(actionCompletion?.required_action_completion_rate)) ? Number(actionCompletion.required_action_completion_rate) : 'n/a'}
- required_actions_total: ${asNumber(actionCompletion?.required_actions_total, 0)}
- checklist_incomplete_runs: ${asNumber(actionCompletion?.checklist_incomplete_runs, 0)}

## Agent Role KPI Signals\n\n- availability: ${roleKpi.availability}\n- samples: ${asNumber(roleKpi.sampleCount, 0)}\n${roleKpiLines || '- no agent_role samples'}\n\n## Failure Patterns and Patch Proposals\n\n${rows}\n\n## Regression Verification (vs Previous Week)\n\n${buildRegressionSection(params.regression)}\n\n## Execution Gate\n\n- next_step: 승인 가능한 패치 제안을 execution board Next 항목(M-05 self-improvement loop v1)에 연결\n- required_validation:\n  - npm run -s gates:validate\n  - npm run -s gates:weekly-report:all:dry\n`;
};

const writeMarkdownArtifact = (params) => {
  const outputArg = String(parseArg('output', '')).trim();
  const filename = `${params.generatedAt.slice(0, 10)}_self-improvement-weekly.md`;
  const outputPath = outputArg
    ? path.resolve(ROOT, outputArg)
    : path.join(OUTPUT_DIR, filename);

  if (!params.dryRun) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, params.markdown, 'utf8');
  }

  console.log(`[SELF-IMPROVEMENT] markdown ${params.dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`);
};

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required');
  }

  const dryRun = parseBool(parseArg('dryRun', 'false'));
  const sinks = parseSinks(parseArg('sinks', process.env.SELF_IMPROVEMENT_WEEKLY_SINKS || 'markdown'));
  const guildId = String(parseArg('guildId', '')).trim() || null;
  const provider = String(parseArg('provider', '')).trim() || null;
  const actionPrefix = String(parseArg('actionPrefix', '')).trim() || null;
  const allowMissingQualityTables = parseBool(parseArg('allowMissingQualityTables', process.env.SELF_IMPROVEMENT_ALLOW_MISSING_QUALITY_TABLES || 'true'), true);
  const allowMissingSourceSnapshots = parseBool(
    parseArg('allowMissingSourceSnapshots', process.env.SELF_IMPROVEMENT_ALLOW_MISSING_SOURCE_SNAPSHOTS || 'false'),
    false,
  );
  const windowDays = Math.max(1, Number(parseArg('days', '7')) || 7);
  const windowMs = toMsWindow(windowDays, 7);
  const limit = Math.max(20, Math.min(500, Number(parseArg('limit', '120')) || 120));

  const generatedAt = new Date().toISOString();
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  let reports;
  try {
    reports = await fetchLatestByKind(client, {
      windowMs,
      guildId,
      provider,
      actionPrefix,
      limit,
    });
  } catch (error) {
    if (allowMissingSourceSnapshots && isMissingRelationError(error, 'agent_weekly_reports')) {
      console.log('[SELF-IMPROVEMENT] skipped: table public.agent_weekly_reports not found (apply migration first)');
      return;
    }
    throw error;
  }

  const missing = [
    !reports.goNoGo ? 'go_no_go_weekly' : null,
    !reports.llmLatency ? 'llm_latency_weekly' : null,
    !reports.hybrid ? 'hybrid_weekly' : null,
    !reports.rollbackWeekly ? 'rollback_rehearsal_weekly' : null,
    !reports.memoryQueueWeekly ? 'memory_queue_weekly' : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    if (!dryRun) {
      if (!reports.rollbackWeekly) {
        reports.rollbackWeekly = loadRollbackWeeklyFallback();
      }
      if (!reports.memoryQueueWeekly) {
        reports.memoryQueueWeekly = loadMemoryQueueWeeklyFallback();
      }

      const stillMissing = [
        !reports.goNoGo ? 'go_no_go_weekly' : null,
        !reports.llmLatency ? 'llm_latency_weekly' : null,
        !reports.hybrid ? 'hybrid_weekly' : null,
        !reports.rollbackWeekly ? 'rollback_rehearsal_weekly' : null,
        !reports.memoryQueueWeekly ? 'memory_queue_weekly' : null,
      ].filter(Boolean);

      if (stillMissing.length > 0) {
        if (allowMissingSourceSnapshots) {
          console.log(`[SELF-IMPROVEMENT] skipped: missing source snapshots within window (${stillMissing.join(', ')})`);
          return;
        }
        throw new Error(`Missing source snapshots: ${stillMissing.join(', ')} must all exist within window`);
      }

      console.log('[SELF-IMPROVEMENT] local fallback loaded for missing snapshots');
    } else {
      console.log(`[SELF-IMPROVEMENT] dry-run fallback for missing snapshots: ${missing.join(', ')}`);
      if (!reports.rollbackWeekly) {
        reports.rollbackWeekly = {
          report_key: 'dry-run-missing:rollback_rehearsal_weekly',
          baseline_summary: {
            total_runs: 0,
            pass: 0,
            fail: 0,
            p95_elapsed_ms: 0,
          },
        };
      }
      if (!reports.memoryQueueWeekly) {
        reports.memoryQueueWeekly = {
          report_key: 'dry-run-missing:memory_queue_weekly',
          baseline_summary: {
            jobs_total: 0,
            retry_rate_pct: 0,
            queue_lag_p95_sec: 0,
            deadletter_pending: 0,
            deadletter_ignored: 0,
          },
        };
      }
    }
  }

  if (!reports.goNoGo || !reports.llmLatency || !reports.hybrid || !reports.rollbackWeekly || !reports.memoryQueueWeekly) {
    if (allowMissingSourceSnapshots) {
      const stillMissing = [
        !reports.goNoGo ? 'go_no_go_weekly' : null,
        !reports.llmLatency ? 'llm_latency_weekly' : null,
        !reports.hybrid ? 'hybrid_weekly' : null,
        !reports.rollbackWeekly ? 'rollback_rehearsal_weekly' : null,
        !reports.memoryQueueWeekly ? 'memory_queue_weekly' : null,
      ].filter(Boolean);
      console.log(`[SELF-IMPROVEMENT] skipped: missing required snapshots after fallback handling (${stillMissing.join(', ')})`);
      return;
    }
    throw new Error('Missing required snapshots after fallback handling');
  }

  const qualitySignals = await fetchLabeledQualitySignals(client, {
    guildId,
    windowMs,
    allowMissingQualityTables,
  });

  const opencodeSignals = await fetchOpencodePilotSignals(client, {
    guildId,
    windowMs,
    allowMissingQualityTables,
  });

  const agentRoleKpi = await fetchAgentRoleKpiSignals(client, {
    guildId,
    windowMs,
    allowMissingQualityTables,
  });

  const patterns = toPatterns(reports, qualitySignals, opencodeSignals, agentRoleKpi);

  const previousPatterns = await fetchPreviousWeekPatterns(client, { windowMs, guildId });
  const regression = verifyPatternRegression(patterns, previousPatterns);

  const markdown = buildMarkdown({
    generatedAt,
    windowDays,
    guildId,
    provider,
    actionPrefix,
    reports,
    patterns,
    qualitySignals,
    opencodeSignals,
    agentRoleKpi,
    regression,
  });

  if (!dryRun) {
    await persistSelfImprovementPatterns(client, { generatedAt, guildId, patterns, regression });

    // D-02: Trigger jarvis.optimize after weekly self-improvement patterns are persisted
    await triggerJarvisOptimize(patterns);
  }

  const context = {
    dryRun,
    sinks,
    generatedAt,
    markdown,
  };

  console.log(`[SELF-IMPROVEMENT] sinks=${sinks.join(',')} dryRun=${dryRun} proposals=${patterns.length}`);

  if (sinks.includes('markdown')) {
    writeMarkdownArtifact(context);
  }
  if (sinks.includes('stdout')) {
    console.log('\n[SELF-IMPROVEMENT] report markdown\n');
    console.log(markdown);
  }
}

main().catch((error) => {
  console.error('[SELF-IMPROVEMENT] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

