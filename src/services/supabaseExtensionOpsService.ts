import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type SupabaseExtensionStatusItem = {
  extensionName: string;
  installed: boolean;
  recommendedUse: string;
};

export type SupabasePgStatementTopItem = {
  query: string;
  calls: number;
  totalExecTime: number;
  meanExecTime: number;
  rows: number;
  sharedBlksHit: number;
  sharedBlksRead: number;
};

export type SupabaseExtensionOpsSnapshot = {
  ready: boolean;
  extensions: SupabaseExtensionStatusItem[];
  topQueries: SupabasePgStatementTopItem[];
  notes: string[];
};

export type SupabaseCronJobItem = {
  jobId: number;
  jobName: string;
  schedule: string;
  command: string;
  active: boolean;
};

export type HypoPgCandidate = {
  indexName: string;
  ddl: string;
  tableName: string;
  rationale: string;
};

export type HypoPgEvaluationItem = {
  ddl: string;
  indexRelId: number | null;
  estimatedSizeBytes: number | null;
  status: string;
  message: string;
};

const RECOMMENDED_USE: Record<string, string> = {
  pgvector: 'hybrid retrieval: semantic similarity for memory_items/guild_lore_docs',
  pg_trgm: 'fuzzy search and typo-tolerant matching for korean/english mixed queries',
  pg_cron: 'database-side scheduler for periodic jobs and consistency',
  pg_net: 'database-side webhook/http callbacks for automation signals',
  pg_graphql: 'read-side operational APIs with low backend coupling',
  hypopg: 'hypothetical index simulation before expensive index builds',
  pg_stat_statements: 'query performance profiling and top-SQL bottleneck tracking',
};

const toBool = (value: unknown): boolean => value === true || value === 'true' || value === 1;
const toNum = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const getSupabaseExtensionOpsSnapshot = async (params?: {
  includeTopQueries?: boolean;
  topLimit?: number;
}): Promise<SupabaseExtensionOpsSnapshot> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const includeTopQueries = params?.includeTopQueries !== false;
  const topLimit = Math.max(1, Math.min(50, Math.trunc(Number(params?.topLimit || 10))));

  const client = getSupabaseClient();

  const { data: extensionRows, error: extensionError } = await client.rpc('get_platform_extension_status');
  if (extensionError) {
    throw new Error(extensionError.message || 'EXTENSION_STATUS_RPC_FAILED');
  }

  const extensions = ((extensionRows || []) as Array<Record<string, unknown>>)
    .map((row) => {
      const extensionName = String(row.extension_name || '').trim();
      if (!extensionName) return null;
      return {
        extensionName,
        installed: toBool(row.installed),
        recommendedUse: RECOMMENDED_USE[extensionName] || 'no recommendation registered',
      } as SupabaseExtensionStatusItem;
    })
    .filter((item): item is SupabaseExtensionStatusItem => Boolean(item));

  const installedNames = new Set(extensions.filter((item) => item.installed).map((item) => item.extensionName));
  const notes: string[] = [];

  if (installedNames.has('pgvector') && installedNames.has('pg_trgm')) {
    notes.push('Hybrid retrieval path is available: combine vector and trgm matching.');
  }
  if (installedNames.has('pg_cron')) {
    notes.push('DB-native scheduling is available; migrate timer loops to cron jobs incrementally.');
  }
  if (installedNames.has('pg_stat_statements') && installedNames.has('hypopg')) {
    notes.push('Query tuning loop is available: inspect top SQL then test hypothetical indexes before build.');
  }

  let topQueries: SupabasePgStatementTopItem[] = [];
  if (includeTopQueries && installedNames.has('pg_stat_statements')) {
    const { data: topRows, error: topError } = await client.rpc('get_platform_pg_statements_top', {
      p_limit: topLimit,
    });
    if (topError) {
      notes.push(`pg_stat_statements top query read failed: ${topError.message || 'unknown_error'}`);
    } else {
      topQueries = ((topRows || []) as Array<Record<string, unknown>>).map((row) => ({
        query: String(row.query || '').slice(0, 500),
        calls: Math.max(0, Math.trunc(toNum(row.calls))),
        totalExecTime: Number(toNum(row.total_exec_time).toFixed(3)),
        meanExecTime: Number(toNum(row.mean_exec_time).toFixed(3)),
        rows: Math.max(0, Math.trunc(toNum(row.rows))),
        sharedBlksHit: Math.max(0, Math.trunc(toNum(row.shared_blks_hit))),
        sharedBlksRead: Math.max(0, Math.trunc(toNum(row.shared_blks_read))),
      }));
    }
  }

  return {
    ready: true,
    extensions,
    topQueries,
    notes,
  };
};

export const ensureSupabaseMaintenanceCronJobs = async (params?: {
  llmRetentionDays?: number;
}): Promise<Array<{ jobName: string; installed: boolean; schedule: string }>> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const retentionDays = Math.max(1, Math.min(365, Math.trunc(Number(params?.llmRetentionDays || 30))));
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('ensure_platform_maintenance_cron', {
    p_llm_retention_days: retentionDays,
  });
  if (error) {
    throw new Error(error.message || 'ENSURE_PLATFORM_MAINTENANCE_CRON_FAILED');
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    jobName: String(row.job_name || '').trim(),
    installed: toBool(row.installed),
    schedule: String(row.schedule || '').trim(),
  }));
};

export const listSupabaseCronJobs = async (): Promise<SupabaseCronJobItem[]> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_platform_cron_jobs');
  if (error) {
    throw new Error(error.message || 'GET_PLATFORM_CRON_JOBS_FAILED');
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    jobId: Math.max(0, Math.trunc(toNum(row.jobid))),
    jobName: String(row.jobname || '').trim(),
    schedule: String(row.schedule || '').trim(),
    command: String(row.command || '').trim(),
    active: toBool(row.active),
  }));
};

export const getHypoPgCandidates = async (): Promise<HypoPgCandidate[]> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_platform_hypopg_candidates');
  if (error) {
    throw new Error(error.message || 'GET_PLATFORM_HYPOPG_CANDIDATES_FAILED');
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    indexName: String(row.index_name || '').trim(),
    ddl: String(row.ddl || '').trim(),
    tableName: String(row.table_name || '').trim(),
    rationale: String(row.rationale || '').trim(),
  }));
};

export const evaluateHypoPgIndexes = async (indexDdls: string[]): Promise<HypoPgEvaluationItem[]> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const sanitizedDdls = (indexDdls || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (sanitizedDdls.length === 0) {
    return [];
  }

  const client = getSupabaseClient();
  const { data, error } = await client.rpc('evaluate_platform_hypothetical_indexes', {
    p_index_ddls: sanitizedDdls,
  });
  if (error) {
    throw new Error(error.message || 'EVALUATE_PLATFORM_HYPOTHETICAL_INDEXES_FAILED');
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    ddl: String(row.ddl || '').trim(),
    indexRelId: Number.isFinite(Number(row.indexrelid)) ? Number(row.indexrelid) : null,
    estimatedSizeBytes: Number.isFinite(Number(row.estimated_size_bytes)) ? Number(row.estimated_size_bytes) : null,
    status: String(row.status || '').trim() || 'unknown',
    message: String(row.message || '').trim(),
  }));
};
