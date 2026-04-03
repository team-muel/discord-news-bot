// Barrel export — Infrastructure services
// Usage: import { withSupabase, compilePromptGoal } from './infra';

export { getClient, withSupabase, normalizeDbError } from './baseRepository';
export type { RepositoryResult } from './baseRepository';

export { acquireDistributedLease, releaseDistributedLease } from './distributedLockService';

export { compilePromptGoal } from './promptCompiler';
export type { PromptCompileResult } from './promptCompiler';

export {
  getSupabaseExtensionOpsSnapshot, ensureSupabaseMaintenanceCronJobs,
  listSupabaseCronJobs, getHypoPgCandidates, evaluateHypoPgIndexes,
} from './supabaseExtensionOpsService';
export type {
  SupabaseExtensionStatusItem, SupabasePgStatementTopItem,
  SupabaseExtensionOpsSnapshot, SupabaseCronJobItem,
  HypoPgCandidate, HypoPgEvaluationItem,
} from './supabaseExtensionOpsService';

export { consumeSupabaseRateLimit } from './supabaseRateLimitService';
