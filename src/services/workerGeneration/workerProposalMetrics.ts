type WorkerProposalMetricsState = {
  startedAt: string;
  lastUpdatedAt: string | null;
  proposalClicks: number;
  generationRequested: number;
  generationSucceeded: number;
  generationFailed: number;
  approvalsApproved: number;
  approvalsRejected: number;
  approvalsRefactorRequested: number;
  generationFailureReasonCounts: Record<string, number>;
  history: Array<{
    at: string;
    proposalClicks: number;
    generationRequested: number;
    generationSucceeded: number;
    generationFailed: number;
    approvalsApproved: number;
    approvalsRejected: number;
    approvalsRefactorRequested: number;
  }>;
};

export type WorkerProposalMetricsSnapshot = WorkerProposalMetricsState & {
  generationSuccessRate: number;
  approvalDecisionRate: number;
  approvalPassRate: number;
  topGenerationFailureReasons: Array<{
    reason: string;
    count: number;
    share: number;
  }>;
};

const nowIso = () => new Date().toISOString();

const state: WorkerProposalMetricsState = {
  startedAt: nowIso(),
  lastUpdatedAt: null,
  proposalClicks: 0,
  generationRequested: 0,
  generationSucceeded: 0,
  generationFailed: 0,
  approvalsApproved: 0,
  approvalsRejected: 0,
  approvalsRefactorRequested: 0,
  generationFailureReasonCounts: {},
  history: [],
};

const HISTORY_MAX = 30;

const round = (value: number): number => Number(value.toFixed(4));

const normalizeFailureReason = (reason: string | undefined): string => {
  const text = String(reason || '').trim();
  if (!text) {
    return 'unknown';
  }
  if (text.includes('코드 생성 실패')) {
    return 'llm_generation_failed';
  }
  if (text.includes('샌드박스 저장 실패')) {
    return 'sandbox_write_failed';
  }
  return text.toLowerCase().replace(/\s+/g, '_').slice(0, 64);
};

const appendHistory = () => {
  state.history.push({
    at: state.lastUpdatedAt || nowIso(),
    proposalClicks: state.proposalClicks,
    generationRequested: state.generationRequested,
    generationSucceeded: state.generationSucceeded,
    generationFailed: state.generationFailed,
    approvalsApproved: state.approvalsApproved,
    approvalsRejected: state.approvalsRejected,
    approvalsRefactorRequested: state.approvalsRefactorRequested,
  });
  while (state.history.length > HISTORY_MAX) {
    state.history.shift();
  }
};

const touch = () => {
  state.lastUpdatedAt = nowIso();
  appendHistory();
};

export const recordWorkerProposalClick = () => {
  state.proposalClicks += 1;
  touch();
};

export const recordWorkerGenerationResult = (ok: boolean, failureReason?: string) => {
  state.generationRequested += 1;
  if (ok) {
    state.generationSucceeded += 1;
  } else {
    state.generationFailed += 1;
    const key = normalizeFailureReason(failureReason);
    state.generationFailureReasonCounts[key] = (state.generationFailureReasonCounts[key] || 0) + 1;
  }
  touch();
};

export const recordWorkerApprovalDecision = (decision: 'approved' | 'rejected' | 'refactor_requested') => {
  if (decision === 'approved') {
    state.approvalsApproved += 1;
  } else if (decision === 'rejected') {
    state.approvalsRejected += 1;
  } else {
    state.approvalsRefactorRequested += 1;
  }
  touch();
};

export const getWorkerProposalMetricsSnapshot = (): WorkerProposalMetricsSnapshot => {
  const generationSuccessRate = state.generationRequested > 0
    ? state.generationSucceeded / state.generationRequested
    : 0;
  const decisionTotal = state.approvalsApproved + state.approvalsRejected + state.approvalsRefactorRequested;
  const approvalDecisionRate = state.generationSucceeded > 0
    ? decisionTotal / state.generationSucceeded
    : 0;
  const approvalDenominator = state.approvalsApproved + state.approvalsRejected;
  const approvalPassRate = approvalDenominator > 0
    ? state.approvalsApproved / approvalDenominator
    : 0;
  const topGenerationFailureReasons = Object.entries(state.generationFailureReasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({
      reason,
      count,
      share: round(count / Math.max(1, state.generationFailed)),
    }));

  return {
    ...state,
    history: state.history.map((item) => ({ ...item })),
    generationFailureReasonCounts: { ...state.generationFailureReasonCounts },
    generationSuccessRate: round(generationSuccessRate),
    approvalDecisionRate: round(approvalDecisionRate),
    approvalPassRate: round(approvalPassRate),
    topGenerationFailureReasons,
  };
};
