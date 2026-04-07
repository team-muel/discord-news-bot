import fs from 'node:fs/promises';
import path from 'node:path';

import { parseCsvList } from '../../utils/env';
import {
  LLM_PROVIDER_FALLBACK_CHAIN_RAW,
  LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW,
  LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED,
  LLM_PROVIDER_POLICY_ACTIONS_RAW,
  ACTION_POLICY_DEFAULT_ENABLED,
  ACTION_POLICY_DEFAULT_RUN_MODE,
  ACTION_POLICY_FAIL_OPEN_ON_ERROR,
  ACTION_ALLOWED_ACTIONS,
} from '../../config';
import { getOpencodeExecutionSummary } from '../opencode/opencodeOpsService';
import { getGuildActionPolicy, listActionApprovalRequests, listGuildActionPolicies } from '../skills/actionGovernanceStore';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getWorkerApprovalStoreSnapshot, listApprovals } from '../workerGeneration/workerApprovalStore';

type ProviderPolicyBinding = {
  pattern: string;
  providers: string[];
};

type GateDecisionSnapshot = {
  file: string;
  runId: string;
  stage: string;
  scope: string;
  overall: string;
  startedAt: string | null;
  endedAt: string | null;
  providerProfileFallbackRequired: boolean | null;
  providerProfileTarget: string | null;
  providerProfileTrigger: string | null;
  safety: {
    verdict: string | null;
    approvalRequiredCompliancePct: number | null;
    unapprovedAutodeployCount: number | null;
    policyViolationCount: number | null;
    privacyBlockCount: number | null;
  };
};

type RuntimeLoopEvidenceSummary = {
  runsWithEvidence: number | null;
  completeRuns: number | null;
  incompleteRuns: number | null;
  missingRuns: number | null;
  completionRate: number | null;
  source: string;
};

type SafetySignalSummary = {
  approvalRequiredCompliancePct: number | null;
  unapprovedAutodeployCount: number | null;
  policyViolationCount: number | null;
  privacyBlockCount: number | null;
  source: {
    approvalRequiredCompliancePct: string;
    unapprovedAutodeployCount: string;
    policyViolationCount: string;
    privacyBlockCount: string;
  };
};

type SandboxDelegationEvidence = {
  windowDays: number;
  since: string;
  source: string;
  totalLogRows: number;
  relevantExecutions: number;
  completeDelegationExecutions: number;
  missingDelegationExecutions: number;
  opendevEvidenceCount: number;
  nemoclawEvidenceCount: number;
  releaseEvidenceCount: number;
  opendevToNemoclawHandoffCount: number;
  complete: boolean | null;
  recentDelegations: Array<{
    actionName: string;
    status: string;
    createdAt: string;
    handoff: string | null;
    evidenceIds: string[];
    complete: boolean;
  }>;
};

const GATE_RUNS_DIR = path.join(process.cwd(), 'docs', 'planning', 'gate-runs');
const WEEKLY_SUMMARY_PATH = path.join(GATE_RUNS_DIR, 'WEEKLY_SUMMARY.md');
const SANDBOX_EVIDENCE_WINDOW_DAYS = 14;
const SANDBOX_EVIDENCE_MAX_ROWS = 2000;
const OPENCODE_ACTION_NAME = 'opencode.execute';

const toMaskedRuntimePath = (value: string): string => {
  const relative = path.relative(process.cwd(), value).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..') || /^[A-Za-z]:/.test(relative)) {
    return `.runtime/${path.basename(value)}`;
  }
  return relative;
};

const parseProviderList = (raw: string): string[] => {
  const seen = new Set<string>();
  return String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
};

const parseProviderPolicyBindings = (raw: string): ProviderPolicyBinding[] => {
  return String(raw || '')
    .split(/[;\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex < 1) {
        return null;
      }
      const pattern = line.slice(0, separatorIndex).trim().toLowerCase();
      const providers = parseProviderList(line.slice(separatorIndex + 1));
      if (!pattern || providers.length === 0) {
        return null;
      }
      return { pattern, providers };
    })
    .filter((item): item is ProviderPolicyBinding => Boolean(item));
};

const toNumberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseWeeklySummaryNumber = (content: string, label: string): number | null => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^- ${escaped}:\\s*(.+)$`, 'm'));
  if (!match) {
    return null;
  }
  const raw = String(match[1] || '').trim();
  if (!raw || raw.toLowerCase() === 'n/a') {
    return null;
  }
  return toNumberOrNull(raw);
};

const countErrorCodes = (topErrors: Array<{ code: string; count: number }>, matcher: (code: string) => boolean): number => {
  return topErrors.reduce((sum, entry) => {
    const code = String(entry?.code || '').trim().toUpperCase();
    if (!code || !matcher(code)) {
      return sum;
    }
    const count = Number(entry?.count || 0);
    return sum + (Number.isFinite(count) ? count : 0);
  }, 0);
};

const buildSafetySignals = (params: {
  runMode: string;
  enabled: boolean;
  topErrors: Array<{ code: string; count: number }>;
  successExecutions: number;
  latestGateDecision: GateDecisionSnapshot | null;
}): SafetySignalSummary => {
  const runMode = String(params.runMode || '').trim();
  const policyUnavailableCount = countErrorCodes(
    params.topErrors,
    (code) => code === 'ACTION_POLICY_UNAVAILABLE',
  );
  const privacyBlockCount = countErrorCodes(
    params.topErrors,
    (code) => code.startsWith('PRIVACY_'),
  );
  const policyModeViolation = params.enabled && runMode !== 'approval_required' ? 1 : 0;

  let approvalRequiredCompliancePct: number | null = null;
  let unapprovedAutodeployCount: number | null = null;
  if (runMode === 'approval_required') {
    approvalRequiredCompliancePct = 100;
    unapprovedAutodeployCount = 0;
  } else if (runMode === 'auto') {
    approvalRequiredCompliancePct = 0;
    unapprovedAutodeployCount = Math.max(0, params.successExecutions);
  } else if (runMode === 'disabled') {
    approvalRequiredCompliancePct = params.successExecutions > 0 ? 0 : 100;
    unapprovedAutodeployCount = Math.max(0, params.successExecutions);
  } else if (!params.enabled) {
    approvalRequiredCompliancePct = params.successExecutions > 0 ? 0 : 100;
    unapprovedAutodeployCount = Math.max(0, params.successExecutions);
  }

  return {
    approvalRequiredCompliancePct,
    unapprovedAutodeployCount,
    policyViolationCount: policyUnavailableCount + policyModeViolation,
    privacyBlockCount: privacyBlockCount > 0
      ? privacyBlockCount
      : params.latestGateDecision?.safety.privacyBlockCount ?? 0,
    source: {
      approvalRequiredCompliancePct: 'live_policy_mode',
      unapprovedAutodeployCount: 'live_opencode_execution_summary',
      policyViolationCount: 'live_opencode_error_codes+policy_mode',
      privacyBlockCount: privacyBlockCount > 0 ? 'live_opencode_error_codes' : 'latest_gate_fallback',
    },
  };
};

const parseDelegationMarkers = (verification: unknown): {
  relevant: boolean;
  complete: boolean;
  handoff: string | null;
  evidenceIds: string[];
  hasOpendevEvidence: boolean;
  hasNemoclawEvidence: boolean;
  hasReleaseEvidence: boolean;
  hasOpendevToNemoclawHandoff: boolean;
} => {
  const lines = Array.isArray(verification)
    ? verification.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const handoff = lines.find((line) => line.startsWith('handoff=')) || null;
  const evidenceIds = lines
    .filter((line) => line.startsWith('handoff_evidence='))
    .map((line) => line.slice('handoff_evidence='.length).trim())
    .filter(Boolean);
  const hasOpendevEvidence = evidenceIds.some((item) => item.startsWith('opendev:') || item.startsWith('opendev-release:'));
  const hasNemoclawEvidence = evidenceIds.some((item) => item.startsWith('nemoclaw:'));
  const hasReleaseEvidence = evidenceIds.some((item) => item.startsWith('opendev-release:'));
  const hasOpendevToNemoclawHandoff = handoff === 'handoff=opendev->nemoclaw';
  const relevant = hasOpendevEvidence || hasNemoclawEvidence || hasReleaseEvidence || hasOpendevToNemoclawHandoff;
  const complete = hasOpendevToNemoclawHandoff || (hasOpendevEvidence && hasNemoclawEvidence);

  return {
    relevant,
    complete,
    handoff,
    evidenceIds,
    hasOpendevEvidence,
    hasNemoclawEvidence,
    hasReleaseEvidence,
    hasOpendevToNemoclawHandoff,
  };
};

const readSandboxDelegationEvidence = async (params: {
  guildId: string;
  recentLimit: number;
}): Promise<SandboxDelegationEvidence> => {
  const since = new Date(Date.now() - SANDBOX_EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  if (!isSupabaseConfigured()) {
    return {
      windowDays: SANDBOX_EVIDENCE_WINDOW_DAYS,
      since,
      source: 'supabase_not_configured',
      totalLogRows: 0,
      relevantExecutions: 0,
      completeDelegationExecutions: 0,
      missingDelegationExecutions: 0,
      opendevEvidenceCount: 0,
      nemoclawEvidenceCount: 0,
      releaseEvidenceCount: 0,
      opendevToNemoclawHandoffCount: 0,
      complete: null,
      recentDelegations: [],
    };
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_action_logs')
    .select('action_name,status,verification,created_at')
    .eq('guild_id', params.guildId)
    .eq('action_name', OPENCODE_ACTION_NAME)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(SANDBOX_EVIDENCE_MAX_ROWS);

  if (error) {
    throw new Error(error.message || 'SANDBOX_DELEGATION_QUERY_FAILED');
  }

  const rows = Array.isArray(data) ? data : [];
  const parsedRows = rows.map((row) => {
    const markers = parseDelegationMarkers((row as Record<string, unknown>).verification);
    return {
      actionName: String((row as Record<string, unknown>).action_name || '').trim() || OPENCODE_ACTION_NAME,
      status: String((row as Record<string, unknown>).status || '').trim() || 'unknown',
      createdAt: String((row as Record<string, unknown>).created_at || '').trim(),
      ...markers,
    };
  });
  const relevantRows = parsedRows.filter((row) => row.relevant);
  const completeRows = relevantRows.filter((row) => row.complete);

  return {
    windowDays: SANDBOX_EVIDENCE_WINDOW_DAYS,
    since,
    source: 'supabase_agent_action_logs',
    totalLogRows: rows.length,
    relevantExecutions: relevantRows.length,
    completeDelegationExecutions: completeRows.length,
    missingDelegationExecutions: Math.max(0, relevantRows.length - completeRows.length),
    opendevEvidenceCount: relevantRows.filter((row) => row.hasOpendevEvidence).length,
    nemoclawEvidenceCount: relevantRows.filter((row) => row.hasNemoclawEvidence).length,
    releaseEvidenceCount: relevantRows.filter((row) => row.hasReleaseEvidence).length,
    opendevToNemoclawHandoffCount: relevantRows.filter((row) => row.hasOpendevToNemoclawHandoff).length,
    complete: relevantRows.length > 0 ? completeRows.length === relevantRows.length : true,
    recentDelegations: relevantRows.slice(0, params.recentLimit).map((row) => ({
      actionName: row.actionName,
      status: row.status,
      createdAt: row.createdAt,
      handoff: row.handoff,
      evidenceIds: row.evidenceIds,
      complete: row.complete,
    })),
  };
};

const readRuntimeLoopEvidenceSummary = async (): Promise<RuntimeLoopEvidenceSummary | null> => {
  try {
    const content = await fs.readFile(WEEKLY_SUMMARY_PATH, 'utf8');
    return {
      runsWithEvidence: parseWeeklySummaryNumber(content, 'runs_with_evidence'),
      completeRuns: parseWeeklySummaryNumber(content, 'complete_runs'),
      incompleteRuns: parseWeeklySummaryNumber(content, 'incomplete_runs'),
      missingRuns: parseWeeklySummaryNumber(content, 'missing_runs'),
      completionRate: parseWeeklySummaryNumber(content, 'completion_rate'),
      source: path.relative(process.cwd(), WEEKLY_SUMMARY_PATH).replace(/\\/g, '/'),
    };
  } catch {
    return null;
  }
};

const readLatestGateDecision = async (): Promise<GateDecisionSnapshot | null> => {
  try {
    const entries = await fs.readdir(GATE_RUNS_DIR, { withFileTypes: true });
    const jsonFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name);

    let latest: GateDecisionSnapshot | null = null;
    let latestEndedAtMs = Number.NEGATIVE_INFINITY;

    for (const name of jsonFiles) {
      try {
        const absolutePath = path.join(GATE_RUNS_DIR, name);
        const raw = await fs.readFile(absolutePath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, any>;
        const finalDecision = parsed.final_decision && typeof parsed.final_decision === 'object'
          ? parsed.final_decision as Record<string, any>
          : null;
        const gates = parsed.gates && typeof parsed.gates === 'object'
          ? parsed.gates as Record<string, any>
          : null;
        const safety = gates?.safety && typeof gates.safety === 'object'
          ? gates.safety as Record<string, any>
          : null;
        const safetyMetrics = safety?.metrics && typeof safety.metrics === 'object'
          ? safety.metrics as Record<string, any>
          : {};
        const endedAt = String(parsed.ended_at || '').trim() || null;
        const endedAtMs = endedAt ? Date.parse(endedAt) : Number.NaN;
        if (!Number.isFinite(endedAtMs) || !finalDecision) {
          continue;
        }

        if (endedAtMs <= latestEndedAtMs) {
          continue;
        }

        latestEndedAtMs = endedAtMs;
        latest = {
          file: path.join('docs', 'planning', 'gate-runs', name).replace(/\\/g, '/'),
          runId: String(parsed.run_id || '').trim(),
          stage: String(parsed.stage || '').trim(),
          scope: String(parsed.target_scope || '').trim(),
          overall: String(finalDecision.overall || '').trim(),
          startedAt: String(parsed.started_at || '').trim() || null,
          endedAt,
          providerProfileFallbackRequired: typeof finalDecision.provider_profile_fallback_required === 'boolean'
            ? finalDecision.provider_profile_fallback_required
            : null,
          providerProfileTarget: String(finalDecision.provider_profile_target || '').trim() || null,
          providerProfileTrigger: String(finalDecision.provider_profile_trigger || '').trim() || null,
          safety: {
            verdict: String(safety?.verdict || '').trim() || null,
            approvalRequiredCompliancePct: toNumberOrNull(safetyMetrics.approval_required_compliance_pct),
            unapprovedAutodeployCount: toNumberOrNull(safetyMetrics.unapproved_autodeploy_count),
            policyViolationCount: toNumberOrNull(safetyMetrics.policy_violation_count),
            privacyBlockCount: toNumberOrNull(safetyMetrics.privacy_block_count),
          },
        };
      } catch {
        // Skip malformed historical records.
      }
    }

    return latest;
  } catch {
    return null;
  }
};

export const buildWorkerApprovalGateSnapshot = async (params: {
  guildId: string;
  recentLimit?: number;
}) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const recentLimit = Math.max(1, Math.min(20, Math.trunc(Number(params.recentLimit || 5))));

  const [
    workerStore,
    approvals,
    opencodePolicy,
    guildPolicies,
    approvalRequests,
    opencodeSummary,
    latestGateDecision,
    runtimeLoopEvidence,
    delegationEvidence,
  ] = await Promise.all([
    getWorkerApprovalStoreSnapshot(),
    listApprovals({ status: 'all' }),
    getGuildActionPolicy(guildId, 'opencode.execute'),
    listGuildActionPolicies(guildId),
    listActionApprovalRequests({ guildId, limit: recentLimit }),
    getOpencodeExecutionSummary({ guildId, days: SANDBOX_EVIDENCE_WINDOW_DAYS }),
    readLatestGateDecision(),
    readRuntimeLoopEvidenceSummary(),
    readSandboxDelegationEvidence({ guildId, recentLimit }),
  ]);

  const guildApprovals = approvals.filter((entry) => entry.guildId === guildId);
  const recentWorkerDecisions = guildApprovals
    .filter((entry) => entry.status !== 'pending')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, recentLimit)
    .map((entry) => ({
      id: entry.id,
      actionName: entry.actionName,
      goal: entry.goal,
      status: entry.status,
      validationPassed: entry.validationPassed,
      discoverEvidenceId: entry.discoverEvidenceId || null,
      verifyEvidenceId: entry.verifyEvidenceId || null,
      releaseEvidenceId: entry.releaseEvidenceId || null,
      approvedAt: entry.approvedAt || null,
      approvedBy: entry.approvedBy || null,
      updatedAt: entry.updatedAt,
    }));

  const recentActionApprovals = approvalRequests.slice(0, recentLimit).map((entry) => ({
    id: entry.id,
    actionName: entry.actionName,
    status: entry.status,
    requestedBy: entry.requestedBy,
    approvedBy: entry.approvedBy,
    approvedAt: entry.approvedAt,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  }));

  const actionPolicyDefaultEnabled = ACTION_POLICY_DEFAULT_ENABLED;
  const actionPolicyDefaultRunModeRaw = ACTION_POLICY_DEFAULT_RUN_MODE;
  // Cast to `readonly string[]` so `.includes()` accepts the runtime string; the ternary enforces the fallback.
  const actionPolicyDefaultRunMode = (['auto', 'approval_required', 'disabled'] as readonly string[]).includes(
    actionPolicyDefaultRunModeRaw,
  )
    ? actionPolicyDefaultRunModeRaw
    : 'approval_required';
  const actionPolicyFailOpenOnError = ACTION_POLICY_FAIL_OPEN_ON_ERROR;
  const actionAllowedActionsRaw = ACTION_ALLOWED_ACTIONS;
  const automaticFallbackEnabled = LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED;
  const providerPolicyBindings = parseProviderPolicyBindings(LLM_PROVIDER_POLICY_ACTIONS_RAW);
  const filePath = workerStore.activeBackend === 'file'
    ? toMaskedRuntimePath(workerStore.filePath)
    : null;
  const topErrors = Array.isArray(opencodeSummary.executions.topErrors)
    ? opencodeSummary.executions.topErrors
    : [];
  const safetySignals = buildSafetySignals({
    runMode: opencodePolicy.runMode,
    enabled: opencodePolicy.enabled,
    topErrors,
    successExecutions: Number(opencodeSummary.executions.success || 0),
    latestGateDecision,
  });

  return {
    guildId,
    generatedAt: new Date().toISOString(),
    workerApprovals: {
      configuredMode: workerStore.configuredMode,
      activeBackend: workerStore.activeBackend,
      supabaseConfigured: workerStore.supabaseConfigured,
      supabaseDisabled: workerStore.supabaseDisabled,
      dbTable: workerStore.dbTable,
      filePath,
      loaded: workerStore.loaded,
      totalApprovals: guildApprovals.length,
      pendingApprovals: guildApprovals.filter((entry) => entry.status === 'pending').length,
      approvedApprovals: guildApprovals.filter((entry) => entry.status === 'approved').length,
      rejectedApprovals: guildApprovals.filter((entry) => entry.status === 'rejected').length,
      refactorRequestedApprovals: guildApprovals.filter((entry) => entry.status === 'refactor_requested').length,
      recentDecisions: recentWorkerDecisions,
      lastError: workerStore.lastError,
    },
    policyBindings: {
      actionPolicyDefaultEnabled,
      actionPolicyDefaultRunMode,
      actionPolicyFailOpenOnError,
      actionAllowedActions: actionAllowedActionsRaw === '*'
        ? ['*']
        : parseCsvList(actionAllowedActionsRaw),
      opencodeExecutePolicy: {
        actionName: opencodePolicy.actionName,
        enabled: opencodePolicy.enabled,
        runMode: opencodePolicy.runMode,
        updatedAt: opencodePolicy.updatedAt,
        updatedBy: opencodePolicy.updatedBy,
      },
      guildPolicies: guildPolicies.slice(0, 20).map((policy) => ({
        actionName: policy.actionName,
        enabled: policy.enabled,
        runMode: policy.runMode,
        updatedAt: policy.updatedAt,
        updatedBy: policy.updatedBy,
      })),
      recentActionApprovals,
    },
    modelFallback: {
      automaticFallbackEnabled,
      defaultProviderFallbackChain: parseProviderList(LLM_PROVIDER_FALLBACK_CHAIN_RAW),
      automaticFallbackOrder: parseProviderList(LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW),
      providerPolicyBindings,
    },
    safetySignals,
    delegationEvidence,
    globalArtifacts: {
      latestGateDecision,
      runtimeLoopEvidence,
      recommendedProfileFromLatestGate: latestGateDecision?.providerProfileTarget || 'keep-current',
      recommendedTriggerFromLatestGate: latestGateDecision?.providerProfileTrigger || 'none',
    },
  };
};