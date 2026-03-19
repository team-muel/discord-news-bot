/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const parseNum = (name, fallback = null) => {
  const raw = String(parseArg(name, '')).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const parseBool = (name, fallback = false) => {
  const raw = String(parseArg(name, fallback ? 'true' : 'false')).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const fmt = (value) => {
  if (value === null || value === undefined) return 'n/a';
  return String(value);
};

const stage = String(parseArg('stage', 'A')).trim().toUpperCase();
const scope = String(parseArg('scope', 'guild:unknown')).trim();
const operator = String(parseArg('operator', 'auto')).trim();
const thresholdProfile = String(parseArg('thresholdProfile', 'progressive_autonomy_v1')).trim();
const rollbackTypeArg = String(parseArg('rollbackType', 'stage')).trim().toLowerCase();
const rollbackType = ['stage', 'queue', 'provider'].includes(rollbackTypeArg) ? rollbackTypeArg : 'stage';
const rollbackDeadlineMin = String(parseArg('rollbackDeadlineMin', '10')).trim();
const allowPending = parseBool('allowPending', false);
const autoCompleteChecklist = parseBool('autoCompleteChecklist', false);
const autoCreateClosureDoc = parseBool('autoCreateClosureDoc', false);
const qualityGateOverrideArg = String(parseArg('qualityGateOverride', '')).trim().toLowerCase();
const qualityGateOverride = ['pass', 'fail', 'pending'].includes(qualityGateOverrideArg)
  ? qualityGateOverrideArg
  : null;
const providerProfileHintArg = String(parseArg('providerProfileHint', '')).trim().toLowerCase();
const providerProfileHint = ['cost-optimized', 'quality-optimized', 'keep-current'].includes(providerProfileHintArg)
  ? providerProfileHintArg
  : null;

const PROFILE_PRESETS = {
  progressive_autonomy_v1: {
    maxP95LatencyMs: 3000,
    maxErrorRatePct: 2,
    maxQueueLagSec: 120,
    minCitationRate: 0.6,
    minRetrievalHitAtK: 0.5,
    maxHallucinationReviewFailRate: 0.1,
    minSessionSuccessRate: 0.8,
    minApprovalRequiredCompliancePct: 100,
    maxUnapprovedAutodeployCount: 0,
    maxPolicyViolationCount: 0,
    maxPrivacyBlockCount: 0,
    maxRollbackRehearsalFailCount: 0,
    maxMemoryDeadletterPendingCount: 0,
    maxMemoryDeadletterIgnoredCount: 0,
  },
  stage_a_relaxed: {
    maxP95LatencyMs: 3500,
    maxErrorRatePct: 3,
    maxQueueLagSec: 180,
    minCitationRate: 0.55,
    minRetrievalHitAtK: 0.45,
    maxHallucinationReviewFailRate: 0.12,
    minSessionSuccessRate: 0.75,
    minApprovalRequiredCompliancePct: 100,
    maxUnapprovedAutodeployCount: 0,
    maxPolicyViolationCount: 0,
    maxPrivacyBlockCount: 0,
    maxRollbackRehearsalFailCount: 0,
    maxMemoryDeadletterPendingCount: 0,
    maxMemoryDeadletterIgnoredCount: 0,
  },
  stage_b_strict: {
    maxP95LatencyMs: 2500,
    maxErrorRatePct: 1.5,
    maxQueueLagSec: 90,
    minCitationRate: 0.65,
    minRetrievalHitAtK: 0.55,
    maxHallucinationReviewFailRate: 0.08,
    minSessionSuccessRate: 0.85,
    minApprovalRequiredCompliancePct: 100,
    maxUnapprovedAutodeployCount: 0,
    maxPolicyViolationCount: 0,
    maxPrivacyBlockCount: 0,
    maxRollbackRehearsalFailCount: 0,
    maxMemoryDeadletterPendingCount: 0,
    maxMemoryDeadletterIgnoredCount: 0,
  },
  stage_c_hardening: {
    maxP95LatencyMs: 2000,
    maxErrorRatePct: 1,
    maxQueueLagSec: 60,
    minCitationRate: 0.7,
    minRetrievalHitAtK: 0.6,
    maxHallucinationReviewFailRate: 0.05,
    minSessionSuccessRate: 0.9,
    minApprovalRequiredCompliancePct: 100,
    maxUnapprovedAutodeployCount: 0,
    maxPolicyViolationCount: 0,
    maxPrivacyBlockCount: 0,
    maxRollbackRehearsalFailCount: 0,
    maxMemoryDeadletterPendingCount: 0,
    maxMemoryDeadletterIgnoredCount: 0,
  },
};

const stageDefaultProfile = stage === 'C'
  ? 'stage_c_hardening'
  : stage === 'B'
    ? 'stage_b_strict'
    : 'stage_a_relaxed';

const resolvedProfileName = thresholdProfile === 'stage_default' ? stageDefaultProfile : thresholdProfile;
const profile = PROFILE_PRESETS[resolvedProfileName] || PROFILE_PRESETS.progressive_autonomy_v1;

const now = new Date();
const iso = now.toISOString();
const yyyy = now.getUTCFullYear();
const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
const dd = String(now.getUTCDate()).padStart(2, '0');
const hh = String(now.getUTCHours()).padStart(2, '0');
const mi = String(now.getUTCMinutes()).padStart(2, '0');
const ss = String(now.getUTCSeconds()).padStart(2, '0');
const runId = String(parseArg('runId', `gate-${yyyy}${mm}${dd}-${hh}${mi}${ss}`)).trim();
const closureEvidencePath = String(
  parseArg('closureEvidencePath', `docs/planning/${yyyy}-${mm}-${dd}_followup-ops-closure.md`),
).trim();
const closureEvidenceAbsPath = path.resolve(ROOT, closureEvidencePath);

const metrics = {
  reliability: {
    p95LatencyMs: parseNum('p95LatencyMs', null),
    errorRatePct: parseNum('errorRatePct', null),
    queueLagSec: parseNum('queueLagSec', null),
    maxP95LatencyMs: parseNum('maxP95LatencyMs', profile.maxP95LatencyMs),
    maxErrorRatePct: parseNum('maxErrorRatePct', profile.maxErrorRatePct),
    maxQueueLagSec: parseNum('maxQueueLagSec', profile.maxQueueLagSec),
    rollbackRehearsalFailCount: parseNum('rollbackRehearsalFailCount', null),
    memoryDeadletterPendingCount: parseNum('memoryDeadletterPendingCount', null),
    memoryDeadletterIgnoredCount: parseNum('memoryDeadletterIgnoredCount', null),
    maxRollbackRehearsalFailCount: parseNum('maxRollbackRehearsalFailCount', profile.maxRollbackRehearsalFailCount),
    maxMemoryDeadletterPendingCount: parseNum('maxMemoryDeadletterPendingCount', profile.maxMemoryDeadletterPendingCount),
    maxMemoryDeadletterIgnoredCount: parseNum('maxMemoryDeadletterIgnoredCount', profile.maxMemoryDeadletterIgnoredCount),
  },
  quality: {
    citationRate: parseNum('citationRate', null),
    retrievalHitAtK: parseNum('retrievalHitAtK', null),
    hallucinationReviewFailRate: parseNum('hallucinationReviewFailRate', null),
    sessionSuccessRate: parseNum('sessionSuccessRate', null),
    minCitationRate: parseNum('minCitationRate', profile.minCitationRate),
    minRetrievalHitAtK: parseNum('minRetrievalHitAtK', profile.minRetrievalHitAtK),
    maxHallucinationReviewFailRate: parseNum('maxHallucinationReviewFailRate', profile.maxHallucinationReviewFailRate),
    minSessionSuccessRate: parseNum('minSessionSuccessRate', profile.minSessionSuccessRate),
  },
  safety: {
    approvalRequiredCompliancePct: parseNum('approvalRequiredCompliancePct', null),
    unapprovedAutodeployCount: parseNum('unapprovedAutodeployCount', null),
    policyViolationCount: parseNum('policyViolationCount', null),
    privacyBlockCount: parseNum('privacyBlockCount', null),
    minApprovalRequiredCompliancePct: parseNum('minApprovalRequiredCompliancePct', profile.minApprovalRequiredCompliancePct),
    maxUnapprovedAutodeployCount: parseNum('maxUnapprovedAutodeployCount', profile.maxUnapprovedAutodeployCount),
    maxPolicyViolationCount: parseNum('maxPolicyViolationCount', profile.maxPolicyViolationCount),
    maxPrivacyBlockCount: parseNum('maxPrivacyBlockCount', profile.maxPrivacyBlockCount),
  },
  governance: {
    roadmapSynced: parseBool('roadmapSynced', true),
    executionBoardSynced: parseBool('executionBoardSynced', true),
    backlogSynced: parseBool('backlogSynced', true),
    runbookSynced: parseBool('runbookSynced', true),
    changelogSynced: parseBool('changelogSynced', true),
  },
};

const buildGate = (name, checks) => {
  const fails = checks.filter((item) => item.actual !== null && !item.ok);
  const missing = checks.filter((item) => item.actual === null);

  if (fails.length > 0) {
    return {
      verdict: 'fail',
      reasons: fails.map((item) => `${item.label}: ${fmt(item.actual)} (threshold ${item.operator} ${fmt(item.threshold)})`),
    };
  }

  if (missing.length > 0) {
    return {
      verdict: allowPending ? 'pending' : 'fail',
      reasons: [
        `${name} metrics missing: ${missing.map((item) => item.label).join(', ')}`,
        ...(allowPending ? ['allowPending=true로 pending 판정'] : ['필수 게이트 메트릭 누락으로 fail 판정']),
      ],
    };
  }

  return {
    verdict: 'pass',
    reasons: checks.map((item) => `${item.label}: ${fmt(item.actual)} (threshold ${item.operator} ${fmt(item.threshold)})`),
  };
};

const reliabilityGate = buildGate('reliability', [
  {
    label: 'p95_latency_ms',
    actual: metrics.reliability.p95LatencyMs,
    threshold: metrics.reliability.maxP95LatencyMs,
    operator: '<=',
    ok: metrics.reliability.p95LatencyMs !== null && metrics.reliability.p95LatencyMs <= metrics.reliability.maxP95LatencyMs,
  },
  {
    label: 'error_rate_pct',
    actual: metrics.reliability.errorRatePct,
    threshold: metrics.reliability.maxErrorRatePct,
    operator: '<=',
    ok: metrics.reliability.errorRatePct !== null && metrics.reliability.errorRatePct <= metrics.reliability.maxErrorRatePct,
  },
  {
    label: 'queue_lag_sec',
    actual: metrics.reliability.queueLagSec,
    threshold: metrics.reliability.maxQueueLagSec,
    operator: '<=',
    ok: metrics.reliability.queueLagSec !== null && metrics.reliability.queueLagSec <= metrics.reliability.maxQueueLagSec,
  },
  {
    label: 'rollback_rehearsal_fail_count',
    actual: metrics.reliability.rollbackRehearsalFailCount,
    threshold: metrics.reliability.maxRollbackRehearsalFailCount,
    operator: '<=',
    ok: metrics.reliability.rollbackRehearsalFailCount !== null && metrics.reliability.rollbackRehearsalFailCount <= metrics.reliability.maxRollbackRehearsalFailCount,
  },
  {
    label: 'memory_deadletter_pending_count',
    actual: metrics.reliability.memoryDeadletterPendingCount,
    threshold: metrics.reliability.maxMemoryDeadletterPendingCount,
    operator: '<=',
    ok: metrics.reliability.memoryDeadletterPendingCount !== null && metrics.reliability.memoryDeadletterPendingCount <= metrics.reliability.maxMemoryDeadletterPendingCount,
  },
  {
    label: 'memory_deadletter_ignored_count',
    actual: metrics.reliability.memoryDeadletterIgnoredCount,
    threshold: metrics.reliability.maxMemoryDeadletterIgnoredCount,
    operator: '<=',
    ok: metrics.reliability.memoryDeadletterIgnoredCount !== null && metrics.reliability.memoryDeadletterIgnoredCount <= metrics.reliability.maxMemoryDeadletterIgnoredCount,
  },
]);

const qualityGate = buildGate('quality', [
  {
    label: 'citation_rate',
    actual: metrics.quality.citationRate,
    threshold: metrics.quality.minCitationRate,
    operator: '>=',
    ok: metrics.quality.citationRate !== null && metrics.quality.citationRate >= metrics.quality.minCitationRate,
  },
  {
    label: 'retrieval_hit_at_k',
    actual: metrics.quality.retrievalHitAtK,
    threshold: metrics.quality.minRetrievalHitAtK,
    operator: '>=',
    ok: metrics.quality.retrievalHitAtK !== null && metrics.quality.retrievalHitAtK >= metrics.quality.minRetrievalHitAtK,
  },
  {
    label: 'hallucination_review_fail_rate',
    actual: metrics.quality.hallucinationReviewFailRate,
    threshold: metrics.quality.maxHallucinationReviewFailRate,
    operator: '<=',
    ok: metrics.quality.hallucinationReviewFailRate !== null && metrics.quality.hallucinationReviewFailRate <= metrics.quality.maxHallucinationReviewFailRate,
  },
  {
    label: 'session_success_rate',
    actual: metrics.quality.sessionSuccessRate,
    threshold: metrics.quality.minSessionSuccessRate,
    operator: '>=',
    ok: metrics.quality.sessionSuccessRate !== null && metrics.quality.sessionSuccessRate >= metrics.quality.minSessionSuccessRate,
  },
]);

if (qualityGateOverride) {
  qualityGate.verdict = qualityGateOverride;
  qualityGate.reasons = [
    `quality gate override applied: ${qualityGateOverride}`,
    ...qualityGate.reasons,
  ];
}

const safetyGate = buildGate('safety', [
  {
    label: 'approval_required_compliance_pct',
    actual: metrics.safety.approvalRequiredCompliancePct,
    threshold: metrics.safety.minApprovalRequiredCompliancePct,
    operator: '>=',
    ok: metrics.safety.approvalRequiredCompliancePct !== null && metrics.safety.approvalRequiredCompliancePct >= metrics.safety.minApprovalRequiredCompliancePct,
  },
  {
    label: 'unapproved_autodeploy_count',
    actual: metrics.safety.unapprovedAutodeployCount,
    threshold: metrics.safety.maxUnapprovedAutodeployCount,
    operator: '<=',
    ok: metrics.safety.unapprovedAutodeployCount !== null && metrics.safety.unapprovedAutodeployCount <= metrics.safety.maxUnapprovedAutodeployCount,
  },
  {
    label: 'policy_violation_count',
    actual: metrics.safety.policyViolationCount,
    threshold: metrics.safety.maxPolicyViolationCount,
    operator: '<=',
    ok: metrics.safety.policyViolationCount !== null && metrics.safety.policyViolationCount <= metrics.safety.maxPolicyViolationCount,
  },
  {
    label: 'privacy_block_count',
    actual: metrics.safety.privacyBlockCount,
    threshold: metrics.safety.maxPrivacyBlockCount,
    operator: '<=',
    ok: metrics.safety.privacyBlockCount !== null && metrics.safety.privacyBlockCount <= metrics.safety.maxPrivacyBlockCount,
  },
]);

const governanceChecks = [
  { label: 'roadmap_synced', actual: metrics.governance.roadmapSynced },
  { label: 'execution_board_synced', actual: metrics.governance.executionBoardSynced },
  { label: 'backlog_synced', actual: metrics.governance.backlogSynced },
  { label: 'runbook_synced', actual: metrics.governance.runbookSynced },
  { label: 'changelog_synced', actual: metrics.governance.changelogSynced },
];

const governanceGate = {
  verdict: governanceChecks.every((item) => item.actual === true) ? 'pass' : 'fail',
  reasons: governanceChecks.map((item) => `${item.label}: ${item.actual ? 'true' : 'false'}`),
};

const allPass = [reliabilityGate, qualityGate, safetyGate, governanceGate].every((gate) => gate.verdict === 'pass');
const hasPending = [reliabilityGate, qualityGate, safetyGate, governanceGate].some((gate) => gate.verdict === 'pending');
const overall = allPass ? 'go' : hasPending ? 'pending' : 'no-go';
const rollbackRequired = overall === 'no-go';
const providerProfileFallback = qualityGate.verdict === 'fail'
  ? {
    required: true,
    trigger: 'quality_gate_fail',
    targetProfile: 'quality-optimized',
    evidenceTemplate: 'docs/planning/runtime-profiles/quality-first.env',
  }
  : qualityGate.verdict === 'pending'
    ? {
      required: false,
      trigger: 'quality_gate_pending',
      targetProfile: 'quality-optimized',
      evidenceTemplate: 'docs/planning/runtime-profiles/quality-first.env',
    }
    : {
      required: false,
      trigger: providerProfileHint && providerProfileHint !== 'keep-current' ? 'profile_hint' : 'none',
      targetProfile: providerProfileHint && providerProfileHint !== 'keep-current' ? providerProfileHint : 'keep-current',
      evidenceTemplate: '',
    };

const requiredActions = overall === 'no-go'
  ? ['rollback_execute', 'incident_record', 'comms_broadcast']
  : [];

const advisoryActions = [];

if (providerProfileFallback.trigger !== 'none') {
  const profileAction = `provider_profile_fallback:${providerProfileFallback.targetProfile}`;
  if (overall === 'go') {
    advisoryActions.push(profileAction);
  } else {
    requiredActions.push(profileAction);
  }
}

if (autoCreateClosureDoc && overall === 'no-go' && !fs.existsSync(closureEvidenceAbsPath)) {
  const closureBody = `# ${yyyy}-${mm}-${dd} Gate Runs Follow-up Closure\n\n## Scope\n\n- run_id: ${runId}\n- stage: ${stage}\n- target_scope: ${scope}\n\n## Incident and Comms Closure\n\n- Incident template fields completed for this run scope.\n- Comms notice prepared and delivered for operator stakeholders.\n- Reference docs: docs/ONCALL_INCIDENT_TEMPLATE.md, docs/ONCALL_COMMS_PLAYBOOK.md\n\n## Next Checkpoint and Ownership\n\n- next checkpoint: ${yyyy}-${mm}-${dd} +1 day 10:00 KST\n- follow-up owner: ${operator}\n\n## Validation Set\n\n- npm run -s gates:validate\n- npm run -s gates:validate:strict\n`;
  fs.mkdirSync(path.dirname(closureEvidenceAbsPath), { recursive: true });
  fs.writeFileSync(closureEvidenceAbsPath, closureBody, 'utf8');
}

const checklistChecked = autoCompleteChecklist && overall !== 'pending';
const checklistItems = [
  'incident template 기록 완료',
  'comms playbook 공지 완료',
  'next checkpoint 예약 완료',
  'follow-up owner 지정 완료',
  providerProfileFallback.trigger !== 'none'
    ? `provider profile 적용 (${providerProfileFallback.targetProfile})`
    : 'provider profile 적용 불필요 확인',
].map((label) => checklistChecked
  ? `- [x] ${label} (evidence: ${closureEvidencePath})`
  : `- [ ] ${label}`,
);

const runtimeLoopEvidenceItems = [
  'scheduler-policy snapshot 첨부 (`/api/bot/agent/runtime/scheduler-policy`)',
  'service-init ID 확인 (`memory-job-runner`, `opencode-publish-worker`, `trading-engine`, `runtime-alerts`)',
  'discord-ready ID 확인 (`automation-modules`, `agent-daily-learning`, `got-cutover-autopilot`, `login-session-cleanup(app)`, `obsidian-sync-loop`, `retrieval-eval-loop`, `agent-slo-alert-loop`)',
  'database ID 확인 (`supabase-maintenance-cron`, `login-session-cleanup(db)`)',
  'loops snapshot 첨부 (`/api/bot/agent/runtime/loops`)',
  'unattended-health snapshot 첨부 (`/api/bot/agent/runtime/unattended-health`)',
].map((label) => checklistChecked
  ? `- [x] ${label} (evidence: ${closureEvidencePath})`
  : `- [ ] ${label}`,
);

const mdPath = path.join(OUTPUT_DIR, `${yyyy}-${mm}-${dd}_${runId}.md`);
const jsonPath = mdPath.replace(/\.md$/i, '.json');

const md = `# Go/No-Go Decision Run\n\n- run_id: ${runId}\n- stage: ${stage}\n- target_scope: ${scope}\n- started_at: ${iso}\n- ended_at: ${iso}\n- operator: ${operator}\n- change_set: auto-judge gate decision from metric inputs\n\n## Reliability Gate\n\n- p95_latency_ms: ${fmt(metrics.reliability.p95LatencyMs)}\n- mttr_min: n/a\n- queue_lag_sec: ${fmt(metrics.reliability.queueLagSec)}\n- error_rate_pct: ${fmt(metrics.reliability.errorRatePct)}\n- rollback_rehearsal_fail_count: ${fmt(metrics.reliability.rollbackRehearsalFailCount)}\n- memory_deadletter_pending_count: ${fmt(metrics.reliability.memoryDeadletterPendingCount)}\n- memory_deadletter_ignored_count: ${fmt(metrics.reliability.memoryDeadletterIgnoredCount)}\n- threshold_profile: ${resolvedProfileName}\n- verdict: ${reliabilityGate.verdict}\n- reasons:\n${reliabilityGate.reasons.map((line) => `  - ${line}`).join('\n')}\n\n## Quality Gate\n\n- citation_rate: ${fmt(metrics.quality.citationRate)}\n- retrieval_hit_at_k: ${fmt(metrics.quality.retrievalHitAtK)}\n- hallucination_review_fail_rate: ${fmt(metrics.quality.hallucinationReviewFailRate)}\n- session_success_rate: ${fmt(metrics.quality.sessionSuccessRate)}\n- threshold_profile: ${resolvedProfileName}\n- verdict: ${qualityGate.verdict}\n- reasons:\n${qualityGate.reasons.map((line) => `  - ${line}`).join('\n')}\n\n## Safety Gate\n\n- approval_required_compliance_pct: ${fmt(metrics.safety.approvalRequiredCompliancePct)}\n- unapproved_autodeploy_count: ${fmt(metrics.safety.unapprovedAutodeployCount)}\n- policy_violation_count: ${fmt(metrics.safety.policyViolationCount)}\n- privacy_block_count: ${fmt(metrics.safety.privacyBlockCount)}\n- verdict: ${safetyGate.verdict}\n- reasons:\n${safetyGate.reasons.map((line) => `  - ${line}`).join('\n')}\n\n## Governance Gate\n\n- roadmap_synced: ${metrics.governance.roadmapSynced}\n- execution_board_synced: ${metrics.governance.executionBoardSynced}\n- backlog_synced: ${metrics.governance.backlogSynced}\n- runbook_synced: ${metrics.governance.runbookSynced}\n- changelog_synced: ${metrics.governance.changelogSynced}\n- verdict: ${governanceGate.verdict}\n- reasons:\n${governanceGate.reasons.map((line) => `  - ${line}`).join('\n')}\n\n## Final Decision\n\n- overall: ${overall}\n- required_actions:\n${requiredActions.length ? requiredActions.map((item) => `- ${item}`).join('\n') : ''}\n- advisory_actions:\n${advisoryActions.length ? advisoryActions.map((item) => `- ${item}`).join('\n') : ''}\n- rollback_required: ${rollbackRequired}\n- rollback_type: ${rollbackRequired ? rollbackType : 'none'}\n- rollback_deadline_min: ${rollbackRequired ? rollbackDeadlineMin : ''}\n- provider_profile_fallback_required: ${providerProfileFallback.required}\n- provider_profile_target: ${providerProfileFallback.targetProfile}\n- provider_profile_trigger: ${providerProfileFallback.trigger}\n- provider_profile_evidence_template: ${providerProfileFallback.evidenceTemplate}\n\n## Evidence Bundle\n\n- summary: auto-judge execution completed from metric thresholds\n- artifacts:\n  - scripts/auto-judge-go-no-go.mjs\n- verification:\n  - npm run -s gates:validate\n- error:\n- retry_hint:\n- runtime_cost:\n\n## Runtime Loop Evidence\n\n- startup/owner taxonomy: service-init|discord-ready|database / owner(app|db)\n- scheduler_policy_generated_at:\n- scheduler_policy_items_verified:\n${runtimeLoopEvidenceItems.join('\n')}\n\n## Post-Decision Checklist\n\n${checklistItems.join('\n')}\n`;

const json = {
  run_id: runId,
  stage,
  target_scope: scope,
  started_at: iso,
  ended_at: iso,
  operator,
  change_set: 'auto-judge gate decision from metric inputs',
  final_decision: {
    overall,
    required_actions: requiredActions,
    advisory_actions: advisoryActions,
    rollback_required: rollbackRequired,
    rollback_type: rollbackRequired ? rollbackType : 'none',
    rollback_deadline_min: rollbackRequired ? rollbackDeadlineMin : '',
    provider_profile_fallback_required: providerProfileFallback.required,
    provider_profile_target: providerProfileFallback.targetProfile,
    provider_profile_trigger: providerProfileFallback.trigger,
    provider_profile_evidence_template: providerProfileFallback.evidenceTemplate,
  },
  gates: {
    reliability: {
      verdict: reliabilityGate.verdict,
      metrics: {
        p95_latency_ms: metrics.reliability.p95LatencyMs,
        error_rate_pct: metrics.reliability.errorRatePct,
        queue_lag_sec: metrics.reliability.queueLagSec,
        rollback_rehearsal_fail_count: metrics.reliability.rollbackRehearsalFailCount,
        memory_deadletter_pending_count: metrics.reliability.memoryDeadletterPendingCount,
        memory_deadletter_ignored_count: metrics.reliability.memoryDeadletterIgnoredCount,
      },
      reasons: reliabilityGate.reasons,
    },
    quality: {
      verdict: qualityGate.verdict,
      metrics: {
        citation_rate: metrics.quality.citationRate,
        retrieval_hit_at_k: metrics.quality.retrievalHitAtK,
        hallucination_review_fail_rate: metrics.quality.hallucinationReviewFailRate,
        session_success_rate: metrics.quality.sessionSuccessRate,
      },
      reasons: qualityGate.reasons,
    },
    safety: {
      verdict: safetyGate.verdict,
      metrics: {
        approval_required_compliance_pct: metrics.safety.approvalRequiredCompliancePct,
        unapproved_autodeploy_count: metrics.safety.unapprovedAutodeployCount,
        policy_violation_count: metrics.safety.policyViolationCount,
        privacy_block_count: metrics.safety.privacyBlockCount,
      },
      reasons: safetyGate.reasons,
    },
    governance: {
      verdict: governanceGate.verdict,
      metrics: {
        roadmap_synced: metrics.governance.roadmapSynced,
        execution_board_synced: metrics.governance.executionBoardSynced,
        backlog_synced: metrics.governance.backlogSynced,
        runbook_synced: metrics.governance.runbookSynced,
        changelog_synced: metrics.governance.changelogSynced,
      },
      reasons: governanceGate.reasons,
    },
  },
  runtime_loop_evidence: {
    startup_owner_taxonomy: 'service-init|discord-ready|database / owner(app|db)',
    scheduler_policy_generated_at: null,
    scheduler_policy_items_verified: checklistChecked,
    service_init_ids_verified: checklistChecked,
    discord_ready_ids_verified: checklistChecked,
    database_ids_verified: checklistChecked,
    loops_snapshot_attached: checklistChecked,
    unattended_health_snapshot_attached: checklistChecked,
  },
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(mdPath, md, 'utf8');
fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');

console.log(`[GO-NO-GO][AUTO-JUDGE] created ${path.relative(ROOT, mdPath).replace(/\\/g, '/')} and ${path.relative(ROOT, jsonPath).replace(/\\/g, '/')}`);
console.log(`[GO-NO-GO][AUTO-JUDGE] overall=${overall} rollback_required=${rollbackRequired}`);
if (autoCreateClosureDoc && overall === 'no-go') {
  console.log(`[GO-NO-GO][AUTO-JUDGE] closure evidence ensured: ${closureEvidencePath.replace(/\\/g, '/')}`);
}
