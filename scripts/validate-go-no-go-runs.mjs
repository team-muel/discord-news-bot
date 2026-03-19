import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DEFAULT_RUNS_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');
const SCHEMA_PATH = path.join(ROOT, 'docs', 'planning', 'GO_NO_GO_RUN_SCHEMA.json');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
};

const parseBoolArg = (name, fallback = false) => {
  const raw = String(parseArg(name, fallback ? 'true' : 'false')).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const runsDirArg = String(parseArg('dir', '')).trim();
const RUNS_DIR = runsDirArg
  ? path.resolve(ROOT, runsDirArg)
  : DEFAULT_RUNS_DIR;
const REQUIRE_NO_GO = parseBoolArg('requireNoGo', false);
const REQUIRE_CHECKLIST = parseBoolArg('requireChecklist', false);
const CHECKLIST_SINCE_DAYS = Math.max(0, Number(parseArg('checklistSinceDays', '0')) || 0);

const fail = (message) => {
  console.error(`[GO-NO-GO][VALIDATE] ${message}`);
  process.exit(1);
};

const warn = (message) => {
  console.warn(`[GO-NO-GO][VALIDATE][WARN] ${message}`);
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const hasKeys = (value, keys) => keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const isPositiveIntString = (value) => /^\d+$/.test(String(value).trim()) && Number(value) > 0;

const parseBooleanLike = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
};

const hasCheckedChecklistItem = (markdown, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^-\\s*\\[x\\]\\s+${escaped}(?:\\s*\\(evidence:\\s*.+\\))?\\s*$`, 'im');
  return pattern.test(markdown);
};

const validatePostDecisionChecklist = (mdPathRelative) => {
  const mdPath = path.join(ROOT, mdPathRelative);
  if (!fs.existsSync(mdPath)) {
    fail(`${mdPathRelative} missing for checklist validation`);
  }

  const markdown = fs.readFileSync(mdPath, 'utf8');
  const requiredItems = [
    'incident template 기록 완료',
    'comms playbook 공지 완료',
    'next checkpoint 예약 완료',
    'follow-up owner 지정 완료',
  ];

  for (const item of requiredItems) {
    if (!hasCheckedChecklistItem(markdown, item)) {
      fail(`${mdPathRelative} checklist incomplete: ${item}`);
    }
  }
};

if (!fs.existsSync(RUNS_DIR)) {
  fail(`gate-runs directory not found: ${path.relative(ROOT, RUNS_DIR)}`);
}

if (!fs.existsSync(SCHEMA_PATH)) {
  fail(`schema not found: ${path.relative(ROOT, SCHEMA_PATH)}`);
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`failed to parse schema ${path.relative(ROOT, SCHEMA_PATH)}: ${message}`);
}

if (!isObject(schema) || !isObject(schema.requiredKeySets)) {
  fail(`invalid schema structure in ${path.relative(ROOT, SCHEMA_PATH)}`);
}

const rootRequired = Array.isArray(schema.requiredKeySets.root) ? schema.requiredKeySets.root : [];
const finalDecisionRequired = Array.isArray(schema.requiredKeySets.final_decision) ? schema.requiredKeySets.final_decision : [];
const gatesRequired = Array.isArray(schema.requiredKeySets.gates) ? schema.requiredKeySets.gates : [];

const mdFiles = fs.readdirSync(RUNS_DIR)
  .filter((name) => name.endsWith('.md'))
  .filter((name) => name !== 'README.md' && name !== 'WEEKLY_SUMMARY.md');

const jsonFiles = fs.readdirSync(RUNS_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => path.join(RUNS_DIR, name));

const mdBaseSet = new Set(mdFiles.map((name) => name.replace(/\.md$/i, '')));
const jsonBaseSet = new Set(jsonFiles.map((filePath) => path.basename(filePath).replace(/\.json$/i, '')));

for (const mdBase of mdBaseSet) {
  if (!jsonBaseSet.has(mdBase)) {
    fail(`${path.relative(ROOT, RUNS_DIR)} has md without json pair: ${mdBase}.md`);
  }
}

for (const jsonBase of jsonBaseSet) {
  if (!mdBaseSet.has(jsonBase)) {
    fail(`${path.relative(ROOT, RUNS_DIR)} has json without md pair: ${jsonBase}.json`);
  }
}

if (jsonFiles.length === 0) {
  warn('no JSON run logs found; nothing to validate');
  process.exit(0);
}

let validatedCount = 0;
let noGoCount = 0;

for (const filePath of jsonFiles) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`${path.relative(ROOT, filePath)} parse failed: ${message}`);
  }

  if (!isObject(json)) {
    fail(`${path.relative(ROOT, filePath)} must be a JSON object`);
  }
  if (!hasKeys(json, rootRequired)) {
    fail(`${path.relative(ROOT, filePath)} missing required root keys (schema aligned)`);
  }

  const runId = json.run_id;
  const stage = String(json.stage ?? '').trim();
  const scope = json.target_scope;
  const startedAt = json.started_at;
  const endedAt = json.ended_at;
  const endedAtMs = Date.parse(String(endedAt || ''));

  if (!isNonEmptyString(runId)) {
    fail(`${path.relative(ROOT, filePath)} missing run_id`);
  }
  if (!['A', 'B', 'C'].includes(stage)) {
    fail(`${path.relative(ROOT, filePath)} invalid stage=${stage || '<empty>'} (expected A|B|C)`);
  }
  if (!isNonEmptyString(scope)) {
    fail(`${path.relative(ROOT, filePath)} missing target_scope`);
  }
  if (!isNonEmptyString(startedAt) || Number.isNaN(Date.parse(startedAt))) {
    fail(`${path.relative(ROOT, filePath)} invalid started_at`);
  }
  if (!isNonEmptyString(endedAt) || Number.isNaN(Date.parse(endedAt))) {
    fail(`${path.relative(ROOT, filePath)} invalid ended_at`);
  }

  const finalDecision = json.final_decision;
  if (!isObject(finalDecision)) {
    fail(`${path.relative(ROOT, filePath)} missing final_decision object`);
  }
  if (!hasKeys(finalDecision, finalDecisionRequired)) {
    fail(`${path.relative(ROOT, filePath)} missing required final_decision keys (schema aligned)`);
  }

  const overall = String(finalDecision.overall ?? '').trim().toLowerCase();
  const rollbackRequired = parseBooleanLike(finalDecision.rollback_required);
  const rollbackType = String(finalDecision.rollback_type ?? '').trim().toLowerCase();

  if (!['go', 'no-go', 'pending'].includes(overall)) {
    fail(`${path.relative(ROOT, filePath)} invalid final_decision.overall=${overall || '<empty>'}`);
  }

  if (rollbackRequired === null) {
    fail(`${path.relative(ROOT, filePath)} invalid final_decision.rollback_required (must be boolean/true|false)`);
  }

  if (overall === 'go') {
    if (rollbackRequired !== false) {
      fail(`${path.relative(ROOT, filePath)} go decision requires rollback_required=false`);
    }
    if (rollbackType !== 'none') {
      fail(`${path.relative(ROOT, filePath)} go decision requires rollback_type=none`);
    }
    if (!Array.isArray(finalDecision.required_actions) || finalDecision.required_actions.length !== 0) {
      fail(`${path.relative(ROOT, filePath)} go decision requires empty required_actions`);
    }
  }

  if (overall === 'no-go') {
    noGoCount += 1;
    if (rollbackRequired !== true) {
      fail(`${path.relative(ROOT, filePath)} no-go decision requires rollback_required=true`);
    }
    if (!['stage', 'queue', 'provider'].includes(rollbackType)) {
      fail(`${path.relative(ROOT, filePath)} no-go decision requires rollback_type=stage|queue|provider`);
    }
    if (!Array.isArray(finalDecision.required_actions) || finalDecision.required_actions.length === 0) {
      fail(`${path.relative(ROOT, filePath)} no-go decision requires non-empty required_actions`);
    }
    if (!isPositiveIntString(finalDecision.rollback_deadline_min)) {
      fail(`${path.relative(ROOT, filePath)} no-go decision requires positive rollback_deadline_min`);
    }
  }

  if (overall === 'pending') {
    if (rollbackRequired !== false) {
      fail(`${path.relative(ROOT, filePath)} pending decision requires rollback_required=false`);
    }
    if (rollbackType !== 'none') {
      fail(`${path.relative(ROOT, filePath)} pending decision requires rollback_type=none`);
    }
  }

  if (REQUIRE_CHECKLIST && overall !== 'pending') {
    const shouldValidateByWindow = CHECKLIST_SINCE_DAYS <= 0
      ? true
      : endedAtMs >= (Date.now() - CHECKLIST_SINCE_DAYS * 24 * 60 * 60 * 1000);
    if (shouldValidateByWindow) {
      const mdRelative = path.relative(ROOT, filePath).replace(/\.json$/i, '.md').replace(/\\/g, '/');
      validatePostDecisionChecklist(mdRelative);
    }
  }

  const gates = json.gates;
  if (!isObject(gates)) {
    fail(`${path.relative(ROOT, filePath)} missing gates object`);
  }
  if (!hasKeys(gates, gatesRequired)) {
    fail(`${path.relative(ROOT, filePath)} missing required gates keys (schema aligned)`);
  }

  for (const gateName of ['reliability', 'quality', 'safety', 'governance']) {
    const gate = gates[gateName];
    if (!isObject(gate)) {
      fail(`${path.relative(ROOT, filePath)} missing gates.${gateName}`);
    }
    const verdict = String(gate.verdict ?? '').trim().toLowerCase();
    if (!['pass', 'fail', 'pending'].includes(verdict)) {
      fail(`${path.relative(ROOT, filePath)} invalid gates.${gateName}.verdict=${verdict || '<empty>'}`);
    }
  }

  validatedCount += 1;
}

if (REQUIRE_NO_GO && noGoCount === 0) {
  fail(`${path.relative(ROOT, RUNS_DIR)} requires at least one no-go run (use --requireNoGo=true)`);
}

console.log(`[GO-NO-GO][VALIDATE] validated ${validatedCount} JSON run logs (no-go=${noGoCount}) checklist=${REQUIRE_CHECKLIST ? 'on' : 'off'}`);