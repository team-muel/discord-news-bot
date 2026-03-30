/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'rollback-rehearsals');
const OUTPUT = path.join(RUNS_DIR, 'WEEKLY_SUMMARY.md');
const VALID_SINKS = new Set(['markdown', 'supabase', 'stdout']);

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
  const values = tokens.length > 0 ? tokens : ['markdown'];
  const deduped = [...new Set(values)].filter((sink) => VALID_SINKS.has(sink));
  return deduped.length > 0 ? deduped : ['markdown'];
};

const readMaybeJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const days = Math.max(1, Number(parseArg('days', '7')) || 7);
const dryRun = parseBool(parseArg('dryRun', 'false'));
const sinks = parseSinks(parseArg('sinks', process.env.ROLLBACK_WEEKLY_REPORT_SINKS || 'markdown'));
const allowMissingSupabaseTable = parseBool(
  parseArg('allowMissingSupabaseTable', process.env.ROLLBACK_WEEKLY_REPORT_ALLOW_MISSING_TABLE || 'true'),
  true,
);
const allowUnsupportedReportKind = parseBool(
  parseArg('allowUnsupportedReportKind', process.env.ROLLBACK_WEEKLY_REPORT_ALLOW_UNSUPPORTED_KIND || 'true'),
  true,
);
const guildId = String(parseArg('guildId', '')).trim() || null;
const provider = String(parseArg('provider', '')).trim() || null;
const actionPrefix = String(parseArg('actionPrefix', '')).trim() || null;

const nowIso = new Date().toISOString();
const windowStartMs = Date.now() - days * 24 * 60 * 60 * 1000;
const windowStartIso = new Date(windowStartMs).toISOString();

const entries = fs.existsSync(RUNS_DIR)
  ? fs.readdirSync(RUNS_DIR)
      .filter((name) => /_rollback-\d{8}-\d{6}\.json$/i.test(name))
      .map((name) => ({
        name,
        abs: path.join(RUNS_DIR, name),
      }))
  : [];

const runs = entries
  .map((entry) => {
    const data = readMaybeJson(entry.abs);
    if (!data) return null;

    const ts = Date.parse(String(data.generated_at || data.payload?.timestamp || ''));
    if (!Number.isFinite(ts) || ts < windowStartMs) {
      return null;
    }

    const runId = String(data.run_id || '').trim() || entry.name.replace(/\.json$/i, '');
    const overall = String(data.overall || '').toLowerCase() === 'pass' ? 'pass' : 'fail';
    const elapsedMs = Number(data.elapsed_ms || 0);

    return {
      runId,
      generatedAt: new Date(ts).toISOString(),
      elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
      withinRecoveryTarget: data.within_recovery_target === true,
      reconnectStatus: Number(data.reconnect_status || 0),
      replayStatus: Number(data.reconnect_replay_status || 0),
      overall,
      file: `docs/planning/gate-runs/rollback-rehearsals/${entry.name}`,
    };
  })
  .filter(Boolean)
  .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));

const totalRuns = runs.length;
const passCount = runs.filter((run) => run.overall === 'pass').length;
const failCount = totalRuns - passCount;
const avgElapsedMs = totalRuns > 0 ? Math.round(runs.reduce((sum, run) => sum + run.elapsedMs, 0) / totalRuns) : 0;
const p95ElapsedMs = (() => {
  if (totalRuns === 0) return 0;
  const sorted = runs.map((run) => run.elapsedMs).sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[index];
})();

const recentRows = runs
  .slice(0, 20)
  .map((run) => `| ${run.runId} | ${run.generatedAt} | ${run.overall} | ${run.elapsedMs} | ${run.withinRecoveryTarget} | ${run.reconnectStatus} | ${run.replayStatus} | ${run.file} |`)
  .join('\n');

const body = `# Rollback Rehearsal Weekly Summary\n\n- window_days: ${days}\n- generated_at: ${nowIso}\n- total_runs: ${totalRuns}\n- pass: ${passCount}\n- fail: ${failCount}\n- avg_elapsed_ms: ${avgElapsedMs}\n- p95_elapsed_ms: ${p95ElapsedMs}\n\n## Recent Rehearsals\n\n| Run ID | Timestamp | Overall | Elapsed(ms) | Within Target | Reconnect | Replay | File |\n| --- | --- | --- | ---: | --- | ---: | ---: | --- |\n${recentRows || '| - | - | - | 0 | - | - | - | - |'}\n`;

const buildReportKey = () => {
  const day = nowIso.slice(0, 10);
  return [
    'rollback_rehearsal_weekly',
    day,
    `days:${days}`,
    `guild:${guildId || '*'}`,
    `provider:${provider || '*'}`,
    `prefix:${actionPrefix || '*'}`,
  ].join('|');
};

const writeSupabaseArtifact = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    if (dryRun) {
      console.log('[ROLLBACK-WEEKLY] supabase previewed: missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
      return;
    }
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required for supabase sink');
  }

  const payload = {
    report_key: buildReportKey(),
    report_kind: 'rollback_rehearsal_weekly',
    guild_id: guildId,
    provider,
    action_prefix: actionPrefix,
    baseline_from: windowStartIso,
    baseline_to: nowIso,
    candidate_from: null,
    candidate_to: null,
    baseline_summary: {
      window_days: days,
      total_runs: totalRuns,
      pass: passCount,
      fail: failCount,
      avg_elapsed_ms: avgElapsedMs,
      p95_elapsed_ms: p95ElapsedMs,
    },
    candidate_summary: {},
    delta_summary: {},
    top_actions: {
      recent_runs: runs.slice(0, 20).map((run) => ({
        run_id: run.runId,
        overall: run.overall,
        elapsed_ms: run.elapsedMs,
        within_recovery_target: run.withinRecoveryTarget,
      })),
    },
    markdown: body,
  };

  if (dryRun) {
    console.log('[ROLLBACK-WEEKLY] supabase previewed: public.agent_weekly_reports (upsert report_key)');
    return;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { error } = await client
    .from('agent_weekly_reports')
    .upsert(payload, { onConflict: 'report_key' });

  if (error) {
    const errorCode = String(error.code || '').toUpperCase();
    const errorMessage = String(error.message || '');
    const relationMissing = errorCode === '42P01' || /relation\s+"?agent_weekly_reports"?\s+does\s+not\s+exist/i.test(errorMessage);
    const unsupportedKind = errorCode === '23514' && /report_kind_check/i.test(errorMessage);
    if (relationMissing && allowMissingSupabaseTable) {
      console.log('[ROLLBACK-WEEKLY] supabase skipped: table public.agent_weekly_reports not found (apply migration first)');
      return;
    }
    if (unsupportedKind && allowUnsupportedReportKind) {
      console.log('[ROLLBACK-WEEKLY] supabase skipped: report_kind not allowed by current DB constraint (apply migration first)');
      return;
    }
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log('[ROLLBACK-WEEKLY] supabase upserted: public.agent_weekly_reports');
};

if (sinks.includes('markdown')) {
  if (!dryRun) {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT, body, 'utf8');
  }
  console.log(`[ROLLBACK-WEEKLY] summary ${dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')}`);
}

if (sinks.includes('stdout')) {
  console.log('\n[ROLLBACK-WEEKLY] report markdown\n');
  console.log(body);
}

if (sinks.includes('supabase')) {
  await writeSupabaseArtifact();
}
