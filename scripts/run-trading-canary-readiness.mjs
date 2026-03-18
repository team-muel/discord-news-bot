/* eslint-disable no-console */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
const API_BASE = String(process.env.API_BASE || 'http://localhost:3001').trim();
const CANARY_GUILD_ID = String(process.env.CANARY_GUILD_ID || '').trim();
const ROLLBACK_DEADLINE_MS = 10 * 60 * 1000;

const fail = (message) => {
  console.error(`[CANARY] FAIL ${message}`);
  process.exit(1);
};

if (!SUPABASE_URL || !SUPABASE_KEY) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required');
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const resolveCanaryGuild = async () => {
  if (CANARY_GUILD_ID) {
    return { guildId: CANARY_GUILD_ID, reason: 'env_override' };
  }

  const { data, error } = await db
    .from('sources')
    .select('guild_id,is_active')
    .eq('is_active', true)
    .not('guild_id', 'is', null)
    .limit(5000);

  if (error) {
    throw new Error(`sources query failed: ${error.message}`);
  }

  const counts = new Map();
  for (const row of data || []) {
    const guildId = String(row.guild_id || '').trim();
    if (!guildId) continue;
    counts.set(guildId, Number(counts.get(guildId) || 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    throw new Error('no active guild found in sources');
  }

  return { guildId: ranked[0][0], reason: 'top_active_sources', activeSources: ranked[0][1] };
};

const getCanaryBaseline = async (guildId) => {
  const now = Date.now();
  const fromIso = new Date(now - (24 * 60 * 60 * 1000)).toISOString();

  const [{ data: sourceRows, error: sourceErr }, { data: llmRows, error: llmErr }, { data: jobRows, error: jobErr }] = await Promise.all([
    db.from('sources').select('guild_id,is_active').eq('guild_id', guildId).eq('is_active', true).limit(2000),
    db
      .from('agent_llm_call_logs')
      .select('latency_ms,success,created_at')
      .eq('guild_id', guildId)
      .gte('created_at', fromIso)
      .limit(10000),
    db
      .from('memory_jobs')
      .select('status,created_at,guild_id')
      .eq('guild_id', guildId)
      .gte('created_at', fromIso)
      .limit(10000),
  ]);

  if (sourceErr) throw new Error(`sources baseline query failed: ${sourceErr.message}`);
  if (llmErr) throw new Error(`llm baseline query failed: ${llmErr.message}`);
  if (jobErr) throw new Error(`memory_jobs baseline query failed: ${jobErr.message}`);

  const latencies = (llmRows || [])
    .map((row) => Number(row.latency_ms || 0))
    .filter((v) => Number.isFinite(v) && v >= 0);

  const llmTotal = (llmRows || []).length;
  const llmSuccess = (llmRows || []).filter((row) => row.success === true).length;
  const memoryTotal = (jobRows || []).length;
  const memoryFailed = (jobRows || []).filter((row) => String(row.status || '').toLowerCase() === 'failed').length;

  return {
    windowHours: 24,
    activeSourceCount: (sourceRows || []).length,
    llmTotal,
    llmSuccess,
    llmSuccessRatePct: llmTotal > 0 ? Number(((llmSuccess / llmTotal) * 100).toFixed(2)) : 0,
    llmLatencyP95Ms: percentile(latencies, 95),
    memoryJobsTotal: memoryTotal,
    memoryJobsFailed: memoryFailed,
    memoryJobFailureRate: memoryTotal > 0 ? Number((memoryFailed / memoryTotal).toFixed(4)) : 0,
  };
};

const decideGoNoGo = (baseline) => {
  const checks = [
    {
      id: 'active-sources',
      ok: baseline.activeSourceCount >= 1,
      detail: `activeSourceCount=${baseline.activeSourceCount}`,
    },
    {
      id: 'llm-sample-volume',
      ok: baseline.llmTotal >= 10,
      detail: `llmTotal=${baseline.llmTotal}`,
    },
    {
      id: 'llm-p95-latency',
      ok: baseline.llmLatencyP95Ms > 0 && baseline.llmLatencyP95Ms <= 2000,
      detail: `llmLatencyP95Ms=${baseline.llmLatencyP95Ms}`,
    },
    {
      id: 'memory-job-failure-rate',
      ok: baseline.memoryJobFailureRate <= 0.10,
      detail: `memoryJobFailureRate=${baseline.memoryJobFailureRate}`,
    },
  ];

  const failed = checks.filter((item) => !item.ok);
  return {
    decision: failed.length === 0 ? 'go' : 'no-go',
    checks,
    failedChecks: failed.map((item) => item.id),
  };
};

const runRollbackRehearsal = () => {
  const startedAt = Date.now();
  const output = execFileSync('node', ['scripts/rehearse-stage-rollback.mjs'], {
    env: {
      ...process.env,
      API_BASE,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const jsonStart = output.indexOf('{');
  const payload = JSON.parse(jsonStart >= 0 ? output.slice(jsonStart) : output);

  return {
    elapsedMs,
    withinDeadline: elapsedMs <= ROLLBACK_DEADLINE_MS,
    payload,
  };
};

async function main() {
  const canary = await resolveCanaryGuild();
  const baseline = await getCanaryBaseline(canary.guildId);
  const canaryDecision = decideGoNoGo(baseline);
  const rollback = runRollbackRehearsal();

  const summary = {
    timestamp: new Date().toISOString(),
    apiBase: API_BASE,
    canary,
    baseline,
    canaryDecision,
    rollbackRehearsal: rollback,
    w4Status: {
      w4_04_canary_selected_and_baseline_measured: true,
      w4_05_24h_observation_and_decision: true,
      w4_06_rollback_within_10m: rollback.withinDeadline,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!rollback.withinDeadline) {
    process.exit(2);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
