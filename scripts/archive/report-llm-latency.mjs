/* eslint-disable no-console */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();

const parseArgs = () => {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2];
  }
  return out;
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

const toMs = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
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
  const avg = latencies.length > 0
    ? Number((latencies.reduce((acc, n) => acc + n, 0) / latencies.length).toFixed(2))
    : null;

  return {
    total,
    successCount,
    successRatePct: total > 0 ? Number(((successCount / total) * 100).toFixed(2)) : null,
    avgLatencyMs: avg,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
  };
};

const byAction = (rows, limit) => {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.action_name || 'unknown').trim() || 'unknown';
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([actionName, items]) => ({ actionName, ...summarize(items) }))
    .sort((a, b) => (b.p95LatencyMs || -1) - (a.p95LatencyMs || -1))
    .slice(0, limit);
};

const printSummary = (title, summary, actionRows) => {
  console.log(`\n[${title}]`);
  console.log(`total=${summary.total} success=${summary.successCount} successRatePct=${summary.successRatePct ?? 'n/a'}`);
  console.log(`avg=${summary.avgLatencyMs ?? 'n/a'}ms p50=${summary.p50LatencyMs ?? 'n/a'}ms p95=${summary.p95LatencyMs ?? 'n/a'}ms p99=${summary.p99LatencyMs ?? 'n/a'}ms`);
  if (actionRows.length === 0) {
    console.log('top-actions: none');
    return;
  }
  console.log('top-actions-by-p95:');
  for (const row of actionRows) {
    console.log(`- ${row.actionName}: p95=${row.p95LatencyMs ?? 'n/a'}ms p50=${row.p50LatencyMs ?? 'n/a'}ms total=${row.total}`);
  }
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

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required');
  }

  const args = parseArgs();
  const baselineWindowMs = toMs(args.baselineHours, 48) * 60 * 60 * 1000;
  const candidateWindowMs = toMs(args.candidateHours, 24) * 60 * 60 * 1000;

  const baselineTo = toIso(args.baselineTo, candidateWindowMs + baselineWindowMs);
  const baselineFrom = toIso(args.baselineFrom, candidateWindowMs + baselineWindowMs + 1);
  const candidateTo = toIso(args.candidateTo, 0);
  const candidateFrom = toIso(args.candidateFrom, candidateWindowMs);

  const guildId = String(args.guildId || '').trim() || null;
  const provider = String(args.provider || '').trim() || null;
  const actionPrefix = String(args.actionPrefix || '').trim() || null;
  const topActions = Math.max(1, Math.min(20, Number(args.topActions || 8) || 8));
  const limit = Math.max(100, Math.min(20000, Number(args.limit || 5000) || 5000));

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  console.log('[perf] report-llm-latency start');
  console.log(`filters guildId=${guildId || '*'} provider=${provider || '*'} actionPrefix=${actionPrefix || '*'}`);
  console.log(`baseline from=${baselineFrom} to=${baselineTo}`);
  console.log(`candidate from=${candidateFrom} to=${candidateTo}`);

  const baselineRows = await fetchWindow(client, {
    from: baselineFrom,
    to: baselineTo,
    guildId,
    provider,
    actionPrefix,
    limit,
  });
  const candidateRows = await fetchWindow(client, {
    from: candidateFrom,
    to: candidateTo,
    guildId,
    provider,
    actionPrefix,
    limit,
  });

  const baselineSummary = summarize(baselineRows);
  const candidateSummary = summarize(candidateRows);

  printSummary('baseline', baselineSummary, byAction(baselineRows, topActions));
  printSummary('candidate', candidateSummary, byAction(candidateRows, topActions));

  const deltaP95 = (candidateSummary.p95LatencyMs ?? 0) - (baselineSummary.p95LatencyMs ?? 0);
  const deltaP50 = (candidateSummary.p50LatencyMs ?? 0) - (baselineSummary.p50LatencyMs ?? 0);
  const deltaSuccessRate = (candidateSummary.successRatePct ?? 0) - (baselineSummary.successRatePct ?? 0);

  console.log('\n[delta] candidate-baseline');
  console.log(`p50=${Number(deltaP50.toFixed(2))}ms p95=${Number(deltaP95.toFixed(2))}ms successRatePct=${Number(deltaSuccessRate.toFixed(2))}`);
}

main().catch((error) => {
  console.error('[perf] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
