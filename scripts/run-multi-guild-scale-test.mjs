/* eslint-disable no-console */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
const MULTI_GUILD_IDS = String(process.env.MULTI_GUILD_TEST_IDS || '').trim();

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const parseBool = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const dryRun = parseBool(parseArg('dryRun', 'false'));
const minGuilds = Math.max(1, Number(parseArg('minGuilds', '3')) || 3);
const windowHours = Math.max(1, Number(parseArg('windowHours', '24')) || 24);

const now = new Date();
const day = now.toISOString().slice(0, 10);
const fromIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

/**
 * Resolve guild IDs: from --guildIds CLI arg, env MULTI_GUILD_TEST_IDS, or auto-discover top N active guilds.
 */
const resolveGuilds = async (db) => {
  const cliGuilds = String(parseArg('guildIds', '')).trim();
  if (cliGuilds) {
    const ids = cliGuilds.split(',').map((s) => s.trim()).filter(Boolean);
    return { guildIds: ids, source: 'cli_arg' };
  }

  if (MULTI_GUILD_IDS) {
    const ids = MULTI_GUILD_IDS.split(',').map((s) => s.trim()).filter(Boolean);
    return { guildIds: ids, source: 'env_MULTI_GUILD_TEST_IDS' };
  }

  // Auto-discover: find top N guilds by active source count
  const { data, error } = await db
    .from('sources')
    .select('guild_id,is_active')
    .eq('is_active', true)
    .not('guild_id', 'is', null)
    .limit(10000);

  if (error) throw new Error(`sources query failed: ${error.message}`);

  const counts = new Map();
  for (const row of data || []) {
    const guildId = String(row.guild_id || '').trim();
    if (!guildId) counts.set(guildId, (counts.get(guildId) || 0) + 1);
    if (guildId) counts.set(guildId, (counts.get(guildId) || 0) + 1);
  }

  const ranked = [...counts.entries()]
    .filter(([id]) => id)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(minGuilds, 5));

  return { guildIds: ranked.map(([id]) => id), source: 'auto_discover' };
};

/**
 * Collect per-guild baseline metrics over the configured window.
 */
const collectGuildBaseline = async (db, guildId) => {
  const [{ data: llmRows, error: llmErr }, { data: jobRows, error: jobErr }] = await Promise.all([
    db
      .from('agent_llm_call_logs')
      .select('latency_ms,success')
      .eq('guild_id', guildId)
      .gte('created_at', fromIso)
      .limit(10000),
    db
      .from('memory_jobs')
      .select('status')
      .eq('guild_id', guildId)
      .gte('created_at', fromIso)
      .limit(10000),
  ]);

  if (llmErr) return { guildId, error: `llm query: ${llmErr.message}` };
  if (jobErr) return { guildId, error: `memory_jobs query: ${jobErr.message}` };

  const latencies = (llmRows || [])
    .map((r) => Number(r.latency_ms || 0))
    .filter((v) => Number.isFinite(v) && v >= 0);

  const llmTotal = (llmRows || []).length;
  const llmSuccess = (llmRows || []).filter((r) => r.success === true).length;
  const memTotal = (jobRows || []).length;
  const memFailed = (jobRows || []).filter((r) => String(r.status || '').toLowerCase() === 'failed').length;

  return {
    guildId,
    llmTotal,
    llmSuccessRate: llmTotal > 0 ? Number(((llmSuccess / llmTotal) * 100).toFixed(2)) : 0,
    llmLatencyP95Ms: percentile(latencies, 95),
    memoryJobsTotal: memTotal,
    memoryJobFailRate: memTotal > 0 ? Number(((memFailed / memTotal) * 100).toFixed(2)) : 0,
    error: null,
  };
};

const evaluateGuild = (baseline) => {
  if (baseline.error) return { status: 'error', checks: [], failedChecks: [baseline.error] };

  const checks = [
    { id: 'llm_sample_volume', ok: baseline.llmTotal >= 5, detail: `llmTotal=${baseline.llmTotal}` },
    { id: 'llm_success_rate', ok: baseline.llmSuccessRate >= 90, detail: `${baseline.llmSuccessRate}%` },
    { id: 'llm_p95_latency', ok: baseline.llmLatencyP95Ms <= 3000, detail: `${baseline.llmLatencyP95Ms}ms` },
    { id: 'memory_fail_rate', ok: baseline.memoryJobFailRate <= 15, detail: `${baseline.memoryJobFailRate}%` },
  ];

  const failed = checks.filter((c) => !c.ok);
  return { status: failed.length === 0 ? 'pass' : 'fail', checks, failedChecks: failed.map((c) => c.id) };
};

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[MULTI-GUILD] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { guildIds, source } = await resolveGuilds(db);
  console.log(`[MULTI-GUILD] resolved ${guildIds.length} guilds via ${source}`);

  if (guildIds.length < minGuilds) {
    console.error(`[MULTI-GUILD] need at least ${minGuilds} guilds, found ${guildIds.length}`);
    process.exit(1);
  }

  const results = [];
  for (const guildId of guildIds) {
    const baseline = await collectGuildBaseline(db, guildId);
    const evaluation = evaluateGuild(baseline);
    results.push({ ...baseline, ...evaluation });
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const errored = results.filter((r) => r.status === 'error').length;
  const verdict = failed === 0 && errored === 0 ? 'SCALE_OK' : 'SCALE_ISSUE';

  const md = `# Multi-Guild Scale Test Results

- generated_at: ${now.toISOString()}
- window_hours: ${windowHours}
- guilds_tested: ${guildIds.length}
- guild_source: ${source}
- passed: ${passed}
- failed: ${failed}
- errored: ${errored}
- verdict: ${verdict}

## Per-Guild Results

| Guild ID | Status | LLM Total | LLM Success% | LLM P95ms | Mem Fail% | Issues |
|----------|--------|-----------|---------------|-----------|-----------|--------|
${results.map((r) =>
    `| ${r.guildId?.slice(0, 12) ?? '?'}… | ${r.status} | ${r.llmTotal ?? '-'} | ${r.llmSuccessRate ?? '-'} | ${r.llmLatencyP95Ms ?? '-'} | ${r.memoryJobFailRate ?? '-'} | ${(r.failedChecks || []).join(', ') || 'none'} |`
  ).join('\n')}

## Verdict

${verdict === 'SCALE_OK'
    ? `모든 ${guildIds.length}개 길드가 기준을 충족. 멀티길드 스케일 테스트 통과.`
    : `${failed + errored}개 길드에서 문제 발견. 개별 문제 해결 후 재실행 필요.`}
`;

  const json = {
    generated_at: now.toISOString(),
    window_hours: windowHours,
    guilds_tested: guildIds.length,
    guild_source: source,
    passed,
    failed,
    errored,
    verdict,
    results,
  };

  if (dryRun) {
    console.log('[MULTI-GUILD] dry-run=true');
    console.log(md);
  } else {
    const mdPath = path.join(OUTPUT_DIR, `${day}_multi-guild-scale-test.md`);
    const jsonPath = path.join(OUTPUT_DIR, `${day}_multi-guild-scale-test.json`);
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, md, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
    console.log(`[MULTI-GUILD] written: ${path.relative(ROOT, mdPath).replace(/\\/g, '/')}`);
  }

  console.log(`[MULTI-GUILD] verdict=${verdict} guilds=${guildIds.length} pass=${passed} fail=${failed} err=${errored}`);

  if (verdict !== 'SCALE_OK') process.exit(1);
}

main().catch((err) => {
  console.error('[MULTI-GUILD] fatal:', err?.message || err);
  process.exit(1);
});
