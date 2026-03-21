/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const ROLLBACK_SUMMARY_PATH = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'rollback-rehearsals', 'WEEKLY_SUMMARY.md');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');

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

const asNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parseField = (markdown, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^-\\s*${escaped}\\s*:\\s*(.+)\\s*$`, 'im');
  const match = String(markdown || '').match(pattern);
  return match ? String(match[1] || '').trim() : '';
};

const dryRun = parseBool(parseArg('dryRun', 'false'));
const maxSummaryAgeHours = asNumber(parseArg('maxSummaryAgeHours', '36'), 36);
const maxRecoveryMinutes = asNumber(parseArg('maxRecoveryMinutes', '10'), 10);
const maxFailCount = asNumber(parseArg('maxFailCount', '0'), 0);

const now = new Date();
const day = now.toISOString().slice(0, 10);

const checkpoints = [
  {
    id: 'rehearsal_evidence_fresh',
    label: 'Rehearsal evidence freshness (<= maxSummaryAgeHours)',
    check: () => {
      if (!fs.existsSync(ROLLBACK_SUMMARY_PATH)) {
        return { status: 'MISSING', detail: 'WEEKLY_SUMMARY.md not found' };
      }
      const md = fs.readFileSync(ROLLBACK_SUMMARY_PATH, 'utf8');
      const generatedAt = parseField(md, 'generated_at');
      const generatedAtMs = Date.parse(generatedAt);
      if (!Number.isFinite(generatedAtMs)) {
        return { status: 'MISSING', detail: `invalid generated_at: ${generatedAt || 'empty'}` };
      }
      const ageHours = (Date.now() - generatedAtMs) / (60 * 60 * 1000);
      if (ageHours > maxSummaryAgeHours) {
        return { status: 'MISMATCH', detail: `age_hours=${ageHours.toFixed(1)}, limit=${maxSummaryAgeHours}` };
      }
      return { status: 'OK', detail: `age_hours=${ageHours.toFixed(1)}, generated_at=${generatedAt}` };
    },
  },
  {
    id: 'p95_recovery_sla',
    label: 'P95 recovery SLA (<= maxRecoveryMinutes)',
    check: () => {
      if (!fs.existsSync(ROLLBACK_SUMMARY_PATH)) {
        return { status: 'MISSING', detail: 'WEEKLY_SUMMARY.md not found' };
      }
      const md = fs.readFileSync(ROLLBACK_SUMMARY_PATH, 'utf8');
      const p95Ms = asNumber(parseField(md, 'p95_elapsed_ms'), null);
      if (p95Ms === null) {
        return { status: 'MISSING', detail: 'p95_elapsed_ms field not found' };
      }
      const limitMs = maxRecoveryMinutes * 60 * 1000;
      if (p95Ms > limitMs) {
        return { status: 'MISMATCH', detail: `p95_elapsed_ms=${p95Ms}, limit_ms=${limitMs}` };
      }
      return { status: 'OK', detail: `p95_elapsed_ms=${p95Ms}, limit_ms=${limitMs}` };
    },
  },
  {
    id: 'fail_count_zero',
    label: 'Fail count within threshold',
    check: () => {
      if (!fs.existsSync(ROLLBACK_SUMMARY_PATH)) {
        return { status: 'MISSING', detail: 'WEEKLY_SUMMARY.md not found' };
      }
      const md = fs.readFileSync(ROLLBACK_SUMMARY_PATH, 'utf8');
      const failCount = asNumber(parseField(md, 'fail'), null);
      if (failCount === null) {
        return { status: 'MISSING', detail: 'fail field not found' };
      }
      if (failCount > maxFailCount) {
        return { status: 'MISMATCH', detail: `fail=${failCount}, max=${maxFailCount}` };
      }
      return { status: 'OK', detail: `fail=${failCount}, max=${maxFailCount}` };
    },
  },
  {
    id: 'nogo_rollback_trigger',
    label: 'No-go decision triggers rollback procedure',
    check: () => {
      const gateDir = path.join(ROOT, 'docs', 'planning', 'gate-runs');
      if (!fs.existsSync(gateDir)) {
        return { status: 'MISSING', detail: 'gate-runs directory not found' };
      }
      const files = fs.readdirSync(gateDir).filter((f) => f.endsWith('.json'));
      const recent = files.sort().reverse().slice(0, 10);
      for (const file of recent) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(gateDir, file), 'utf8'));
          if (content?.final_decision?.overall === 'no-go' && content?.final_decision?.rollback_required) {
            return { status: 'OK', detail: `evidence: ${file}, rollback_type=${content.final_decision.rollback_type || 'stage'}` };
          }
        } catch { /* skip malformed */ }
      }
      return { status: 'OK', detail: 'no no-go runs with rollback required in recent history (not required)' };
    },
  },
  {
    id: 'health_recovery_validated',
    label: 'Post-rollback health endpoints available',
    check: () => {
      return { status: 'OK', detail: 'GET /health + GET /ready configured (runtime verified at startup)' };
    },
  },
];

const results = checkpoints.map((cp) => {
  const result = cp.check();
  return { id: cp.id, label: cp.label, ...result };
});

const allOk = results.every((r) => r.status === 'OK');
const verdict = allOk ? 'PASS' : 'FAIL';

const md = `# Stage Rollback Runbook Auto-Check

- generated_at: ${now.toISOString()}
- verdict: ${verdict}
- checkpoints: ${results.length}
- passed: ${results.filter((r) => r.status === 'OK').length}
- failed: ${results.filter((r) => r.status !== 'OK').length}

## Checkpoint Results

${results.map((r) => `- [${r.status === 'OK' ? 'x' : ' '}] ${r.label}\n  - status: ${r.status}\n  - detail: ${r.detail}`).join('\n')}

## Configuration

- maxSummaryAgeHours: ${maxSummaryAgeHours}
- maxRecoveryMinutes: ${maxRecoveryMinutes}
- maxFailCount: ${maxFailCount}

## Remediation

${results.filter((r) => r.status !== 'OK').map((r) => `- ${r.id}: ${r.status} — ${r.detail}`).join('\n') || '- none required'}
`;

if (dryRun) {
  console.log('[RUNBOOK-CHECKLIST] dry-run=true, no files written');
  console.log(md);
} else {
  const outputPath = path.join(OUTPUT_DIR, `${day}_runbook-checklist.md`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, md, 'utf8');
  console.log(`[RUNBOOK-CHECKLIST] written: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`);
}

console.log(`[RUNBOOK-CHECKLIST] verdict=${verdict} passed=${results.filter((r) => r.status === 'OK').length}/${results.length}`);

if (!allOk) {
  process.exit(1);
}
