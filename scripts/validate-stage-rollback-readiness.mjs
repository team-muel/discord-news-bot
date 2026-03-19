/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DEFAULT_SUMMARY_PATH = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'rollback-rehearsals', 'WEEKLY_SUMMARY.md');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
};

const asNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const fail = (message) => {
  console.error(`[ROLLBACK-READINESS] ${message}`);
  process.exit(1);
};

const parseField = (markdown, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^-\\s*${escaped}\\s*:\\s*(.+)\\s*$`, 'im');
  const match = String(markdown || '').match(pattern);
  return match ? String(match[1] || '').trim() : '';
};

const summaryPathArg = String(parseArg('summaryPath', '')).trim();
const summaryPath = summaryPathArg
  ? path.resolve(ROOT, summaryPathArg)
  : DEFAULT_SUMMARY_PATH;
const maxSummaryAgeHours = Math.max(1, asNumber(parseArg('maxSummaryAgeHours', '36'), 36));
const maxRecoveryMinutes = Math.max(1, asNumber(parseArg('maxRecoveryMinutes', '10'), 10));
const maxFailCount = Math.max(0, asNumber(parseArg('maxFailCount', '0'), 0));
const minTotalRuns = Math.max(0, asNumber(parseArg('minTotalRuns', '0'), 0));
const allowZeroRuns = String(parseArg('allowZeroRuns', 'true')).trim().toLowerCase() !== 'false';

if (!fs.existsSync(summaryPath)) {
  fail(`weekly summary not found: ${path.relative(ROOT, summaryPath).replace(/\\/g, '/')}`);
}

const markdown = fs.readFileSync(summaryPath, 'utf8');
const generatedAtRaw = parseField(markdown, 'generated_at');
const totalRuns = asNumber(parseField(markdown, 'total_runs'), 0);
const failCount = asNumber(parseField(markdown, 'fail'), 0);
const p95ElapsedMs = asNumber(parseField(markdown, 'p95_elapsed_ms'), 0);

const generatedAtMs = Date.parse(generatedAtRaw);
if (!Number.isFinite(generatedAtMs)) {
  fail(`invalid generated_at in weekly summary: ${generatedAtRaw || 'missing'}`);
}

const ageMs = Date.now() - generatedAtMs;
const ageHours = Number((ageMs / (60 * 60 * 1000)).toFixed(2));
if (ageMs > maxSummaryAgeHours * 60 * 60 * 1000) {
  fail(`weekly summary is stale: age_hours=${ageHours}, limit_hours=${maxSummaryAgeHours}`);
}

if (totalRuns < minTotalRuns) {
  fail(`rollback rehearsal total_runs is below minimum: total_runs=${totalRuns}, min_total_runs=${minTotalRuns}`);
}

if (!allowZeroRuns && totalRuns === 0) {
  fail('rollback rehearsal total_runs=0 while allowZeroRuns=false');
}

if (failCount > maxFailCount) {
  fail(`rollback rehearsal fail count exceeded: fail=${failCount}, max_fail=${maxFailCount}`);
}

const p95LimitMs = maxRecoveryMinutes * 60 * 1000;
if (p95ElapsedMs > p95LimitMs) {
  fail(`rollback rehearsal p95 elapsed exceeded: p95_elapsed_ms=${p95ElapsedMs}, limit_ms=${p95LimitMs}`);
}

console.log(
  `[ROLLBACK-READINESS] validated summary=${path.relative(ROOT, summaryPath).replace(/\\/g, '/')} generated_at=${generatedAtRaw} total_runs=${totalRuns} fail=${failCount} p95_elapsed_ms=${p95ElapsedMs}`,
);
