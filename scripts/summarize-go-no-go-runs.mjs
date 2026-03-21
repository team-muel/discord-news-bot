import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');
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

const days = Math.max(1, Number(parseArg('days', '7')) || 7);
const dryRun = parseBool(parseArg('dryRun', 'false'));
const sinks = parseSinks(parseArg('sinks', process.env.GATE_WEEKLY_REPORT_SINKS || 'markdown'));
const allowMissingSupabaseTable = parseBool(
  parseArg('allowMissingSupabaseTable', process.env.GATE_WEEKLY_REPORT_ALLOW_MISSING_TABLE || 'true'),
  true,
);
const allowMissingQualityTables = parseBool(
  parseArg('allowMissingQualityTables', process.env.GATE_WEEKLY_REPORT_ALLOW_MISSING_QUALITY_TABLES || 'true'),
  true,
);
const guildId = String(parseArg('guildId', '')).trim() || null;
const provider = String(parseArg('provider', '')).trim() || null;
const actionPrefix = String(parseArg('actionPrefix', '')).trim() || null;
const outputArg = String(parseArg('output', '')).trim();
const windowStartMs = Date.now() - days * 24 * 60 * 60 * 1000;
const OUTPUT = outputArg
  ? path.resolve(ROOT, outputArg)
  : path.join(RUNS_DIR, 'WEEKLY_SUMMARY.md');
const legacyPendingCutoffRaw = String(parseArg('legacyPendingCutoff', '')).trim();
const legacyPendingCutoffMs = legacyPendingCutoffRaw ? Date.parse(legacyPendingCutoffRaw) : null;
const excludeLegacyPendingNoGo = parseBool(parseArg('excludeLegacyPendingNoGo', 'false'));

if (legacyPendingCutoffRaw && Number.isNaN(legacyPendingCutoffMs)) {
  throw new Error(`invalid --legacyPendingCutoff value: ${legacyPendingCutoffRaw}`);
}

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

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const clamp01 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
};

const isMissingRelationError = (error, tableName) => {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes(String(tableName || '').toLowerCase());
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
const A003_OPERATOR_SURFACE_ENDPOINT = '/api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5';

const toBooleanOrNull = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
};

const extractPostDecisionChecklist = (content) => {
  const marker = '## Post-Decision Checklist';
  const start = content.indexOf(marker);
  if (start < 0) {
    return { total: 0, checked: 0, unchecked: 0, complete: false };
  }

  const after = content.slice(start + marker.length);
  const nextHeaderIdx = after.search(/\n##\s+/);
  const section = nextHeaderIdx >= 0 ? after.slice(0, nextHeaderIdx) : after;
  const checked = (section.match(/^-\s*\[x\]\s+/gim) || []).length;
  const unchecked = (section.match(/^-\s*\[\s\]\s+/gim) || []).length;
  const total = checked + unchecked;

  return {
    total,
    checked,
    unchecked,
    complete: total > 0 && unchecked === 0,
  };
};

const extractRuntimeLoopEvidenceChecklist = (content) => {
  const marker = '## Runtime Loop Evidence';
  const start = content.indexOf(marker);
  if (start < 0) {
    return { present: false, total: 0, checked: 0, unchecked: 0, complete: false };
  }

  const after = content.slice(start + marker.length);
  const nextHeaderIdx = after.search(/\n##\s+/);
  const section = nextHeaderIdx >= 0 ? after.slice(0, nextHeaderIdx) : after;
  const checked = (section.match(/^-\s*\[x\]\s+/gim) || []).length;
  const unchecked = (section.match(/^-\s*\[\s\]\s+/gim) || []).length;
  const total = checked + unchecked;

  return {
    present: true,
    total,
    checked,
    unchecked,
    complete: total > 0 && unchecked === 0,
  };
};

const extractA003OperatorSurface = (json, runtimeLoopEvidence) => {
  const finalDecision = json?.final_decision && typeof json.final_decision === 'object'
    ? json.final_decision
    : {};
  const safetyMetrics = json?.gates?.safety?.metrics && typeof json.gates.safety.metrics === 'object'
    ? json.gates.safety.metrics
    : {};
  const runtimeLoopEvidenceJson = json?.runtime_loop_evidence && typeof json.runtime_loop_evidence === 'object' && !Array.isArray(json.runtime_loop_evidence)
    ? json.runtime_loop_evidence
    : null;

  const explicitSnapshotAttached = toBooleanOrNull(runtimeLoopEvidenceJson?.worker_approval_gates_snapshot_attached);
  const sandboxDelegationVerified = toBooleanOrNull(runtimeLoopEvidenceJson?.sandbox_delegation_verified);
  const approvalRequiredComplianceKnown = toNumber(safetyMetrics.approval_required_compliance_pct) !== null;
  const unapprovedAutodeployKnown = toNumber(safetyMetrics.unapproved_autodeploy_count) !== null;
  const providerTargetKnown = String(finalDecision.provider_profile_target || '').trim().length > 0;
  const providerTriggerKnown = String(finalDecision.provider_profile_trigger || '').trim().length > 0;
  const derivedSnapshotReady = approvalRequiredComplianceKnown && unapprovedAutodeployKnown && providerTargetKnown && providerTriggerKnown;

  const flags = [
    explicitSnapshotAttached === true || derivedSnapshotReady,
    approvalRequiredComplianceKnown,
    unapprovedAutodeployKnown,
    providerTargetKnown,
    providerTriggerKnown,
    sandboxDelegationVerified === true,
  ];
  const anyKnown = explicitSnapshotAttached !== null || sandboxDelegationVerified !== null || approvalRequiredComplianceKnown || unapprovedAutodeployKnown || providerTargetKnown || providerTriggerKnown;

  return {
    source: explicitSnapshotAttached !== null
      ? 'runtime_loop_evidence'
      : derivedSnapshotReady
        ? 'derived_from_gate_json'
        : 'none',
    endpoint: A003_OPERATOR_SURFACE_ENDPOINT,
    present: flags[0],
    total: flags.length,
    checked: flags.filter(Boolean).length,
    unchecked: flags.filter((item) => !item).length,
    complete: flags.every(Boolean),
    known: anyKnown,
    runtimeEvidenceBackfilled: !runtimeLoopEvidence.present && (explicitSnapshotAttached === true || derivedSnapshotReady),
  };
};

const extractSandboxDelegation = (json) => {
  const runtimeLoopEvidenceJson = json?.runtime_loop_evidence && typeof json.runtime_loop_evidence === 'object' && !Array.isArray(json.runtime_loop_evidence)
    ? json.runtime_loop_evidence
    : null;
  const verified = toBooleanOrNull(runtimeLoopEvidenceJson?.sandbox_delegation_verified);

  return {
    present: verified !== null,
    known: verified !== null,
    complete: verified === true,
  };
};

const isAllPendingNoGo = (run) => {
  if (String(run.overall || '').toLowerCase() !== 'no-go') return false;
  const verdicts = [
    run.gateVerdicts.reliability,
    run.gateVerdicts.quality,
    run.gateVerdicts.safety,
    run.gateVerdicts.governance,
  ];
  return verdicts.every((value) => String(value || '').toLowerCase() === 'pending');
};

const isDerivedWeeklyAutoRun = (run) => {
  const operator = String(run?.operator || '').trim().toLowerCase();
  const scope = String(run?.scope || '').trim().toLowerCase();
  return operator === 'auto' && (scope === 'weekly:auto' || scope.startsWith('weekly:auto:'));
};

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
    const endedAt = String(json?.ended_at || parseField(content, 'ended_at') || '').trim();
    const endedAtMs = Date.parse(endedAt);
    const gateVerdicts = {
      reliability: String(json?.gates?.reliability?.verdict || '').trim().toLowerCase() || null,
      quality: String(json?.gates?.quality?.verdict || '').trim().toLowerCase() || null,
      safety: String(json?.gates?.safety?.verdict || '').trim().toLowerCase() || null,
      governance: String(json?.gates?.governance?.verdict || '').trim().toLowerCase() || null,
    };
    const requiredActions = Array.isArray(jsonFinalDecision.required_actions)
      ? jsonFinalDecision.required_actions.filter((item) => typeof item === 'string' && item.trim())
      : [];
    const checklist = extractPostDecisionChecklist(content);
    const runtimeLoopEvidenceChecklist = extractRuntimeLoopEvidenceChecklist(content);
    const runtimeLoopEvidenceJson = json?.runtime_loop_evidence && typeof json.runtime_loop_evidence === 'object' && !Array.isArray(json.runtime_loop_evidence)
      ? json.runtime_loop_evidence
      : null;
    const runtimeLoopEvidenceJsonFlags = runtimeLoopEvidenceJson
      ? [
        toBooleanOrNull(runtimeLoopEvidenceJson.scheduler_policy_items_verified),
        toBooleanOrNull(runtimeLoopEvidenceJson.service_init_ids_verified),
        toBooleanOrNull(runtimeLoopEvidenceJson.discord_ready_ids_verified),
        toBooleanOrNull(runtimeLoopEvidenceJson.database_ids_verified),
        toBooleanOrNull(runtimeLoopEvidenceJson.loops_snapshot_attached),
        toBooleanOrNull(runtimeLoopEvidenceJson.unattended_health_snapshot_attached),
        toBooleanOrNull(runtimeLoopEvidenceJson.worker_approval_gates_snapshot_attached),
        toBooleanOrNull(runtimeLoopEvidenceJson.sandbox_delegation_verified),
      ]
      : null;
    const runtimeLoopEvidence = runtimeLoopEvidenceJson
      ? {
        source: 'json',
        present: true,
        total: runtimeLoopEvidenceJsonFlags.length,
        checked: runtimeLoopEvidenceJsonFlags.filter((item) => item === true).length,
        unchecked: runtimeLoopEvidenceJsonFlags.filter((item) => item !== true).length,
        complete: runtimeLoopEvidenceJsonFlags.every((item) => item === true),
        known: runtimeLoopEvidenceJsonFlags.every((item) => item !== null),
      }
      : {
        source: runtimeLoopEvidenceChecklist.present ? 'markdown' : 'none',
        present: runtimeLoopEvidenceChecklist.present,
        total: runtimeLoopEvidenceChecklist.total,
        checked: runtimeLoopEvidenceChecklist.checked,
        unchecked: runtimeLoopEvidenceChecklist.unchecked,
        complete: runtimeLoopEvidenceChecklist.complete,
        known: runtimeLoopEvidenceChecklist.present && runtimeLoopEvidenceChecklist.total > 0,
      };
    const qualityMetrics = {
      citationRate: toNumber(json?.gates?.quality?.metrics?.citation_rate),
      retrievalHitAtK: toNumber(json?.gates?.quality?.metrics?.retrieval_hit_at_k),
      hallucinationReviewFailRate: toNumber(json?.gates?.quality?.metrics?.hallucination_review_fail_rate),
      sessionSuccessRate: toNumber(json?.gates?.quality?.metrics?.session_success_rate),
    };
    const a003OperatorSurface = extractA003OperatorSurface(json, runtimeLoopEvidence);
    const sandboxDelegation = extractSandboxDelegation(json);

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
      endedAt,
      endedAtMs,
      gateVerdicts,
      requiredActions,
      checklist,
      runtimeLoopEvidence,
      a003OperatorSurface,
      sandboxDelegation,
      qualityMetrics,
      source: json ? 'json+md' : 'md',
    };
  })
  .filter((run) => run.mtimeMs >= windowStartMs)
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

const runsWithFlags = runs.map((run) => {
  const legacyPendingNoGo = Boolean(
    legacyPendingCutoffMs
      && Number.isFinite(run.endedAtMs)
      && run.endedAtMs < legacyPendingCutoffMs
      && isAllPendingNoGo(run),
  );
  return { ...run, legacyPendingNoGo };
});

const runsForKpi = excludeLegacyPendingNoGo
  ? runsWithFlags.filter((run) => !run.legacyPendingNoGo)
  : runsWithFlags;

const legacyPendingNoGoExcludedCount = runsWithFlags.filter((run) => run.legacyPendingNoGo).length;

const byStage = new Map();
let goCount = 0;
let noGoCount = 0;
let pendingCount = 0;
const gateVerdictCounts = {
  reliability: { pass: 0, fail: 0, pending: 0, unknown: 0 },
  quality: { pass: 0, fail: 0, pending: 0, unknown: 0 },
  safety: { pass: 0, fail: 0, pending: 0, unknown: 0 },
  governance: { pass: 0, fail: 0, pending: 0, unknown: 0 },
};

const autoJudgeSignalGateVerdictCounts = {
  reliability: { pass: 0, fail: 0, pending: 0, unknown: 0 },
  quality: { pass: 0, fail: 0, pending: 0, unknown: 0 },
  safety: { pass: 0, fail: 0, pending: 0, unknown: 0 },
  governance: { pass: 0, fail: 0, pending: 0, unknown: 0 },
};

const bumpGateVerdict = (counts, gate, verdictRaw) => {
  const verdict = ['pass', 'fail', 'pending'].includes(verdictRaw) ? verdictRaw : 'unknown';
  counts[gate][verdict] += 1;
};

const avg = (values) => {
  if (!values.length) return null;
  const sum = values.reduce((acc, item) => acc + item, 0);
  return Number((sum / values.length).toFixed(4));
};

const qualitySignals = {
  citationRate: [],
  retrievalHitAtK: [],
  hallucinationReviewFailRate: [],
  sessionSuccessRate: [],
};

const autoJudgeSignalQualitySignals = {
  citationRate: [],
  retrievalHitAtK: [],
  hallucinationReviewFailRate: [],
  sessionSuccessRate: [],
};

const noGoRootCause = {
  reliability_quality_dual_fail: 0,
  reliability_only_fail: 0,
  quality_only_fail: 0,
  all_gates_pending: 0,
  other: 0,
};

const requiredActionCompletion = {
  no_go_runs: 0,
  required_actions_total: 0,
  required_actions_estimated_completed: 0,
  checklist_complete_runs: 0,
  checklist_incomplete_runs: 0,
  required_action_completion_rate: null,
};

const runtimeLoopEvidenceCompletion = {
  runs_with_evidence: 0,
  complete_runs: 0,
  incomplete_runs: 0,
  missing_runs: 0,
  known_runs: 0,
  completion_rate: null,
};

const a003OperatorSurfaceCompletion = {
  endpoint: A003_OPERATOR_SURFACE_ENDPOINT,
  runs_with_surface: 0,
  complete_runs: 0,
  incomplete_runs: 0,
  missing_runs: 0,
  known_runs: 0,
  runtime_evidence_backfilled_runs: 0,
  completion_rate: null,
};

const sandboxDelegationCompletion = {
  verified_runs: 0,
  incomplete_runs: 0,
  missing_runs: 0,
  known_runs: 0,
  completion_rate: null,
};

for (const run of runsWithFlags) {
  if (String(run.overall || '').toLowerCase() !== 'no-go') {
    continue;
  }

  requiredActionCompletion.no_go_runs += 1;
  requiredActionCompletion.required_actions_total += run.requiredActions.length;
  if (run.checklist.complete) {
    requiredActionCompletion.checklist_complete_runs += 1;
    requiredActionCompletion.required_actions_estimated_completed += run.requiredActions.length;
  } else {
    requiredActionCompletion.checklist_incomplete_runs += 1;
  }

  const reliabilityFail = run.gateVerdicts.reliability === 'fail';
  const qualityFail = run.gateVerdicts.quality === 'fail';
  const allPending = isAllPendingNoGo(run);
  if (reliabilityFail && qualityFail) {
    noGoRootCause.reliability_quality_dual_fail += 1;
  } else if (reliabilityFail) {
    noGoRootCause.reliability_only_fail += 1;
  } else if (qualityFail) {
    noGoRootCause.quality_only_fail += 1;
  } else if (allPending) {
    noGoRootCause.all_gates_pending += 1;
  } else {
    noGoRootCause.other += 1;
  }
}

requiredActionCompletion.required_action_completion_rate = requiredActionCompletion.required_actions_total > 0
  ? Number((requiredActionCompletion.required_actions_estimated_completed / requiredActionCompletion.required_actions_total).toFixed(4))
  : null;

for (const run of runsForKpi) {
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

  bumpGateVerdict(gateVerdictCounts, 'reliability', run.gateVerdicts.reliability);
  bumpGateVerdict(gateVerdictCounts, 'quality', run.gateVerdicts.quality);
  bumpGateVerdict(gateVerdictCounts, 'safety', run.gateVerdicts.safety);
  bumpGateVerdict(gateVerdictCounts, 'governance', run.gateVerdicts.governance);

  if (run.qualityMetrics.citationRate !== null) qualitySignals.citationRate.push(run.qualityMetrics.citationRate);
  if (run.qualityMetrics.retrievalHitAtK !== null) qualitySignals.retrievalHitAtK.push(run.qualityMetrics.retrievalHitAtK);
  if (run.qualityMetrics.hallucinationReviewFailRate !== null) qualitySignals.hallucinationReviewFailRate.push(run.qualityMetrics.hallucinationReviewFailRate);
  if (run.qualityMetrics.sessionSuccessRate !== null) qualitySignals.sessionSuccessRate.push(run.qualityMetrics.sessionSuccessRate);

  if (!isDerivedWeeklyAutoRun(run)) {
    bumpGateVerdict(autoJudgeSignalGateVerdictCounts, 'reliability', run.gateVerdicts.reliability);
    bumpGateVerdict(autoJudgeSignalGateVerdictCounts, 'quality', run.gateVerdicts.quality);
    bumpGateVerdict(autoJudgeSignalGateVerdictCounts, 'safety', run.gateVerdicts.safety);
    bumpGateVerdict(autoJudgeSignalGateVerdictCounts, 'governance', run.gateVerdicts.governance);

    if (run.qualityMetrics.citationRate !== null) autoJudgeSignalQualitySignals.citationRate.push(run.qualityMetrics.citationRate);
    if (run.qualityMetrics.retrievalHitAtK !== null) autoJudgeSignalQualitySignals.retrievalHitAtK.push(run.qualityMetrics.retrievalHitAtK);
    if (run.qualityMetrics.hallucinationReviewFailRate !== null) autoJudgeSignalQualitySignals.hallucinationReviewFailRate.push(run.qualityMetrics.hallucinationReviewFailRate);
    if (run.qualityMetrics.sessionSuccessRate !== null) autoJudgeSignalQualitySignals.sessionSuccessRate.push(run.qualityMetrics.sessionSuccessRate);
  }

  if (!run.runtimeLoopEvidence.present) {
    runtimeLoopEvidenceCompletion.missing_runs += 1;
  } else {
    runtimeLoopEvidenceCompletion.runs_with_evidence += 1;
    if (run.runtimeLoopEvidence.known) {
      runtimeLoopEvidenceCompletion.known_runs += 1;
    }
    if (run.runtimeLoopEvidence.complete) {
      runtimeLoopEvidenceCompletion.complete_runs += 1;
    } else {
      runtimeLoopEvidenceCompletion.incomplete_runs += 1;
    }
  }

  if (!run.a003OperatorSurface.present) {
    a003OperatorSurfaceCompletion.missing_runs += 1;
  } else {
    a003OperatorSurfaceCompletion.runs_with_surface += 1;
    if (run.a003OperatorSurface.known) {
      a003OperatorSurfaceCompletion.known_runs += 1;
    }
    if (run.a003OperatorSurface.complete) {
      a003OperatorSurfaceCompletion.complete_runs += 1;
    } else {
      a003OperatorSurfaceCompletion.incomplete_runs += 1;
    }
    if (run.a003OperatorSurface.runtimeEvidenceBackfilled) {
      a003OperatorSurfaceCompletion.runtime_evidence_backfilled_runs += 1;
    }
  }

  if (!run.sandboxDelegation.present) {
    sandboxDelegationCompletion.missing_runs += 1;
  } else {
    sandboxDelegationCompletion.known_runs += 1;
    if (run.sandboxDelegation.complete) {
      sandboxDelegationCompletion.verified_runs += 1;
    } else {
      sandboxDelegationCompletion.incomplete_runs += 1;
    }
  }
}

runtimeLoopEvidenceCompletion.completion_rate = runtimeLoopEvidenceCompletion.runs_with_evidence > 0
  ? Number((runtimeLoopEvidenceCompletion.complete_runs / runtimeLoopEvidenceCompletion.runs_with_evidence).toFixed(4))
  : null;

a003OperatorSurfaceCompletion.completion_rate = a003OperatorSurfaceCompletion.runs_with_surface > 0
  ? Number((a003OperatorSurfaceCompletion.complete_runs / a003OperatorSurfaceCompletion.runs_with_surface).toFixed(4))
  : null;

sandboxDelegationCompletion.completion_rate = sandboxDelegationCompletion.known_runs > 0
  ? Number((sandboxDelegationCompletion.verified_runs / sandboxDelegationCompletion.known_runs).toFixed(4))
  : null;

const qualitySummary = {
  samples: {
    citation_rate: qualitySignals.citationRate.length,
    retrieval_hit_at_k: qualitySignals.retrievalHitAtK.length,
    hallucination_review_fail_rate: qualitySignals.hallucinationReviewFailRate.length,
    session_success_rate: qualitySignals.sessionSuccessRate.length,
  },
  averages: {
    citation_rate: avg(qualitySignals.citationRate),
    retrieval_hit_at_k: avg(qualitySignals.retrievalHitAtK),
    hallucination_review_fail_rate: avg(qualitySignals.hallucinationReviewFailRate),
    session_success_rate: avg(qualitySignals.sessionSuccessRate),
  },
};

const autoJudgeSignalSummary = {
  source_runs: runsForKpi.filter((run) => !isDerivedWeeklyAutoRun(run)).length,
  derived_weekly_auto_runs_excluded: runsForKpi.filter((run) => isDerivedWeeklyAutoRun(run)).length,
  gate_verdict_counts: autoJudgeSignalGateVerdictCounts,
  quality_summary: {
    samples: {
      citation_rate: autoJudgeSignalQualitySignals.citationRate.length,
      retrieval_hit_at_k: autoJudgeSignalQualitySignals.retrievalHitAtK.length,
      hallucination_review_fail_rate: autoJudgeSignalQualitySignals.hallucinationReviewFailRate.length,
      session_success_rate: autoJudgeSignalQualitySignals.sessionSuccessRate.length,
    },
    averages: {
      citation_rate: avg(autoJudgeSignalQualitySignals.citationRate),
      retrieval_hit_at_k: avg(autoJudgeSignalQualitySignals.retrievalHitAtK),
      hallucination_review_fail_rate: avg(autoJudgeSignalQualitySignals.hallucinationReviewFailRate),
      session_success_rate: avg(autoJudgeSignalQualitySignals.sessionSuccessRate),
    },
  },
};

const stageRows = [...byStage.entries()]
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  .map(([stage, count]) => `| ${stage} | ${count} |`)
  .join('\n');

const recentRows = runsWithFlags
  .slice(0, 15)
  .map((run) => {
    const rel = path.relative(ROOT, run.filePath).replace(/\\/g, '/');
    const legacyMark = run.legacyPendingNoGo ? ' (legacy-pending)' : '';
    const runtimeEvidenceStatus = !run.runtimeLoopEvidence.present
      ? 'missing'
      : run.runtimeLoopEvidence.complete
        ? 'complete'
        : 'incomplete';
    const a003SurfaceStatus = !run.a003OperatorSurface.present
      ? 'missing'
      : run.a003OperatorSurface.complete
        ? 'complete'
        : 'incomplete';
    const sandboxDelegationStatus = !run.sandboxDelegation.present
      ? 'missing'
      : run.sandboxDelegation.complete
        ? 'verified'
        : 'incomplete';
    return `| ${cleanCell(run.runId)}${legacyMark} | ${cleanCell(run.stage)} | ${cleanCell(run.scope)} | ${cleanCell(run.overall)} | ${cleanCell(run.rollbackRequired)} | ${cleanCell(run.rollbackType)} | ${cleanCell(runtimeEvidenceStatus)} | ${cleanCell(a003SurfaceStatus)} | ${cleanCell(sandboxDelegationStatus)} | ${cleanCell(rel)} |`;
  })
  .join('\n');

const generatedAt = new Date().toISOString();
const windowStartIso = new Date(windowStartMs).toISOString();

const fetchStrategyQualityNormalization = async () => {
  const result = {
    window_days: days,
    retrieval_eval_runs_samples: 0,
    answer_quality_review_samples: 0,
    availability: {
      retrieval_eval_runs: 'ok',
      answer_quality_reviews: 'ok',
    },
    by_strategy: {
      baseline: {
        retrieval_samples: 0,
        recall_at_k_avg: null,
        review_samples: 0,
        hallucination_fail_rate_pct: null,
        normalized_quality_score: null,
      },
      tot: {
        retrieval_samples: 0,
        recall_at_k_avg: null,
        review_samples: 0,
        hallucination_fail_rate_pct: null,
        normalized_quality_score: null,
      },
      got: {
        retrieval_samples: 0,
        recall_at_k_avg: null,
        review_samples: 0,
        hallucination_fail_rate_pct: null,
        normalized_quality_score: null,
      },
    },
    delta: {
      tot_vs_baseline: null,
      got_vs_baseline: null,
    },
  };

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    result.availability.retrieval_eval_runs = 'no_supabase_config';
    result.availability.answer_quality_reviews = 'no_supabase_config';
    return result;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  let retrievalRows = [];
  try {
    let query = client
      .from('retrieval_eval_runs')
      .select('guild_id, summary, status, created_at')
      .eq('status', 'completed')
      .gte('created_at', windowStartIso)
      .order('created_at', { ascending: false })
      .limit(200);

    if (guildId) {
      query = query.eq('guild_id', guildId);
    }

    const { data, error } = await query;
    if (error) {
      if (allowMissingQualityTables && isMissingRelationError(error, 'retrieval_eval_runs')) {
        result.availability.retrieval_eval_runs = 'missing_table';
      } else {
        throw new Error(error.message || 'RETRIEVAL_EVAL_RUNS_QUERY_FAILED');
      }
    } else {
      retrievalRows = data || [];
    }
  } catch (error) {
    if (allowMissingQualityTables && isMissingRelationError(error, 'retrieval_eval_runs')) {
      result.availability.retrieval_eval_runs = 'missing_table';
    } else {
      throw error;
    }
  }

  const recallByStrategy = {
    baseline: [],
    tot: [],
    got: [],
  };
  for (const row of retrievalRows) {
    const variants = row?.summary?.variants && typeof row.summary.variants === 'object'
      ? row.summary.variants
      : null;
    if (!variants) continue;

    for (const strategy of ['baseline', 'tot', 'got']) {
      const recall = toNumber(variants?.[strategy]?.recallAtK);
      if (recall !== null) {
        recallByStrategy[strategy].push(recall);
      }
    }
  }

  result.retrieval_eval_runs_samples = retrievalRows.length;
  for (const strategy of ['baseline', 'tot', 'got']) {
    const values = recallByStrategy[strategy];
    const recallAvg = values.length > 0
      ? Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(4))
      : null;
    result.by_strategy[strategy].retrieval_samples = values.length;
    result.by_strategy[strategy].recall_at_k_avg = recallAvg;
  }

  let reviewRows = [];
  try {
    let query = client
      .from('agent_answer_quality_reviews')
      .select('guild_id, strategy, is_hallucination, created_at')
      .gte('created_at', windowStartIso)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (guildId) {
      query = query.eq('guild_id', guildId);
    }

    const { data, error } = await query;
    if (error) {
      if (allowMissingQualityTables && isMissingRelationError(error, 'agent_answer_quality_reviews')) {
        result.availability.answer_quality_reviews = 'missing_table';
      } else {
        throw new Error(error.message || 'ANSWER_QUALITY_REVIEW_QUERY_FAILED');
      }
    } else {
      reviewRows = data || [];
    }
  } catch (error) {
    if (allowMissingQualityTables && isMissingRelationError(error, 'agent_answer_quality_reviews')) {
      result.availability.answer_quality_reviews = 'missing_table';
    } else {
      throw error;
    }
  }

  const reviewByStrategy = {
    baseline: { total: 0, hallucinations: 0 },
    tot: { total: 0, hallucinations: 0 },
    got: { total: 0, hallucinations: 0 },
  };
  for (const row of reviewRows) {
    const strategyRaw = String(row?.strategy || '').trim().toLowerCase();
    const strategy = strategyRaw === 'tot' || strategyRaw === 'got' ? strategyRaw : 'baseline';
    reviewByStrategy[strategy].total += 1;
    if (row?.is_hallucination === true) {
      reviewByStrategy[strategy].hallucinations += 1;
    }
  }

  result.answer_quality_review_samples = reviewRows.length;
  for (const strategy of ['baseline', 'tot', 'got']) {
    const stats = reviewByStrategy[strategy];
    const failRatePct = stats.total > 0
      ? Number(((stats.hallucinations / stats.total) * 100).toFixed(2))
      : null;
    result.by_strategy[strategy].review_samples = stats.total;
    result.by_strategy[strategy].hallucination_fail_rate_pct = failRatePct;

    const recallNorm = clamp01(result.by_strategy[strategy].recall_at_k_avg);
    const hallucinationNorm = failRatePct === null ? null : clamp01(1 - failRatePct / 100);
    const score = recallNorm !== null && hallucinationNorm !== null
      ? Number((0.6 * recallNorm + 0.4 * hallucinationNorm).toFixed(4))
      : recallNorm !== null
        ? recallNorm
        : hallucinationNorm;
    result.by_strategy[strategy].normalized_quality_score = score;
  }

  const baselineScore = result.by_strategy.baseline.normalized_quality_score;
  const totScore = result.by_strategy.tot.normalized_quality_score;
  const gotScore = result.by_strategy.got.normalized_quality_score;
  result.delta.tot_vs_baseline = baselineScore !== null && totScore !== null
    ? Number((totScore - baselineScore).toFixed(4))
    : null;
  result.delta.got_vs_baseline = baselineScore !== null && gotScore !== null
    ? Number((gotScore - baselineScore).toFixed(4))
    : null;

  return result;
};

const strategyQualityNormalization = await fetchStrategyQualityNormalization();

const body = `# Go/No-Go Weekly Summary\n\n- window_days: ${days}\n- generated_at: ${generatedAt}\n- total_runs: ${runsForKpi.length}\n- go: ${goCount}\n- no_go: ${noGoCount}\n- pending: ${pendingCount}\n- legacy_pending_no_go_excluded: ${excludeLegacyPendingNoGo ? legacyPendingNoGoExcludedCount : 0}\n- legacy_pending_cutoff: ${legacyPendingCutoffRaw || 'n/a'}\n\n## Stage Distribution\n\n| Stage | Count |\n| --- | ---: |\n${stageRows || '| - | 0 |'}\n\n## No-Go Root Cause Breakdown\n\n- reliability_quality_dual_fail: ${noGoRootCause.reliability_quality_dual_fail}\n- reliability_only_fail: ${noGoRootCause.reliability_only_fail}\n- quality_only_fail: ${noGoRootCause.quality_only_fail}\n- all_gates_pending: ${noGoRootCause.all_gates_pending}\n- other: ${noGoRootCause.other}\n\n## Required Action Completion (Estimated)\n\n- no_go_runs: ${requiredActionCompletion.no_go_runs}\n- required_actions_total: ${requiredActionCompletion.required_actions_total}\n- required_actions_estimated_completed: ${requiredActionCompletion.required_actions_estimated_completed}\n- required_action_completion_rate: ${requiredActionCompletion.required_action_completion_rate ?? 'n/a'}\n- checklist_complete_runs: ${requiredActionCompletion.checklist_complete_runs}\n- checklist_incomplete_runs: ${requiredActionCompletion.checklist_incomplete_runs}\n\n## Runtime Loop Evidence Completion\n\n- runs_with_evidence: ${runtimeLoopEvidenceCompletion.runs_with_evidence}\n- complete_runs: ${runtimeLoopEvidenceCompletion.complete_runs}\n- incomplete_runs: ${runtimeLoopEvidenceCompletion.incomplete_runs}\n- missing_runs: ${runtimeLoopEvidenceCompletion.missing_runs}\n- known_runs: ${runtimeLoopEvidenceCompletion.known_runs}\n- completion_rate: ${runtimeLoopEvidenceCompletion.completion_rate ?? 'n/a'}\n\n## A-003 Operator Surface Completion\n\n- canonical_endpoint: ${A003_OPERATOR_SURFACE_ENDPOINT}\n- runs_with_surface: ${a003OperatorSurfaceCompletion.runs_with_surface}\n- complete_runs: ${a003OperatorSurfaceCompletion.complete_runs}\n- incomplete_runs: ${a003OperatorSurfaceCompletion.incomplete_runs}\n- missing_runs: ${a003OperatorSurfaceCompletion.missing_runs}\n- known_runs: ${a003OperatorSurfaceCompletion.known_runs}\n- runtime_evidence_backfilled_runs: ${a003OperatorSurfaceCompletion.runtime_evidence_backfilled_runs}\n- completion_rate: ${a003OperatorSurfaceCompletion.completion_rate ?? 'n/a'}\n\n## Quality Signal Summary\n\n- citation_rate_avg: ${qualitySummary.averages.citation_rate ?? 'n/a'} (samples=${qualitySummary.samples.citation_rate})\n- retrieval_hit_at_k_avg: ${qualitySummary.averages.retrieval_hit_at_k ?? 'n/a'} (samples=${qualitySummary.samples.retrieval_hit_at_k})\n- hallucination_review_fail_rate_avg: ${qualitySummary.averages.hallucination_review_fail_rate ?? 'n/a'} (samples=${qualitySummary.samples.hallucination_review_fail_rate})\n- session_success_rate_avg: ${qualitySummary.averages.session_success_rate ?? 'n/a'} (samples=${qualitySummary.samples.session_success_rate})\n\n## Strategy Quality Normalization (M-07)\n\n- retrieval_eval_runs_availability: ${strategyQualityNormalization.availability.retrieval_eval_runs}\n- answer_quality_reviews_availability: ${strategyQualityNormalization.availability.answer_quality_reviews}\n- retrieval_eval_runs_samples: ${strategyQualityNormalization.retrieval_eval_runs_samples}\n- answer_quality_review_samples: ${strategyQualityNormalization.answer_quality_review_samples}\n- baseline_normalized_quality_score: ${strategyQualityNormalization.by_strategy.baseline.normalized_quality_score ?? 'n/a'}\n- tot_normalized_quality_score: ${strategyQualityNormalization.by_strategy.tot.normalized_quality_score ?? 'n/a'}\n- got_normalized_quality_score: ${strategyQualityNormalization.by_strategy.got.normalized_quality_score ?? 'n/a'}\n- delta_tot_vs_baseline: ${strategyQualityNormalization.delta.tot_vs_baseline ?? 'n/a'}\n- delta_got_vs_baseline: ${strategyQualityNormalization.delta.got_vs_baseline ?? 'n/a'}\n\n## Recent Runs\n\n| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | File |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${recentRows || '| - | - | - | - | - | - | - | - | - |'}\n`;

const bodyWithSandboxDelegation = body
  .replace(
    `- runtime_evidence_backfilled_runs: ${a003OperatorSurfaceCompletion.runtime_evidence_backfilled_runs}\n- completion_rate: ${a003OperatorSurfaceCompletion.completion_rate ?? 'n/a'}\n\n## Quality Signal Summary`,
    `- runtime_evidence_backfilled_runs: ${a003OperatorSurfaceCompletion.runtime_evidence_backfilled_runs}\n- completion_rate: ${a003OperatorSurfaceCompletion.completion_rate ?? 'n/a'}\n\n## Sandbox Delegation Completion\n\n- verified_runs: ${sandboxDelegationCompletion.verified_runs}\n- incomplete_runs: ${sandboxDelegationCompletion.incomplete_runs}\n- missing_runs: ${sandboxDelegationCompletion.missing_runs}\n- known_runs: ${sandboxDelegationCompletion.known_runs}\n- completion_rate: ${sandboxDelegationCompletion.completion_rate ?? 'n/a'}\n\n## Quality Signal Summary`,
  )
  .replace(
    '| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | File |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | Sandbox Delegation | File |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )
  .replace(
    `${recentRows || '| - | - | - | - | - | - | - | - | - |'}`,
    recentRows || '| - | - | - | - | - | - | - | - | - | - |',
  );

const buildReportKey = () => {
  const day = generatedAt.slice(0, 10);
  return [
    'go_no_go_weekly',
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
      console.log('[GO-NO-GO] supabase previewed: missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
      return;
    }
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required for supabase sink');
  }

  const byStage = [...new Map([...runsForKpi.map((run) => [String(run.stage || 'unknown'), 0])])].reduce((acc, [key]) => {
    acc[key] = runsForKpi.filter((run) => String(run.stage || 'unknown') === key).length;
    return acc;
  }, {});

  const payload = {
    report_key: buildReportKey(),
    report_kind: 'go_no_go_weekly',
    guild_id: guildId,
    provider,
    action_prefix: actionPrefix,
    baseline_from: windowStartIso,
    baseline_to: generatedAt,
    candidate_from: null,
    candidate_to: null,
    baseline_summary: {
      window_days: days,
      total_runs: runsForKpi.length,
      go: goCount,
      no_go: noGoCount,
      pending: pendingCount,
      legacy_pending_no_go_excluded: excludeLegacyPendingNoGo ? legacyPendingNoGoExcludedCount : 0,
      legacy_pending_cutoff: legacyPendingCutoffRaw || null,
      stage_distribution: byStage,
      gate_verdict_counts: gateVerdictCounts,
      auto_judge_signal_summary: autoJudgeSignalSummary,
      no_go_root_cause: noGoRootCause,
      required_action_completion: requiredActionCompletion,
      runtime_loop_evidence_completion: runtimeLoopEvidenceCompletion,
      a003_operator_surface_completion: a003OperatorSurfaceCompletion,
      sandbox_delegation_completion: sandboxDelegationCompletion,
      quality_summary: qualitySummary,
      strategy_quality_normalization: strategyQualityNormalization,
    },
    candidate_summary: {},
    delta_summary: {},
    top_actions: {
      strategy_quality_delta: strategyQualityNormalization.delta,
      recent_runs: runs.slice(0, 15).map((run) => ({
        run_id: run.runId,
        stage: run.stage,
        scope: run.scope,
        overall: run.overall,
        rollback_required: run.rollbackRequired,
        rollback_type: run.rollbackType,
        legacy_pending_no_go: run.legacyPendingNoGo,
        reliability_verdict: run.gateVerdicts.reliability,
        quality_verdict: run.gateVerdicts.quality,
        safety_verdict: run.gateVerdicts.safety,
        governance_verdict: run.gateVerdicts.governance,
        runtime_loop_evidence_status: !run.runtimeLoopEvidence.present
          ? 'missing'
          : run.runtimeLoopEvidence.complete
            ? 'complete'
            : 'incomplete',
        a003_operator_surface_status: !run.a003OperatorSurface.present
          ? 'missing'
          : run.a003OperatorSurface.complete
            ? 'complete'
            : 'incomplete',
        sandbox_delegation_status: !run.sandboxDelegation.present
          ? 'missing'
          : run.sandboxDelegation.complete
            ? 'verified'
            : 'incomplete',
        citation_rate: run.qualityMetrics.citationRate,
        retrieval_hit_at_k: run.qualityMetrics.retrievalHitAtK,
        hallucination_review_fail_rate: run.qualityMetrics.hallucinationReviewFailRate,
        session_success_rate: run.qualityMetrics.sessionSuccessRate,
      })),
    },
    markdown: bodyWithSandboxDelegation,
  };

  if (dryRun) {
    console.log('[GO-NO-GO] supabase previewed: public.agent_weekly_reports (upsert report_key)');
    return;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { error } = await client
    .from('agent_weekly_reports')
    .upsert(payload, { onConflict: 'report_key' });

  if (error) {
    const relationMissing = String(error.code || '').toUpperCase() === '42P01' || /agent_weekly_reports/i.test(String(error.message || ''));
    if (relationMissing && allowMissingSupabaseTable) {
      console.log('[GO-NO-GO] supabase skipped: table public.agent_weekly_reports not found (apply migration first)');
      return;
    }
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log('[GO-NO-GO] supabase upserted: public.agent_weekly_reports');
};

if (sinks.includes('markdown')) {
  if (!dryRun) {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT, bodyWithSandboxDelegation, 'utf8');
  }
  console.log(`[GO-NO-GO] weekly summary ${dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')}`);
}

if (sinks.includes('stdout')) {
  console.log('\n[GO-NO-GO] report markdown\n');
  console.log(bodyWithSandboxDelegation);
}

if (sinks.includes('supabase')) {
  await writeSupabaseArtifact();
}
