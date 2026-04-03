/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { parseArg, parseBool, parseSinks } from './lib/cliArgs.mjs';
import { SUPABASE_URL, SUPABASE_KEY, createScriptClient, isMissingRelationError } from './lib/supabaseClient.mjs';

const OBSIDIAN_VAULT_PATH = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'llm-latency');
const VALID_SINKS = new Set(['supabase', 'obsidian', 'markdown', 'stdout']);

const localParseSinks = (raw) => parseSinks(raw, [...VALID_SINKS], ['supabase', 'obsidian']);

const toMsWindow = (hours, fallbackHours) => {
  const parsed = Number(hours);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackHours * 60 * 60 * 1000;
  }
  return Math.trunc(parsed * 60 * 60 * 1000);
};

const toIso = (raw, fallbackMs) => {
  const text = String(raw || '').trim();
  if (!text) {
    return new Date(Date.now() - fallbackMs).toISOString();
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid datetime: ${text}`);
  }
  return new Date(ms).toISOString();
};

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const summarize = (rows) => {
  const latencies = rows
    .map((row) => Number(row.latency_ms || 0))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const successCount = rows.filter((row) => row.success === true).length;
  const total = rows.length;

  const average = latencies.length > 0
    ? Number((latencies.reduce((acc, n) => acc + n, 0) / latencies.length).toFixed(2))
    : null;

  return {
    total,
    successCount,
    successRatePct: total > 0 ? Number(((successCount / total) * 100).toFixed(2)) : null,
    avgLatencyMs: average,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
  };
};

const summarizeByAction = (rows, topActions) => {
  const grouped = new Map();
  for (const row of rows) {
    const actionName = String(row.action_name || 'unknown').trim() || 'unknown';
    const list = grouped.get(actionName) || [];
    list.push(row);
    grouped.set(actionName, list);
  }

  return [...grouped.entries()]
    .map(([actionName, items]) => ({ actionName, ...summarize(items) }))
    .sort((a, b) => (b.p95LatencyMs || -1) - (a.p95LatencyMs || -1))
    .slice(0, topActions);
};

const formatMetric = (value) => (value === null || value === undefined ? 'n/a' : String(value));

const toSlug = (value, fallback) => {
  const text = String(value || '').trim().toLowerCase();
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
};

const formatActionRows = (rows) => {
  if (rows.length === 0) {
    return '| - | - | - | - | - |';
  }
  return rows
    .map((row) => `| ${row.actionName.replace(/\|/g, '/')} | ${formatMetric(row.total)} | ${formatMetric(row.p50LatencyMs)} | ${formatMetric(row.p95LatencyMs)} | ${formatMetric(row.successRatePct)} |`)
    .join('\n');
};

async function fetchWindow(client, params) {
  const query = client
    .from('agent_llm_call_logs')
    .select('created_at,latency_ms,success,action_name,provider,model')
    .gte('created_at', params.from)
    .lt('created_at', params.to)
    .order('created_at', { ascending: true })
    .limit(params.limit);

  if (params.guildId) {
    query.eq('guild_id', params.guildId);
  }
  if (params.provider) {
    query.eq('provider', params.provider);
  }
  if (params.actionPrefix) {
    query.ilike('action_name', `${params.actionPrefix}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }
  return data || [];
}

const buildReport = (params) => {
  const deltaP50 = (params.candidateSummary.p50LatencyMs ?? 0) - (params.baselineSummary.p50LatencyMs ?? 0);
  const deltaP95 = (params.candidateSummary.p95LatencyMs ?? 0) - (params.baselineSummary.p95LatencyMs ?? 0);
  const deltaSuccess = (params.candidateSummary.successRatePct ?? 0) - (params.baselineSummary.successRatePct ?? 0);

  return `# LLM Latency Weekly Summary\n\n- generated_at: ${new Date().toISOString()}\n- guild_id: ${params.guildId || '*'}\n- provider: ${params.provider || '*'}\n- action_prefix: ${params.actionPrefix || '*'}\n- baseline_window: ${params.baselineFrom} .. ${params.baselineTo}\n- candidate_window: ${params.candidateFrom} .. ${params.candidateTo}\n- baseline_samples: ${params.baselineSummary.total}\n- candidate_samples: ${params.candidateSummary.total}\n\n## Delta (candidate - baseline)\n\n- p50_latency_ms: ${Number(deltaP50.toFixed(2))}\n- p95_latency_ms: ${Number(deltaP95.toFixed(2))}\n- success_rate_pct: ${Number(deltaSuccess.toFixed(2))}\n\n## Baseline\n\n- total: ${params.baselineSummary.total}\n- success_rate_pct: ${formatMetric(params.baselineSummary.successRatePct)}\n- avg_latency_ms: ${formatMetric(params.baselineSummary.avgLatencyMs)}\n- p50_latency_ms: ${formatMetric(params.baselineSummary.p50LatencyMs)}\n- p95_latency_ms: ${formatMetric(params.baselineSummary.p95LatencyMs)}\n- p99_latency_ms: ${formatMetric(params.baselineSummary.p99LatencyMs)}\n\n| Action | Total | P50 (ms) | P95 (ms) | Success Rate (%) |\n| --- | ---: | ---: | ---: | ---: |\n${formatActionRows(params.baselineActions)}\n\n## Candidate\n\n- total: ${params.candidateSummary.total}\n- success_rate_pct: ${formatMetric(params.candidateSummary.successRatePct)}\n- avg_latency_ms: ${formatMetric(params.candidateSummary.avgLatencyMs)}\n- p50_latency_ms: ${formatMetric(params.candidateSummary.p50LatencyMs)}\n- p95_latency_ms: ${formatMetric(params.candidateSummary.p95LatencyMs)}\n- p99_latency_ms: ${formatMetric(params.candidateSummary.p99LatencyMs)}\n\n| Action | Total | P50 (ms) | P95 (ms) | Success Rate (%) |\n| --- | ---: | ---: | ---: | ---: |\n${formatActionRows(params.candidateActions)}\n`;
};

const buildReportKey = (params) => {
  const guild = params.guildId || '*';
  const provider = params.provider || '*';
  const actionPrefix = params.actionPrefix || '*';
  return [
    'llm_latency_weekly',
    guild,
    provider,
    actionPrefix,
    params.baselineFrom,
    params.baselineTo,
    params.candidateFrom,
    params.candidateTo,
  ].join('|');
};

const writeMarkdownArtifact = (params) => {
  const outputArg = String(parseArg('output', '')).trim();
  const filename = `${new Date().toISOString().slice(0, 10)}_llm-latency-weekly.md`;
  const outputPath = outputArg
    ? path.resolve(ROOT, outputArg)
    : path.join(OUTPUT_DIR, filename);

  if (!params.dryRun) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, params.markdown, 'utf8');
  }
  console.log(`[LLM-LATENCY] markdown ${params.dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`);
};

const writeObsidianArtifact = (params) => {
  if (!OBSIDIAN_VAULT_PATH) {
    console.log('[LLM-LATENCY] obsidian skipped: vault path not configured (OBSIDIAN_SYNC_VAULT_PATH|OBSIDIAN_VAULT_PATH)');
    return;
  }

  const day = new Date().toISOString().slice(0, 10);
  const scopeGuild = String(params.guildId || '').trim();
  const providerSlug = toSlug(params.provider || 'all', 'all');
  const prefixSlug = toSlug(params.actionPrefix || 'all', 'all');

  const relative = /^\d{6,30}$/.test(scopeGuild)
    ? path.join('guilds', scopeGuild, 'ops', 'reports', `llm-latency-weekly_${day}_${providerSlug}_${prefixSlug}.md`)
    : path.join('ops', 'reports', 'global', `llm-latency-weekly_${day}_${providerSlug}_${prefixSlug}.md`);

  const absolute = path.resolve(OBSIDIAN_VAULT_PATH, relative);
  if (!params.dryRun) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, params.markdown, 'utf8');
  }

  console.log(`[LLM-LATENCY] obsidian ${params.dryRun ? 'previewed' : 'written'}: ${relative.replace(/\\/g, '/')}`);
};

const writeSupabaseArtifact = async (client, params) => {
  const reportKey = buildReportKey(params);
  const delta = {
    p50_latency_ms: Number((((params.candidateSummary.p50LatencyMs ?? 0) - (params.baselineSummary.p50LatencyMs ?? 0))).toFixed(2)),
    p95_latency_ms: Number((((params.candidateSummary.p95LatencyMs ?? 0) - (params.baselineSummary.p95LatencyMs ?? 0))).toFixed(2)),
    success_rate_pct: Number((((params.candidateSummary.successRatePct ?? 0) - (params.baselineSummary.successRatePct ?? 0))).toFixed(2)),
  };

  const payload = {
    report_key: reportKey,
    report_kind: 'llm_latency_weekly',
    guild_id: params.guildId,
    provider: params.provider,
    action_prefix: params.actionPrefix,
    baseline_from: params.baselineFrom,
    baseline_to: params.baselineTo,
    candidate_from: params.candidateFrom,
    candidate_to: params.candidateTo,
    baseline_summary: params.baselineSummary,
    candidate_summary: params.candidateSummary,
    delta_summary: delta,
    top_actions: {
      baseline: params.baselineActions,
      candidate: params.candidateActions,
    },
    markdown: params.markdown,
  };

  if (params.dryRun) {
    console.log('[LLM-LATENCY] supabase previewed: public.agent_weekly_reports (upsert report_key)');
    return;
  }

  const { error } = await client
    .from('agent_weekly_reports')
    .upsert(payload, { onConflict: 'report_key' });

  if (error) {
    if (isMissingRelationError(error, 'agent_weekly_reports') && params.allowMissingSupabaseTable) {
      console.log('[LLM-LATENCY] supabase skipped: table public.agent_weekly_reports not found (apply migration first)');
      return;
    }
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log('[LLM-LATENCY] supabase upserted: public.agent_weekly_reports');
};

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required');
  }

  const dryRun = parseBool(parseArg('dryRun', 'false'));
  const sinks = localParseSinks(parseArg('sinks', process.env.LLM_WEEKLY_REPORT_SINKS || 'supabase,obsidian'));
  const allowMissingSupabaseTable = parseBool(parseArg('allowMissingSupabaseTable', process.env.LLM_WEEKLY_REPORT_ALLOW_MISSING_TABLE || 'true'), true);
  const allowMissingSourceTable = parseBool(
    parseArg('allowMissingSourceTable', process.env.LLM_WEEKLY_REPORT_ALLOW_MISSING_SOURCE_TABLE || 'false'),
    false,
  );
  const guildId = String(parseArg('guildId', '')).trim() || null;
  const provider = String(parseArg('provider', '')).trim() || null;
  const actionPrefix = String(parseArg('actionPrefix', '')).trim() || null;
  const topActions = Math.max(1, Math.min(20, Number(parseArg('topActions', '8')) || 8));
  const limit = Math.max(100, Math.min(20000, Number(parseArg('limit', '5000')) || 5000));

  const baselineWindowMs = toMsWindow(parseArg('baselineHours', '168'), 168);
  const candidateWindowMs = toMsWindow(parseArg('candidateHours', '72'), 72);

  const baselineTo = toIso(parseArg('baselineTo', ''), candidateWindowMs + baselineWindowMs);
  const baselineFrom = toIso(parseArg('baselineFrom', ''), candidateWindowMs + baselineWindowMs + 1);
  const candidateTo = toIso(parseArg('candidateTo', ''), 0);
  const candidateFrom = toIso(parseArg('candidateFrom', ''), candidateWindowMs);

  const client = createScriptClient();

  let baselineRows;
  let candidateRows;
  try {
    baselineRows = await fetchWindow(client, {
      from: baselineFrom,
      to: baselineTo,
      guildId,
      provider,
      actionPrefix,
      limit,
    });

    candidateRows = await fetchWindow(client, {
      from: candidateFrom,
      to: candidateTo,
      guildId,
      provider,
      actionPrefix,
      limit,
    });
  } catch (error) {
    if (allowMissingSourceTable && isMissingRelationError(error, 'agent_llm_call_logs')) {
      console.log('[LLM-LATENCY] skipped: table public.agent_llm_call_logs not found (apply migration first)');
      return;
    }
    throw error;
  }

  const baselineSummary = summarize(baselineRows);
  const candidateSummary = summarize(candidateRows);
  const baselineActions = summarizeByAction(baselineRows, topActions);
  const candidateActions = summarizeByAction(candidateRows, topActions);

  const markdown = buildReport({
    guildId,
    provider,
    actionPrefix,
    baselineFrom,
    baselineTo,
    candidateFrom,
    candidateTo,
    baselineSummary,
    candidateSummary,
    baselineActions,
    candidateActions,
  });

  const context = {
    dryRun,
    sinks,
    allowMissingSupabaseTable,
    guildId,
    provider,
    actionPrefix,
    baselineFrom,
    baselineTo,
    candidateFrom,
    candidateTo,
    baselineSummary,
    candidateSummary,
    baselineActions,
    candidateActions,
    markdown,
  };

  console.log(`[LLM-LATENCY] sinks=${sinks.join(',')} dryRun=${dryRun}`);

  if (sinks.includes('supabase')) {
    await writeSupabaseArtifact(client, context);
  }

  if (sinks.includes('obsidian')) {
    writeObsidianArtifact(context);
  }

  if (sinks.includes('markdown')) {
    writeMarkdownArtifact(context);
  }

  if (sinks.includes('stdout')) {
    console.log('\n[LLM-LATENCY] report markdown\n');
    console.log(markdown);
  }
}

main().catch((error) => {
  console.error('[LLM-LATENCY] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
