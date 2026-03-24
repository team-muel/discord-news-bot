import { validateSandboxCode } from './workerSandbox';
import type { PendingWorkerApproval } from './workerApprovalStore';

export type WorkerRiskLevel = 'low' | 'medium' | 'high';

export type NemoClawDiscoverResult = {
  ok: boolean;
  stage: 'discover';
  actionName: string;
  riskLevel: WorkerRiskLevel;
  validationErrors: string[];
  validationWarnings: string[];
  evidenceId: string;
};

export type ArchitectVerifyResult = {
  ok: boolean;
  stage: 'verify';
  releaseEligible: boolean;
  approvalRequired: boolean;
  reasons: string[];
  evidenceId: string;
};

/** @deprecated Use ArchitectVerifyResult */
export type OpenDevVerifyResult = ArchitectVerifyResult;

const normalizeGoal = (goal: string): string => String(goal || '').toLowerCase();

const inferRiskLevel = (goal: string): WorkerRiskLevel => {
  const normalized = normalizeGoal(goal);
  if (/(deploy|release|production|rollback|delete|remove|drop|payment|billing|admin)/i.test(normalized)) {
    return 'high';
  }
  if (/(write|update|modify|integration|api|sync)/i.test(normalized)) {
    return 'medium';
  }
  return 'low';
};

export const runNemoClawDiscoverExecutor = (params: {
  goal: string;
  actionName: string;
  code: string;
}): NemoClawDiscoverResult => {
  const validation = validateSandboxCode(params.code);
  const riskLevel = inferRiskLevel(params.goal);

  return {
    ok: validation.ok,
    stage: 'discover',
    actionName: params.actionName,
    riskLevel,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
    evidenceId: `nemoclaw:${params.actionName}`,
  };
};

export const runArchitectVerifyExecutor = (params: {
  discover: NemoClawDiscoverResult;
  requestedBy: string;
}): ArchitectVerifyResult => {
  const reasons: string[] = [];
  let releaseEligible = true;

  if (!params.discover.ok) {
    releaseEligible = false;
    reasons.push('discover validation failed');
  }

  const approvalRequired = params.discover.riskLevel !== 'low';
  if (approvalRequired) {
    reasons.push(`approval required by risk level: ${params.discover.riskLevel}`);
  }

  if (!params.requestedBy) {
    releaseEligible = false;
    reasons.push('requestedBy is required');
  }

  return {
    ok: releaseEligible,
    stage: 'verify',
    releaseEligible,
    approvalRequired,
    reasons,
    // Legacy evidence IDs preserved for backward compatibility with existing Supabase data
    evidenceId: `opendev:${params.discover.actionName}`,
  };
};

export const runArchitectReleaseGate = (params: {
  approval: PendingWorkerApproval;
  actorIsAdmin: boolean;
}): ArchitectVerifyResult => {
  const reasons: string[] = [];
  let releaseEligible = true;

  if (!params.actorIsAdmin) {
    releaseEligible = false;
    reasons.push('admin approval is required');
  }

  if (!params.approval.validationPassed) {
    releaseEligible = false;
    reasons.push('approval validationPassed=false');
  }

  if (!params.approval.generatedCode || !params.approval.actionName) {
    releaseEligible = false;
    reasons.push('approval evidence is incomplete');
  }

  if (!params.approval.adminMessageId) {
    reasons.push('admin message evidence missing');
  }

  return {
    ok: releaseEligible,
    stage: 'verify',
    releaseEligible,
    approvalRequired: true,
    reasons,
    // Legacy evidence ID preserved for backward compatibility with existing Supabase data
    evidenceId: `opendev-release:${params.approval.id}`,
  };
};

/** @deprecated Use runArchitectVerifyExecutor */
export const runOpenDevVerifyExecutor = runArchitectVerifyExecutor;
/** @deprecated Use runArchitectReleaseGate */
export const runOpenDevReleaseGate = runArchitectReleaseGate;
