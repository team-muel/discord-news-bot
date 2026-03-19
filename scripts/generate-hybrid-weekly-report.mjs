/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'hybrid-weekly');
const VALID_SINKS = new Set(['supabase', 'markdown', 'stdout']);

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();

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

  const sinks = tokens.length > 0 ? tokens : ['supabase', 'markdown'];
  const deduped = [...new Set(sinks)].filter((sink) => VALID_SINKS.has(sink));
  return deduped.length > 0 ? deduped : ['supabase'];
};

const toMsWindow = (days, fallbackDays) => {
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackDays * 24 * 60 * 60 * 1000;
  }
  return Math.trunc(parsed * 24 * 60 * 60 * 1000);
};

const asNumber = (value, fallback = null) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const asDateMs = (value) => {
  const ms = Date.parse(String(value || '').trim());
  return Number.isFinite(ms) ? ms : 0;
};

const fetchLatestByKind = async (client, params) => {
  const fromIso = new Date(Date.now() - params.windowMs).toISOString();
  const query = client
    .from('agent_weekly_reports')
    .select('report_key,report_kind,guild_id,provider,action_prefix,baseline_from,baseline_to,candidate_from,candidate_to,baseline_summary,candidate_summary,delta_summary,top_actions,markdown,created_at,updated_at')
    .in('report_kind', ['go_no_go_weekly', 'llm_latency_weekly', 'rollback_rehearsal_weekly', 'memory_queue_weekly'])
    .gte('created_at', fromIso)
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (params.guildId) {
    query.eq('guild_id', params.guildId);
  }
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
    goNoGo: rows.find((row) => row.report_kind === 'go_no_go_weekly') || null,
    llmLatency: rows.find((row) => row.report_kind === 'llm_latency_weekly') || null,
    rollbackWeekly: rows.find((row) => row.report_kind === 'rollback_rehearsal_weekly') || null,
    memoryQueueWeekly: rows.find((row) => row.report_kind === 'memory_queue_weekly') || null,
  };
};

const computeOverall = (goSummary, llmDelta, rollbackSummary, memorySummary) => {
  const noGo = asNumber(goSummary?.no_go, 0) || 0;
  if (noGo > 0) {
    return 'review_required';
  }

  const rollbackFail = asNumber(rollbackSummary?.fail, 0) || 0;
  if (rollbackFail > 0) {
    return 'review_required';
  }

  const deadletterPending = asNumber(memorySummary?.deadletter_pending, 0) || 0;
  const deadletterIgnored = asNumber(memorySummary?.deadletter_ignored, 0) || 0;
  if (deadletterPending > 0 || deadletterIgnored > 0) {
    return 'review_required';
  }

  const p95Delta = asNumber(llmDelta?.p95_latency_ms, 0) || 0;
  const successDelta = asNumber(llmDelta?.success_rate_pct, 0) || 0;
  const memoryQueueLagP95 = asNumber(memorySummary?.queue_lag_p95_sec, 0) || 0;
  const memoryRetryRate = asNumber(memorySummary?.retry_rate_pct, 0) || 0;
  if (p95Delta > 50 || successDelta < -3 || memoryQueueLagP95 > 120 || memoryRetryRate > 40) {
    return 'watch';
  }
  return 'go';
};

const buildMarkdown = (params) => {
  const goSummary = params.goNoGo?.baseline_summary || {};
  const llmDelta = params.llmLatency?.delta_summary || {};
  const llmBaseline = params.llmLatency?.baseline_summary || {};
  const llmCandidate = params.llmLatency?.candidate_summary || {};
  const rollbackSummary = params.rollbackWeekly?.baseline_summary || {};
  const memorySummary = params.memoryQueueWeekly?.baseline_summary || {};

  return `# Hybrid Weekly Decision Snapshot\n\n- generated_at: ${params.generatedAt}\n- window_days: ${params.windowDays}\n- guild_id: ${params.guildId || '*'}\n- provider: ${params.provider || '*'}\n- action_prefix: ${params.actionPrefix || '*'}\n- overall_status: ${params.overallStatus}\n\n## Go/No-Go Summary\n\n- total_runs: ${asNumber(goSummary.total_runs, 0) ?? 0}\n- go: ${asNumber(goSummary.go, 0) ?? 0}\n- no_go: ${asNumber(goSummary.no_go, 0) ?? 0}\n- pending: ${asNumber(goSummary.pending, 0) ?? 0}\n\n## LLM Latency Summary\n\n- baseline_total: ${asNumber(llmBaseline.total, 0) ?? 0}\n- candidate_total: ${asNumber(llmCandidate.total, 0) ?? 0}\n- p95_delta_ms: ${asNumber(llmDelta.p95_latency_ms, 0) ?? 0}\n- p50_delta_ms: ${asNumber(llmDelta.p50_latency_ms, 0) ?? 0}\n- success_rate_delta_pct: ${asNumber(llmDelta.success_rate_pct, 0) ?? 0}\n\n## Rollback Rehearsal Summary\n\n- total_runs: ${asNumber(rollbackSummary.total_runs, 0) ?? 0}\n- pass: ${asNumber(rollbackSummary.pass, 0) ?? 0}\n- fail: ${asNumber(rollbackSummary.fail, 0) ?? 0}\n- p95_elapsed_ms: ${asNumber(rollbackSummary.p95_elapsed_ms, 0) ?? 0}\n\n## Memory Queue Summary\n\n- jobs_total: ${asNumber(memorySummary.jobs_total, 0) ?? 0}\n- retry_rate_pct: ${asNumber(memorySummary.retry_rate_pct, 0) ?? 0}\n- queue_lag_p95_sec: ${asNumber(memorySummary.queue_lag_p95_sec, 0) ?? 0}\n- deadletter_pending: ${asNumber(memorySummary.deadletter_pending, 0) ?? 0}\n- deadletter_ignored: ${asNumber(memorySummary.deadletter_ignored, 0) ?? 0}\n\n## Inputs\n\n- go_no_go_report_key: ${params.goNoGo?.report_key || 'missing'}\n- llm_latency_report_key: ${params.llmLatency?.report_key || 'missing'}\n- rollback_rehearsal_report_key: ${params.rollbackWeekly?.report_key || 'missing'}\n- memory_queue_report_key: ${params.memoryQueueWeekly?.report_key || 'missing'}\n`;
};

const buildReportKey = (params) => {
  const day = params.generatedAt.slice(0, 10);
  return [
    'hybrid_weekly',
    day,
    `days:${params.windowDays}`,
    `guild:${params.guildId || '*'}`,
    `provider:${params.provider || '*'}`,
    `prefix:${params.actionPrefix || '*'}`,
  ].join('|');
};

const buildPayload = (params) => {
  const goSummary = params.goNoGo?.baseline_summary || {};
  const llmDelta = params.llmLatency?.delta_summary || {};
  const rollbackSummary = params.rollbackWeekly?.baseline_summary || {};
  const memorySummary = params.memoryQueueWeekly?.baseline_summary || {};
  return {
    report_key: buildReportKey(params),
    report_kind: 'hybrid_weekly',
    guild_id: params.guildId,
    provider: params.provider,
    action_prefix: params.actionPrefix,
    baseline_from: params.windowFrom,
    baseline_to: params.generatedAt,
    candidate_from: null,
    candidate_to: null,
    baseline_summary: {
      overall_status: params.overallStatus,
      go_no_go: {
        total_runs: asNumber(goSummary.total_runs, 0) ?? 0,
        go: asNumber(goSummary.go, 0) ?? 0,
        no_go: asNumber(goSummary.no_go, 0) ?? 0,
        pending: asNumber(goSummary.pending, 0) ?? 0,
      },
      llm_delta: {
        p50_latency_ms: asNumber(llmDelta.p50_latency_ms, 0) ?? 0,
        p95_latency_ms: asNumber(llmDelta.p95_latency_ms, 0) ?? 0,
        success_rate_pct: asNumber(llmDelta.success_rate_pct, 0) ?? 0,
      },
      rollback_rehearsal: {
        total_runs: asNumber(rollbackSummary.total_runs, 0) ?? 0,
        pass: asNumber(rollbackSummary.pass, 0) ?? 0,
        fail: asNumber(rollbackSummary.fail, 0) ?? 0,
        p95_elapsed_ms: asNumber(rollbackSummary.p95_elapsed_ms, 0) ?? 0,
      },
      memory_queue: {
        jobs_total: asNumber(memorySummary.jobs_total, 0) ?? 0,
        retry_rate_pct: asNumber(memorySummary.retry_rate_pct, 0) ?? 0,
        queue_lag_p95_sec: asNumber(memorySummary.queue_lag_p95_sec, 0) ?? 0,
        deadletter_pending: asNumber(memorySummary.deadletter_pending, 0) ?? 0,
        deadletter_ignored: asNumber(memorySummary.deadletter_ignored, 0) ?? 0,
      },
    },
    candidate_summary: {},
    delta_summary: {},
    top_actions: {
      source_reports: {
        go_no_go_weekly: params.goNoGo?.report_key || null,
        llm_latency_weekly: params.llmLatency?.report_key || null,
        rollback_rehearsal_weekly: params.rollbackWeekly?.report_key || null,
        memory_queue_weekly: params.memoryQueueWeekly?.report_key || null,
      },
      llm_top_actions: params.llmLatency?.top_actions || {},
      memory_queue_top_actions: params.memoryQueueWeekly?.top_actions || {},
    },
    markdown: params.markdown,
  };
};

const writeMarkdownArtifact = (params) => {
  const outputArg = String(parseArg('output', '')).trim();
  const filename = `${params.generatedAt.slice(0, 10)}_hybrid-weekly.md`;
  const outputPath = outputArg
    ? path.resolve(ROOT, outputArg)
    : path.join(OUTPUT_DIR, filename);

  if (!params.dryRun) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, params.markdown, 'utf8');
  }

  console.log(`[HYBRID-WEEKLY] markdown ${params.dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`);
};

const writeSupabaseArtifact = async (client, params) => {
  if (params.dryRun) {
    console.log('[HYBRID-WEEKLY] supabase previewed: public.agent_weekly_reports (upsert report_key)');
    return;
  }

  const payload = buildPayload(params);
  const { error } = await client
    .from('agent_weekly_reports')
    .upsert(payload, { onConflict: 'report_key' });

  if (error) {
    const relationMissing = String(error.code || '').toUpperCase() === '42P01' || /agent_weekly_reports/i.test(String(error.message || ''));
    if (relationMissing && params.allowMissingSupabaseTable) {
      console.log('[HYBRID-WEEKLY] supabase skipped: table public.agent_weekly_reports not found (apply migration first)');
      return;
    }
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log('[HYBRID-WEEKLY] supabase upserted: public.agent_weekly_reports');
};

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required');
  }

  const dryRun = parseBool(parseArg('dryRun', 'false'));
  const sinks = parseSinks(parseArg('sinks', process.env.HYBRID_WEEKLY_REPORT_SINKS || 'supabase,markdown'));
  const allowMissingSupabaseTable = parseBool(
    parseArg('allowMissingSupabaseTable', process.env.HYBRID_WEEKLY_REPORT_ALLOW_MISSING_TABLE || 'true'),
    true,
  );
  const guildId = String(parseArg('guildId', '')).trim() || null;
  const provider = String(parseArg('provider', '')).trim() || null;
  const actionPrefix = String(parseArg('actionPrefix', '')).trim() || null;
  const windowDays = Math.max(1, Number(parseArg('days', '7')) || 7);
  const windowMs = toMsWindow(windowDays, 7);
  const limit = Math.max(20, Math.min(500, Number(parseArg('limit', '120')) || 120));

  const generatedAt = new Date().toISOString();
  const windowFrom = new Date(Date.now() - windowMs).toISOString();
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const { goNoGo, llmLatency, rollbackWeekly, memoryQueueWeekly } = await fetchLatestByKind(client, {
    windowMs,
    guildId,
    provider,
    actionPrefix,
    limit,
  });

  if (!goNoGo || !llmLatency) {
    throw new Error('Missing source snapshots: go_no_go_weekly and llm_latency_weekly must both exist within window');
  }

  const overallStatus = computeOverall(
    goNoGo.baseline_summary || {},
    llmLatency.delta_summary || {},
    rollbackWeekly?.baseline_summary || {},
    memoryQueueWeekly?.baseline_summary || {},
  );
  const markdown = buildMarkdown({
    generatedAt,
    windowDays,
    guildId,
    provider,
    actionPrefix,
    overallStatus,
    goNoGo,
    llmLatency,
    rollbackWeekly,
    memoryQueueWeekly,
  });

  const context = {
    dryRun,
    sinks,
    allowMissingSupabaseTable,
    generatedAt,
    windowFrom,
    windowDays,
    guildId,
    provider,
    actionPrefix,
    overallStatus,
    goNoGo,
    llmLatency,
    rollbackWeekly,
    memoryQueueWeekly,
    markdown,
  };

  console.log(`[HYBRID-WEEKLY] sinks=${sinks.join(',')} dryRun=${dryRun} overall=${overallStatus}`);

  if (sinks.includes('supabase')) {
    await writeSupabaseArtifact(client, context);
  }
  if (sinks.includes('markdown')) {
    writeMarkdownArtifact(context);
  }
  if (sinks.includes('stdout')) {
    console.log('\n[HYBRID-WEEKLY] report markdown\n');
    console.log(markdown);
  }
}

main().catch((error) => {
  console.error('[HYBRID-WEEKLY] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
