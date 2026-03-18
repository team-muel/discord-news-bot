import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');
const OUTPUT = path.join(RUNS_DIR, 'WEEKLY_SUMMARY.md');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
};

const days = Math.max(1, Number(parseArg('days', '7')) || 7);
const dryRun = ['1', 'true', 'yes', 'on'].includes(String(parseArg('dryRun', 'false')).toLowerCase());
const windowStartMs = Date.now() - days * 24 * 60 * 60 * 1000;

const readMaybe = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
};

const readJsonMaybe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const parseField = (content, fieldName) => {
  const regex = new RegExp(`^-\\s*${fieldName}\\s*:\\s*(.*)$`, 'mi');
  const match = content.match(regex);
  return match ? String(match[1] || '').trim() : '';
};

const normalizeOverall = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'go' || normalized === 'no-go') {
    return normalized;
  }
  return 'pending';
};

const normalizeRollbackRequired = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true' || normalized === 'false') {
    return normalized;
  }
  return 'unknown';
};

const normalizeRollbackType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['none', 'stage', 'queue', 'provider'].includes(normalized)) {
    return normalized;
  }
  return 'unknown';
};

const cleanCell = (value) => String(value || '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();

const files = fs.existsSync(RUNS_DIR)
  ? fs.readdirSync(RUNS_DIR)
      .filter((name) => name.endsWith('.md'))
      .filter((name) => name !== 'README.md' && name !== 'WEEKLY_SUMMARY.md')
      .map((name) => path.join(RUNS_DIR, name))
  : [];

const runs = files
  .map((filePath) => {
    const stat = fs.statSync(filePath);
    const content = readMaybe(filePath);
    const jsonPath = filePath.replace(/\.md$/i, '.json');
    const json = readJsonMaybe(jsonPath);
    const jsonFinalDecision = json?.final_decision || {};

    const runId = String(json?.run_id || parseField(content, 'run_id') || path.basename(filePath, '.md')).trim();
    const stage = String(json?.stage || parseField(content, 'stage') || 'unknown').trim();
    const scope = String(json?.target_scope || parseField(content, 'target_scope') || 'unknown').trim();
    const operator = String(json?.operator || parseField(content, 'operator') || 'unknown').trim();
    const overall = normalizeOverall(jsonFinalDecision.overall || parseField(content, 'overall') || 'pending');
    const rollbackRequired = normalizeRollbackRequired(
      jsonFinalDecision.rollback_required || parseField(content, 'rollback_required') || 'unknown',
    );
    const rollbackType = normalizeRollbackType(
      jsonFinalDecision.rollback_type || parseField(content, 'rollback_type') || 'unknown',
    );

    return {
      filePath,
      mtimeMs: stat.mtimeMs,
      runId,
      stage,
      scope,
      operator,
      overall,
      rollbackRequired,
      rollbackType,
      source: json ? 'json+md' : 'md',
    };
  })
  .filter((run) => run.mtimeMs >= windowStartMs)
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

const byStage = new Map();
let goCount = 0;
let noGoCount = 0;
let pendingCount = 0;

for (const run of runs) {
  const stage = String(run.stage || 'unknown');
  byStage.set(stage, (byStage.get(stage) || 0) + 1);

  const overall = String(run.overall || '').toLowerCase();
  if (overall === 'go') {
    goCount += 1;
  } else if (overall === 'no-go') {
    noGoCount += 1;
  } else {
    pendingCount += 1;
  }
}

const stageRows = [...byStage.entries()]
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  .map(([stage, count]) => `| ${stage} | ${count} |`)
  .join('\n');

const recentRows = runs
  .slice(0, 15)
  .map((run) => {
    const rel = path.relative(ROOT, run.filePath).replace(/\\/g, '/');
    return `| ${cleanCell(run.runId)} | ${cleanCell(run.stage)} | ${cleanCell(run.scope)} | ${cleanCell(run.overall)} | ${cleanCell(run.rollbackRequired)} | ${cleanCell(run.rollbackType)} | ${cleanCell(rel)} |`;
  })
  .join('\n');

const body = `# Go/No-Go Weekly Summary\n\n- window_days: ${days}\n- generated_at: ${new Date().toISOString()}\n- total_runs: ${runs.length}\n- go: ${goCount}\n- no_go: ${noGoCount}\n- pending: ${pendingCount}\n\n## Stage Distribution\n\n| Stage | Count |\n| --- | ---: |\n${stageRows || '| - | 0 |'}\n\n## Recent Runs\n\n| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | File |\n| --- | --- | --- | --- | --- | --- | --- |\n${recentRows || '| - | - | - | - | - | - | - |'}\n`;

if (!dryRun) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, body, 'utf8');
}

console.log(`[GO-NO-GO] weekly summary ${dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')}`);
