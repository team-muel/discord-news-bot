import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
};

const now = new Date();
const iso = now.toISOString();
const yyyy = now.getUTCFullYear();
const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
const dd = String(now.getUTCDate()).padStart(2, '0');
const hh = String(now.getUTCHours()).padStart(2, '0');
const mi = String(now.getUTCMinutes()).padStart(2, '0');
const ss = String(now.getUTCSeconds()).padStart(2, '0');

const stage = parseArg('stage', 'A');
const scope = parseArg('scope', 'guild:unknown');
const operator = parseArg('operator', 'auto');
const runId = parseArg('runId', `gate-${yyyy}${mm}${dd}-${hh}${mi}${ss}`);
const decision = String(parseArg('decision', 'pending')).toLowerCase();
const normalizedDecision = decision === 'go' || decision === 'no-go' ? decision : 'pending';
const rollbackTypeArg = parseArg('rollbackType', 'stage');
const rollbackType = ['none', 'stage', 'queue', 'provider'].includes(rollbackTypeArg) ? rollbackTypeArg : 'stage';
const rollbackDeadline = parseArg('rollbackDeadlineMin', normalizedDecision === 'no-go' ? '10' : '');

const rollbackRequired = normalizedDecision === 'no-go';
const finalRollbackType = normalizedDecision === 'no-go' ? rollbackType : 'none';
const requiredActions = normalizedDecision === 'no-go'
  ? '- rollback_execute\n- incident_record\n- comms_broadcast'
  : '';

const rollbackChecklist = normalizedDecision === 'no-go'
  ? '- [x] rollback 실행 완료\n- [x] incident template 기록 완료\n- [x] comms playbook 공지 완료\n- [ ] next checkpoint 예약 완료\n- [ ] follow-up owner 지정 완료'
  : '- [ ] incident template 기록 완료\n- [ ] comms playbook 공지 완료\n- [ ] next checkpoint 예약 완료\n- [ ] follow-up owner 지정 완료';

const runtimeLoopEvidenceChecklist = [
  '- [ ] scheduler-policy snapshot 첨부 (`/api/bot/agent/runtime/scheduler-policy`)',
  '- [ ] service-init ID 확인 (`memory-job-runner`, `opencode-publish-worker`, `trading-engine`, `runtime-alerts`)',
  '- [ ] discord-ready ID 확인 (`automation-modules`, `agent-daily-learning`, `got-cutover-autopilot`, `login-session-cleanup(app)`, `obsidian-sync-loop`, `retrieval-eval-loop`, `agent-slo-alert-loop`)',
  '- [ ] database ID 확인 (`supabase-maintenance-cron`, `login-session-cleanup(db)`)',
  '- [ ] loops snapshot 첨부 (`/api/bot/agent/runtime/loops`)',
  '- [ ] unattended-health snapshot 첨부 (`/api/bot/agent/runtime/unattended-health`)',
].join('\n');

const fileName = `${yyyy}-${mm}-${dd}_${runId}.md`;
const target = path.join(OUTPUT_DIR, fileName);
const jsonTarget = target.replace(/\.md$/i, '.json');

const body = `# Go/No-Go Decision Run\n\n- run_id: ${runId}\n- stage: ${stage}\n- target_scope: ${scope}\n- started_at: ${iso}\n- ended_at: ${iso}\n- operator: ${operator}\n- change_set:\n\n## Reliability Gate\n\n- p95_latency_ms:\n- mttr_min:\n- queue_lag_sec:\n- error_rate_pct:\n- threshold_profile:\n- verdict: pass | fail\n- reasons:\n\n## Quality Gate\n\n- citation_rate:\n- retrieval_hit_at_k:\n- hallucination_review_fail_rate:\n- session_success_rate:\n- threshold_profile:\n- verdict: pass | fail\n- reasons:\n\n## Safety Gate\n\n- approval_required_compliance_pct:\n- unapproved_autodeploy_count:\n- policy_violation_count:\n- privacy_block_count:\n- verdict: pass | fail\n- reasons:\n\n## Governance Gate\n\n- roadmap_synced: true | false\n- execution_board_synced: true | false\n- backlog_synced: true | false\n- runbook_synced: true | false\n- changelog_synced: true | false\n- verdict: pass | fail\n- reasons:\n\n## Final Decision\n\n- overall: ${normalizedDecision}\n- required_actions:\n${requiredActions}\n- rollback_required: ${rollbackRequired}\n- rollback_type: ${finalRollbackType}\n- rollback_deadline_min: ${rollbackDeadline}\n\n## Evidence Bundle\n\n- summary:\n- artifacts:\n- verification:\n- error:\n- retry_hint:\n- runtime_cost:\n\n## Runtime Loop Evidence\n\n- startup/owner taxonomy: service-init|discord-ready|database / owner(app|db)\n- scheduler_policy_generated_at:\n- scheduler_policy_items_verified:\n${runtimeLoopEvidenceChecklist}\n\n## Post-Decision Checklist\n\n${rollbackChecklist}\n`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(target, body, 'utf8');

const jsonBody = {
  run_id: runId,
  stage,
  target_scope: scope,
  started_at: iso,
  ended_at: iso,
  operator,
  change_set: '',
  final_decision: {
    overall: normalizedDecision,
    required_actions: normalizedDecision === 'no-go'
      ? ['rollback_execute', 'incident_record', 'comms_broadcast']
      : [],
    rollback_required: rollbackRequired,
    rollback_type: finalRollbackType,
    rollback_deadline_min: rollbackDeadline,
  },
  gates: {
    reliability: { verdict: 'pending' },
    quality: { verdict: 'pending' },
    safety: { verdict: 'pending' },
    governance: { verdict: 'pending' },
  },
  runtime_loop_evidence: {
    startup_owner_taxonomy: 'service-init|discord-ready|database / owner(app|db)',
    scheduler_policy_generated_at: null,
    scheduler_policy_items_verified: false,
    service_init_ids_verified: false,
    discord_ready_ids_verified: false,
    database_ids_verified: false,
    loops_snapshot_attached: false,
    unattended_health_snapshot_attached: false,
  },
};

fs.writeFileSync(jsonTarget, `${JSON.stringify(jsonBody, null, 2)}\n`, 'utf8');

console.log(`[GO-NO-GO] created ${path.relative(ROOT, target)} and ${path.relative(ROOT, jsonTarget)}`);
