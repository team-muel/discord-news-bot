/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { parseArg, parseBool, parseSinks } from './lib/cliArgs.mjs';
import { SUPABASE_URL, SUPABASE_KEY, createScriptClient, isMissingRelationError } from './lib/supabaseClient.mjs';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'memory-queue-observability');
const ALERT_OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'memory-queue-alerts');
const VALID_SINKS = new Set(['markdown', 'supabase', 'stdout']);

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const asIso = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const toSec = (ms) => Math.max(0, Math.round(ms / 1000));

const nowIso = new Date().toISOString();
const days = Math.max(1, Number(parseArg('days', '7')) || 7);
const dryRun = parseBool(parseArg('dryRun', 'false'));
const sinks = parseSinks(parseArg('sinks', process.env.MEMORY_QUEUE_WEEKLY_REPORT_SINKS || 'markdown'));
const allowMissingSupabaseTable = parseBool(
  parseArg('allowMissingSupabaseTable', process.env.MEMORY_QUEUE_WEEKLY_REPORT_ALLOW_MISSING_TABLE || 'true'),
  true,
);
const allowUnsupportedReportKind = parseBool(
  parseArg('allowUnsupportedReportKind', process.env.MEMORY_QUEUE_WEEKLY_REPORT_ALLOW_UNSUPPORTED_KIND || 'true'),
  true,
);
const guildId = String(parseArg('guildId', '')).trim() || null;
const provider = String(parseArg('provider', '')).trim() || null;
const actionPrefix = String(parseArg('actionPrefix', '')).trim() || null;
const outputArg = String(parseArg('output', '')).trim();
const enableSloAlert = parseBool(parseArg('enableSloAlert', process.env.MEMORY_QUEUE_SLO_ALERT_ENABLED || 'true'), true);
const alertQueueLagThresholdSec = Math.max(1, Number(parseArg('alertQueueLagThresholdSec', process.env.MEMORY_QUEUE_ALERT_QUEUE_LAG_P95_SEC || '120')) || 120);
const alertRetryRateThresholdPct = Math.max(0, Number(parseArg('alertRetryRateThresholdPct', process.env.MEMORY_QUEUE_ALERT_RETRY_RATE_PCT || '40')) || 40);
const alertDeadletterPendingThreshold = Math.max(0, Number(parseArg('alertDeadletterPendingThreshold', process.env.MEMORY_QUEUE_ALERT_DEADLETTER_PENDING || '0')) || 0);
const alertDeadletterIgnoredThreshold = Math.max(0, Number(parseArg('alertDeadletterIgnoredThreshold', process.env.MEMORY_QUEUE_ALERT_DEADLETTER_IGNORED || '0')) || 0);
const windowFromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  if (dryRun) {
    console.log('[MEMORY-QUEUE-WEEKLY] dry-run skipped: missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
    process.exit(0);
  }
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required');
}

const client = createScriptClient();

const queryMemoryJobs = async () => {
  let query = client
    .from('memory_jobs')
    .select('id,guild_id,status,attempts,created_at,completed_at,next_attempt_at,deadlettered_at,deadletter_reason')
    .gte('created_at', windowFromIso)
    .order('created_at', { ascending: false })
    .limit(20000);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`memory_jobs query failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
};

const queryDeadletters = async () => {
  let query = client
    .from('memory_job_deadletters')
    .select('id,guild_id,error,recovery_status,recovery_attempts,created_at')
    .gte('created_at', windowFromIso)
    .order('created_at', { ascending: false })
    .limit(20000);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`memory_job_deadletters query failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
};

const buildMarkdown = (stats) => {
  const deadletterRows = stats.topDeadletterCodes
    .map((item) => `| ${item.code} | ${item.count} |`)
    .join('\n');
  const alertBreachRows = stats.sloAlert.breaches
    .map((item) => `| ${item.metric} | ${item.actual} | ${item.threshold} | ${item.reason} |`)
    .join('\n');
  const recommendationRows = stats.sloAlert.recommendedActions.map((item) => `- ${item}`).join('\n');

  return `# Memory Queue Observability Weekly Report\n\n- generated_at: ${stats.generatedAt}\n- window_days: ${stats.windowDays}\n- guild_id: ${stats.guildId || '*'}\n- baseline_from: ${stats.windowFrom}\n- baseline_to: ${stats.generatedAt}\n\n## Queue Summary\n\n- jobs_total: ${stats.jobsTotal}\n- jobs_queued: ${stats.jobsQueued}\n- jobs_running: ${stats.jobsRunning}\n- jobs_completed: ${stats.jobsCompleted}\n- jobs_failed: ${stats.jobsFailed}\n- jobs_deadlettered: ${stats.jobsDeadlettered}\n- retry_rate_pct: ${stats.retryRatePct}\n\n## Lag and Recovery\n\n- queue_lag_p50_sec: ${stats.queueLagP50Sec}\n- queue_lag_p95_sec: ${stats.queueLagP95Sec}\n- deadletter_total: ${stats.deadletterTotal}\n- deadletter_requeued: ${stats.deadletterRequeued}\n- deadletter_ignored: ${stats.deadletterIgnored}\n- deadletter_pending: ${stats.deadletterPending}\n\n## SLO Alert Evaluation\n\n- alert_enabled: ${stats.sloAlert.enabled}\n- alert_status: ${stats.sloAlert.status}\n- severity: ${stats.sloAlert.severity}\n- no_go_candidate: ${stats.sloAlert.noGoCandidate}\n\n| metric | actual | threshold | reason |\n| --- | ---: | ---: | --- |\n${alertBreachRows || '| - | - | - | - |'}\n\n## Recommended Actions\n\n${recommendationRows || '- none'}\n\n## Deadletter Error Codes (Top)\n\n| error_code | count |\n| --- | ---: |\n${deadletterRows || '| - | 0 |'}\n\n## Commands\n\n- queue stats API: GET /api/bot/agent/memory/jobs/queue-stats\n- deadletters API: GET /api/bot/agent/memory/jobs/deadletters\n- requeue API: POST /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue\n`;
};

const buildSloAlert = (stats) => {
  const breaches = [];

  if (stats.queueLagP95Sec > alertQueueLagThresholdSec) {
    breaches.push({
      metric: 'queue_lag_p95_sec',
      actual: stats.queueLagP95Sec,
      threshold: alertQueueLagThresholdSec,
      reason: 'queue lag p95 exceeded',
    });
  }
  if (stats.retryRatePct > alertRetryRateThresholdPct) {
    breaches.push({
      metric: 'retry_rate_pct',
      actual: stats.retryRatePct,
      threshold: alertRetryRateThresholdPct,
      reason: 'retry pressure exceeded',
    });
  }
  if (stats.deadletterPending > alertDeadletterPendingThreshold) {
    breaches.push({
      metric: 'deadletter_pending',
      actual: stats.deadletterPending,
      threshold: alertDeadletterPendingThreshold,
      reason: 'pending deadletters detected',
    });
  }
  if (stats.deadletterIgnored > alertDeadletterIgnoredThreshold) {
    breaches.push({
      metric: 'deadletter_ignored',
      actual: stats.deadletterIgnored,
      threshold: alertDeadletterIgnoredThreshold,
      reason: 'ignored deadletters detected',
    });
  }

  const status = breaches.length > 0 ? 'triggered' : 'clear';
  const noGoCandidate = stats.deadletterPending > alertDeadletterPendingThreshold || stats.deadletterIgnored > alertDeadletterIgnoredThreshold;
  const severity = status === 'clear'
    ? 'none'
    : noGoCandidate && stats.queueLagP95Sec > alertQueueLagThresholdSec
      ? 'SEV-1'
      : noGoCandidate
        ? 'SEV-2'
        : 'SEV-3';

  const recommendedActions = status === 'clear'
    ? []
    : [
      'GET /api/bot/agent/memory/jobs/queue-stats 결과를 확인하고 backlog 원인을 분류한다.',
      'GET /api/bot/agent/memory/jobs/deadletters 상위 error 코드를 triage하고 필요 시 requeue를 수행한다.',
      'docs/ONCALL_INCIDENT_TEMPLATE.md, docs/ONCALL_COMMS_PLAYBOOK.md 기준으로 incident/comms 기록을 시작한다.',
      noGoCandidate
        ? 'deadletter pending/ignored 신호가 해소될 때까지 no-go 후보 상태를 유지한다.'
        : 'retry/lag 임계치 복귀 시점까지 관측 cadence를 30분으로 유지한다.',
    ];

  return {
    enabled: enableSloAlert,
    status,
    severity,
    noGoCandidate,
    breaches,
    recommendedActions,
    thresholds: {
      queueLagP95Sec: alertQueueLagThresholdSec,
      retryRatePct: alertRetryRateThresholdPct,
      deadletterPending: alertDeadletterPendingThreshold,
      deadletterIgnored: alertDeadletterIgnoredThreshold,
    },
  };
};

const toSafeSlug = (value) => String(value || 'all')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'all';

const writeSloAlertArtifacts = (stats) => {
  if (!enableSloAlert || stats.sloAlert.status !== 'triggered') {
    return;
  }

  const guildSlug = toSafeSlug(stats.guildId || 'all');
  const day = stats.generatedAt.slice(0, 10);
  const baseName = `${day}_memory-queue-slo-alert_${guildSlug}`;
  const alertPath = path.join(ALERT_OUTPUT_DIR, `${baseName}.md`);
  const incidentDraftPath = path.join(ALERT_OUTPUT_DIR, `${baseName}_incident-draft.md`);
  const commsDraftPath = path.join(ALERT_OUTPUT_DIR, `${baseName}_comms-draft.md`);

  const breachLines = stats.sloAlert.breaches
    .map((item) => `- ${item.metric}: actual=${item.actual}, threshold=${item.threshold}, reason=${item.reason}`)
    .join('\n');
  const actionLines = stats.sloAlert.recommendedActions.map((item) => `- ${item}`).join('\n');

  const alertBody = `# Memory Queue SLO Alert\n\n- generated_at: ${stats.generatedAt}\n- guild_id: ${stats.guildId || '*'}\n- severity: ${stats.sloAlert.severity}\n- status: ${stats.sloAlert.status}\n- no_go_candidate: ${stats.sloAlert.noGoCandidate}\n\n## Breaches\n\n${breachLines || '- none'}\n\n## Recommended Actions\n\n${actionLines || '- none'}\n`;

  const incidentDraft = `# Incident Draft - Memory Queue SLO Alert\n\n## 1) Incident Header\n\n- Incident ID: memory-queue-${day}-${guildSlug}\n- Date: ${day}\n- Severity: ${stats.sloAlert.severity}\n- Status: Investigating\n- Incident Commander: auto\n- Comms Owner: auto\n- Ops Engineer(s): auto\n\n## 2) Scope and Impact\n\n- User impact summary: memory queue pressure detected (lag/retry/deadletter breach).\n- Affected components: Supabase | Discord bot | memory queue runner\n- Start time (detected): ${stats.generatedAt}\n- Estimated blast radius: guild ${stats.guildId || '*'} memory workflows\n\n## 3) Triage Checklist\n\n${breachLines || '- none'}\n\n## 4) Mitigation Log\n\n${actionLines || '- none'}\n`;

  const commsDraft = `# Comms Draft - Memory Queue SLO Alert\n\n## Initial Acknowledgement\n\nWe are investigating memory queue SLO signals for guild ${stats.guildId || '*'}.\nCurrent impact: queue lag/retry/deadletter thresholds exceeded.\nScope: memory queue runner and deadletter recovery path.\nNext update in ${stats.sloAlert.severity === 'SEV-1' ? '15' : '30'} minutes.\n\n## Mitigation In Progress\n\nMitigation is in progress.\nLatest action: deadletter triage and queue pressure recovery.\nValidation status: in-progress.\nNext update in ${stats.sloAlert.severity === 'SEV-1' ? '15' : '30'} minutes.\n`;

  if (!dryRun) {
    fs.mkdirSync(ALERT_OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(alertPath, alertBody, 'utf8');
    fs.writeFileSync(incidentDraftPath, incidentDraft, 'utf8');
    fs.writeFileSync(commsDraftPath, commsDraft, 'utf8');
  }

  console.log(`[MEMORY-QUEUE-WEEKLY] slo alert ${dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, alertPath).replace(/\\/g, '/')}`);
};

const buildReportKey = () => {
  const day = nowIso.slice(0, 10);
  return [
    'memory_queue_weekly',
    day,
    `days:${days}`,
    `guild:${guildId || '*'}`,
    `provider:${provider || '*'}`,
    `prefix:${actionPrefix || '*'}`,
  ].join('|');
};

const writeSupabaseArtifact = async (stats, markdown) => {
  if (dryRun) {
    console.log('[MEMORY-QUEUE-WEEKLY] supabase previewed: public.agent_weekly_reports (upsert report_key)');
    return;
  }

  const payload = {
    report_key: buildReportKey(),
    report_kind: 'memory_queue_weekly',
    guild_id: guildId,
    provider,
    action_prefix: actionPrefix,
    baseline_from: windowFromIso,
    baseline_to: nowIso,
    candidate_from: null,
    candidate_to: null,
    baseline_summary: {
      window_days: days,
      jobs_total: stats.jobsTotal,
      jobs_queued: stats.jobsQueued,
      jobs_running: stats.jobsRunning,
      jobs_completed: stats.jobsCompleted,
      jobs_failed: stats.jobsFailed,
      jobs_deadlettered: stats.jobsDeadlettered,
      retry_rate_pct: stats.retryRatePct,
      queue_lag_p50_sec: stats.queueLagP50Sec,
      queue_lag_p95_sec: stats.queueLagP95Sec,
      deadletter_total: stats.deadletterTotal,
      deadletter_requeued: stats.deadletterRequeued,
      deadletter_ignored: stats.deadletterIgnored,
      deadletter_pending: stats.deadletterPending,
      slo_alert: stats.sloAlert,
    },
    candidate_summary: {},
    delta_summary: {},
    top_actions: {
      deadletter_error_codes: stats.topDeadletterCodes,
      slo_recommended_actions: stats.sloAlert.recommendedActions,
    },
    markdown,
  };

  const { error } = await client
    .from('agent_weekly_reports')
    .upsert(payload, { onConflict: 'report_key' });

  if (error) {
    const errorCode = String(error.code || '').toUpperCase();
    const errorMessage = String(error.message || '');
    const unsupportedKind = errorCode === '23514' && /report_kind_check/i.test(errorMessage);
    if (isMissingRelationError(error, 'agent_weekly_reports') && allowMissingSupabaseTable) {
      console.log('[MEMORY-QUEUE-WEEKLY] supabase skipped: table public.agent_weekly_reports not found (apply migration first)');
      return;
    }
    if (unsupportedKind && allowUnsupportedReportKind) {
      console.log('[MEMORY-QUEUE-WEEKLY] supabase skipped: report_kind not allowed by current DB constraint (apply migration first)');
      return;
    }
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log('[MEMORY-QUEUE-WEEKLY] supabase upserted: public.agent_weekly_reports');
};

async function main() {
  const [jobs, deadletters] = await Promise.all([queryMemoryJobs(), queryDeadletters()]);

  const lagMs = jobs
    .filter((row) => ['queued', 'running'].includes(String(row.status || '').toLowerCase()))
    .map((row) => {
      const createdAtMs = Date.parse(String(row.created_at || ''));
      if (!Number.isFinite(createdAtMs)) return 0;
      return Math.max(0, Date.now() - createdAtMs);
    })
    .filter((v) => Number.isFinite(v));

  const jobsTotal = jobs.length;
  const jobsQueued = jobs.filter((row) => String(row.status || '').toLowerCase() === 'queued').length;
  const jobsRunning = jobs.filter((row) => String(row.status || '').toLowerCase() === 'running').length;
  const jobsCompleted = jobs.filter((row) => String(row.status || '').toLowerCase() === 'completed').length;
  const jobsFailed = jobs.filter((row) => String(row.status || '').toLowerCase() === 'failed').length;
  const jobsDeadlettered = jobs.filter((row) => asIso(row.deadlettered_at)).length;
  const retryCount = jobs.filter((row) => Math.max(0, Number(row.attempts || 0)) > 1).length;

  const deadletterTotal = deadletters.length;
  const deadletterRequeued = deadletters.filter((row) => String(row.recovery_status || '').toLowerCase() === 'requeued').length;
  const deadletterIgnored = deadletters.filter((row) => String(row.recovery_status || '').toLowerCase() === 'ignored').length;
  const deadletterPending = deadletters.filter((row) => String(row.recovery_status || '').toLowerCase() === 'pending').length;

  const codeMap = new Map();
  for (const row of deadletters) {
    const rawError = String(row.error || '').trim();
    const code = (rawError.match(/^[A-Z0-9_]+/)?.[0] || 'UNKNOWN');
    codeMap.set(code, Number(codeMap.get(code) || 0) + 1);
  }

  const topDeadletterCodes = [...codeMap.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const stats = {
    generatedAt: nowIso,
    windowDays: days,
    guildId,
    windowFrom: windowFromIso,
    jobsTotal,
    jobsQueued,
    jobsRunning,
    jobsCompleted,
    jobsFailed,
    jobsDeadlettered,
    retryRatePct: jobsTotal > 0 ? Number(((retryCount / jobsTotal) * 100).toFixed(2)) : 0,
    queueLagP50Sec: toSec(percentile(lagMs, 50)),
    queueLagP95Sec: toSec(percentile(lagMs, 95)),
    deadletterTotal,
    deadletterRequeued,
    deadletterIgnored,
    deadletterPending,
    topDeadletterCodes,
    sloAlert: {
      enabled: enableSloAlert,
      status: 'clear',
      severity: 'none',
      noGoCandidate: false,
      breaches: [],
      recommendedActions: [],
      thresholds: {
        queueLagP95Sec: alertQueueLagThresholdSec,
        retryRatePct: alertRetryRateThresholdPct,
        deadletterPending: alertDeadletterPendingThreshold,
        deadletterIgnored: alertDeadletterIgnoredThreshold,
      },
    },
  };

  stats.sloAlert = enableSloAlert ? buildSloAlert(stats) : stats.sloAlert;

  const markdown = buildMarkdown(stats);
  const defaultOutputPath = path.join(OUTPUT_DIR, `${nowIso.slice(0, 10)}_memory-queue-weekly.md`);
  const outputPath = outputArg ? path.resolve(ROOT, outputArg) : defaultOutputPath;

  if (sinks.includes('markdown')) {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, markdown, 'utf8');
    }
    console.log(`[MEMORY-QUEUE-WEEKLY] markdown ${dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`);
  }

  if (sinks.includes('supabase')) {
    await writeSupabaseArtifact(stats, markdown);
  }

  writeSloAlertArtifacts(stats);

  if (sinks.includes('stdout')) {
    console.log('\n[MEMORY-QUEUE-WEEKLY] report markdown\n');
    console.log(markdown);
  }

  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error('[MEMORY-QUEUE-WEEKLY] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
