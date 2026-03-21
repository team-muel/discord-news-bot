/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');
const OUTPUT_DIR = RUNS_DIR;

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
const requiredStreak = Math.max(1, Number(parseArg('requiredStreak', '3')) || 3);
const stage = String(parseArg('stage', 'A')).trim();

const now = new Date();
const day = now.toISOString().slice(0, 10);

/**
 * Scan gate-run JSON files sorted by date (newest first).
 * Returns an array: { file, date, verdict }[]
 */
const loadGateRuns = () => {
  if (!fs.existsSync(RUNS_DIR)) return [];

  const files = fs.readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('fixtures'))
    .sort()
    .reverse();

  const runs = [];
  for (const file of files) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), 'utf8'));
      const verdict = String(content?.verdict || content?.final_verdict || '').toLowerCase();
      const dateStr = content?.generated_at || content?.timestamp || file.slice(0, 10);
      const stageVal = String(content?.stage || '').toUpperCase();
      if (stage && stageVal && stageVal !== stage.toUpperCase()) continue;
      runs.push({ file, date: dateStr, verdict });
    } catch { /* skip malformed */ }
  }
  return runs;
};

const runs = loadGateRuns();

// Count consecutive 'go' verdicts from the most recent run backwards
let consecutiveGo = 0;
for (const run of runs) {
  if (run.verdict === 'go') {
    consecutiveGo += 1;
  } else {
    break;
  }
}

const expansionEligible = consecutiveGo >= requiredStreak;
const verdict = expansionEligible ? 'EXPANSION_ELIGIBLE' : 'NOT_READY';

const recent = runs.slice(0, Math.max(requiredStreak + 2, 10));

const md = `# Consecutive Pass & Beta Expansion Status

- generated_at: ${now.toISOString()}
- stage: ${stage}
- required_streak: ${requiredStreak}
- consecutive_go: ${consecutiveGo}
- expansion_eligible: ${expansionEligible}
- verdict: ${verdict}

## Recent Gate Runs (newest first)

| # | Date | Verdict | File |
|---|------|---------|------|
${recent.map((r, i) => `| ${i + 1} | ${String(r.date).slice(0, 19)} | ${r.verdict} | ${r.file} |`).join('\n')}

## Interpretation

${expansionEligible
    ? `${consecutiveGo}회 연속 GO — 베타 확장 승인 가능 (required: ${requiredStreak})`
    : `현재 ${consecutiveGo}회 연속 GO — 목표인 ${requiredStreak}회 연속 미달성. 다음 gate pass 이후 다시 확인`}

## Next Steps

${expansionEligible
    ? `- [ ] 운영자 승인 확인 후 beta 확장 적용
- [ ] 확장 대상 길드 설정 업데이트
- [ ] 확장 후 1주 모니터링 기간 설정`
    : `- [ ] 실패 원인 분석 및 개선
- [ ] 다음 gate 실행 후 재검증`}
`;

const json = {
  generated_at: now.toISOString(),
  stage,
  required_streak: requiredStreak,
  consecutive_go: consecutiveGo,
  expansion_eligible: expansionEligible,
  verdict,
  recent_runs: recent,
};

if (dryRun) {
  console.log('[CONSECUTIVE-PASS] dry-run=true');
  console.log(md);
  console.log(JSON.stringify(json, null, 2));
} else {
  const mdPath = path.join(OUTPUT_DIR, `${day}_consecutive-pass-status.md`);
  const jsonPath = path.join(OUTPUT_DIR, `${day}_consecutive-pass-status.json`);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
  console.log(`[CONSECUTIVE-PASS] written: ${path.relative(ROOT, mdPath).replace(/\\/g, '/')}`);
  console.log(`[CONSECUTIVE-PASS] written: ${path.relative(ROOT, jsonPath).replace(/\\/g, '/')}`);
}

console.log(`[CONSECUTIVE-PASS] verdict=${verdict} consecutive_go=${consecutiveGo}/${requiredStreak}`);

if (!expansionEligible) {
  process.exit(1);
}
