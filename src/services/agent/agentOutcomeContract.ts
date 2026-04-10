import { findActionReflectionArtifact, type ActionExecutionResult, type ActionReflectionArtifact } from '../skills/actions/types';

export type AgentOutcomeState = 'success' | 'degraded' | 'failure';

export type AgentOutcome = {
  state: AgentOutcomeState;
  code: string;
  summary: string;
  retryable: boolean;
  confidence: 'high' | 'medium' | 'low';
  score?: number;
  reasons?: string[];
  evidenceBundleId?: string;
  reflection?: ActionReflectionArtifact;
};

const DEGRADED_ERROR_CODES = new Set([
  'UNVERIFIED_CONTENT',
  'YOUTUBE_WORKER_UNAVAILABLE',
  'ACTION_TIMEOUT',
  'WEB_FETCH_FAILED',
]);

const RETRYABLE_ERROR_PREFIXES = ['HTTP_5', 'MCP_', 'WORKER_', 'ACTION_TIMEOUT'];

const normalizeCode = (errorCode: string | undefined): string => {
  const code = String(errorCode || '').trim().toUpperCase();
  return code || 'UNKNOWN';
};

const isRetryableError = (errorCode: string): boolean => {
  if (!errorCode || errorCode === 'UNKNOWN') {
    return false;
  }
  return RETRYABLE_ERROR_PREFIXES.some((prefix) => errorCode.startsWith(prefix) || errorCode.includes(prefix));
};

export const toAgentOutcome = (result: ActionExecutionResult): AgentOutcome => {
  const code = normalizeCode(result.error);
  const summary = String(result.summary || '').trim() || 'no summary';
  const reflection = findActionReflectionArtifact(result.artifacts || []);

  if (result.ok) {
    return {
      state: 'success',
      code: 'OK',
      summary,
      retryable: false,
      confidence: 'high',
      reflection: reflection || undefined,
    };
  }

  const degraded = DEGRADED_ERROR_CODES.has(code);
  return {
    state: degraded ? 'degraded' : 'failure',
    code,
    summary,
    retryable: isRetryableError(code),
    confidence: degraded ? 'medium' : 'low',
    reflection: reflection || undefined,
  };
};
