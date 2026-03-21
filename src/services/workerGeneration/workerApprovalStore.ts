import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import logger from '../../logger';
import { parseIntegerEnv } from '../../utils/env';

export type WorkerApprovalStatus = 'pending' | 'approved' | 'rejected' | 'refactor_requested';

export type PendingWorkerApproval = {
  id: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  actionName: string;
  /** Generated worker code (.mjs format) */
  generatedCode: string;
  sandboxDir: string;
  sandboxFilePath: string;
  validationPassed: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  /** Discord message ID in admin channel */
  adminMessageId?: string;
  adminChannelId?: string;
  /** Discrete evidence IDs from pipeline stages */
  discoverEvidenceId?: string;
  verifyEvidenceId?: string;
  releaseEvidenceId?: string;
  /** Approval audit trail */
  approvedAt?: string;
  approvedBy?: string;
  status: WorkerApprovalStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkerApprovalStoreSnapshot = {
  configuredMode: 'auto' | 'supabase' | 'file';
  activeBackend: 'supabase' | 'file' | 'unknown';
  supabaseConfigured: boolean;
  supabaseDisabled: boolean;
  dbTable: string;
  filePath: string;
  loaded: boolean;
  totalApprovals: number;
  pendingApprovals: number;
  approvedApprovals: number;
  rejectedApprovals: number;
  lastError: string | null;
};

const MAX_APPROVALS = 200;
const store = new Map<string, PendingWorkerApproval>();
const APPROVAL_STORE_PATH = String(process.env.WORKER_APPROVAL_STORE_PATH || path.join(process.cwd(), '.runtime', 'worker-approvals.json')).trim();
const APPROVAL_STORE_MODE_RAW = String(process.env.WORKER_APPROVAL_STORE_MODE || 'auto').trim().toLowerCase();
const APPROVAL_STORE_MODE = APPROVAL_STORE_MODE_RAW === 'supabase' || APPROVAL_STORE_MODE_RAW === 'file'
  ? APPROVAL_STORE_MODE_RAW
  : 'auto';
const APPROVAL_DB_TABLE = String(process.env.WORKER_APPROVAL_DB_TABLE || 'worker_approvals').trim() || 'worker_approvals';
const WORKER_APPROVAL_SAVE_ERROR_LOG_THROTTLE_MS = Math.max(30_000, parseIntegerEnv(process.env.WORKER_APPROVAL_SAVE_ERROR_LOG_THROTTLE_MS, 5 * 60_000));
let loaded = false;
let saveChain: Promise<void> = Promise.resolve();
let supabaseStoreDisabled = false;
let activeBackend: 'supabase' | 'file' | 'unknown' = 'unknown';
let lastStoreError: string | null = null;
let lastSaveChainErrorLogAt = 0;

const now = (): string => new Date().toISOString();

const setStoreError = (error: unknown) => {
  lastStoreError = error instanceof Error
    ? error.message
    : String(error || 'unknown error');
};

const isMissingTableError = (error: any): boolean => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('worker_approvals')
    || message.includes(APPROVAL_DB_TABLE.toLowerCase());
};

const shouldUseSupabaseStore = (): boolean => {
  if (supabaseStoreDisabled) {
    return false;
  }
  if (APPROVAL_STORE_MODE === 'file') {
    return false;
  }
  if (!isSupabaseConfigured()) {
    return false;
  }
  return true;
};

const toDbRow = (entry: PendingWorkerApproval) => ({
  id: entry.id,
  guild_id: entry.guildId,
  requested_by: entry.requestedBy,
  goal: entry.goal,
  action_name: entry.actionName,
  generated_code: entry.generatedCode,
  sandbox_dir: entry.sandboxDir,
  sandbox_file_path: entry.sandboxFilePath,
  validation_passed: entry.validationPassed,
  validation_errors: entry.validationErrors,
  validation_warnings: entry.validationWarnings,
  admin_message_id: entry.adminMessageId || null,
  admin_channel_id: entry.adminChannelId || null,
  discover_evidence_id: entry.discoverEvidenceId || null,
  verify_evidence_id: entry.verifyEvidenceId || null,
  release_evidence_id: entry.releaseEvidenceId || null,
  approved_at: entry.approvedAt || null,
  approved_by: entry.approvedBy || null,
  status: entry.status,
  created_at: entry.createdAt,
  updated_at: entry.updatedAt,
});

const fromDbRow = (row: Record<string, unknown>): PendingWorkerApproval => ({
  id: String(row.id || ''),
  guildId: String(row.guild_id || ''),
  requestedBy: String(row.requested_by || ''),
  goal: String(row.goal || ''),
  actionName: String(row.action_name || ''),
  generatedCode: String(row.generated_code || ''),
  sandboxDir: String(row.sandbox_dir || ''),
  sandboxFilePath: String(row.sandbox_file_path || ''),
  validationPassed: Boolean(row.validation_passed),
  validationErrors: Array.isArray(row.validation_errors) ? row.validation_errors.map((v) => String(v || '')) : [],
  validationWarnings: Array.isArray(row.validation_warnings) ? row.validation_warnings.map((v) => String(v || '')) : [],
  adminMessageId: row.admin_message_id ? String(row.admin_message_id) : undefined,
  adminChannelId: row.admin_channel_id ? String(row.admin_channel_id) : undefined,
  discoverEvidenceId: row.discover_evidence_id ? String(row.discover_evidence_id) : undefined,
  verifyEvidenceId: row.verify_evidence_id ? String(row.verify_evidence_id) : undefined,
  releaseEvidenceId: row.release_evidence_id ? String(row.release_evidence_id) : undefined,
  approvedAt: row.approved_at ? String(row.approved_at) : undefined,
  approvedBy: row.approved_by ? String(row.approved_by) : undefined,
  status: (['pending', 'approved', 'rejected', 'refactor_requested'].includes(String(row.status || ''))
    ? String(row.status)
    : 'pending') as WorkerApprovalStatus,
  createdAt: String(row.created_at || now()),
  updatedAt: String(row.updated_at || now()),
});

const toSafeEntry = (value: unknown): PendingWorkerApproval | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = String(row.id || '').trim();
  if (!id) {
    return null;
  }

  const statusRaw = String(row.status || 'pending').trim();
  const status: WorkerApprovalStatus = ['pending', 'approved', 'rejected', 'refactor_requested'].includes(statusRaw)
    ? (statusRaw as WorkerApprovalStatus)
    : 'pending';

  return {
    id,
    guildId: String(row.guildId || ''),
    requestedBy: String(row.requestedBy || ''),
    goal: String(row.goal || ''),
    actionName: String(row.actionName || ''),
    generatedCode: String(row.generatedCode || ''),
    sandboxDir: String(row.sandboxDir || ''),
    sandboxFilePath: String(row.sandboxFilePath || ''),
    validationPassed: Boolean(row.validationPassed),
    validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors.map((e) => String(e || '')) : [],
    validationWarnings: Array.isArray(row.validationWarnings) ? row.validationWarnings.map((e) => String(e || '')) : [],
    adminMessageId: row.adminMessageId ? String(row.adminMessageId) : undefined,
    adminChannelId: row.adminChannelId ? String(row.adminChannelId) : undefined,
    discoverEvidenceId: row.discoverEvidenceId ? String(row.discoverEvidenceId) : undefined,
    verifyEvidenceId: row.verifyEvidenceId ? String(row.verifyEvidenceId) : undefined,
    releaseEvidenceId: row.releaseEvidenceId ? String(row.releaseEvidenceId) : undefined,
    approvedAt: row.approvedAt ? String(row.approvedAt) : undefined,
    approvedBy: row.approvedBy ? String(row.approvedBy) : undefined,
    status,
    createdAt: String(row.createdAt || now()),
    updatedAt: String(row.updatedAt || now()),
  };
};

const enforceStoreLimit = (): string[] => {
  if (store.size <= MAX_APPROVALS) {
    return [];
  }
  const oldest = [...store.values()]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, store.size - MAX_APPROVALS);
  const removedIds: string[] = [];

  for (const entry of oldest) {
    store.delete(entry.id);
    removedIds.push(entry.id);
  }

  return removedIds;
};

const saveStore = async (): Promise<void> => {
  const dirPath = path.dirname(APPROVAL_STORE_PATH);
  await fs.mkdir(dirPath, { recursive: true });
  const tempPath = `${APPROVAL_STORE_PATH}.tmp`;
  const payload = JSON.stringify([...store.values()], null, 2);
  await fs.writeFile(tempPath, payload, 'utf-8');
  await fs.rename(tempPath, APPROVAL_STORE_PATH);
};

const saveStoreBestEffort = async (): Promise<void> => {
  const logSaveWarning = (scope: string, error: unknown) => {
    const nowMs = Date.now();
    if (nowMs - lastSaveChainErrorLogAt < WORKER_APPROVAL_SAVE_ERROR_LOG_THROTTLE_MS) {
      return;
    }
    lastSaveChainErrorLogAt = nowMs;
    logger.warn('[WORKER-APPROVAL] %s (throttled): %s', scope, error instanceof Error ? error.message : String(error));
  };

  saveChain = saveChain
    .catch((error) => {
      logSaveWarning('previous save chain failed', error);
    })
    .then(() => saveStore())
    .catch((error) => {
      logSaveWarning('saveStore failed', error);
    });
  await saveChain;
};

const upsertApprovalToSupabase = async (entry: PendingWorkerApproval): Promise<void> => {
  if (!shouldUseSupabaseStore()) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from(APPROVAL_DB_TABLE)
      .upsert(toDbRow(entry), { onConflict: 'id' });

    if (error) {
      if (isMissingTableError(error)) {
        supabaseStoreDisabled = true;
      }
      setStoreError(error.message || 'WORKER_APPROVAL_UPSERT_FAILED');
      if (APPROVAL_STORE_MODE === 'supabase') {
        throw new Error(error.message || 'WORKER_APPROVAL_UPSERT_FAILED');
      }
      activeBackend = 'file';
      return;
    }

    activeBackend = 'supabase';
    lastStoreError = null;
  } catch (error) {
    setStoreError(error);
    if (APPROVAL_STORE_MODE === 'supabase') {
      throw error;
    }
    activeBackend = 'file';
  }
};

const deleteApprovalsFromSupabase = async (ids: string[]): Promise<void> => {
  if (!shouldUseSupabaseStore() || ids.length === 0) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from(APPROVAL_DB_TABLE)
      .delete()
      .in('id', ids);

    if (error && isMissingTableError(error)) {
      supabaseStoreDisabled = true;
    }
  } catch {
    // best-effort delete only
  }
};

const queueSave = async (): Promise<void> => {
  await saveStoreBestEffort();
};

const loadFromSupabase = async (): Promise<boolean> => {
  if (!shouldUseSupabaseStore()) {
    return false;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(APPROVAL_DB_TABLE)
      .select('id, guild_id, requested_by, goal, action_name, generated_code, sandbox_dir, sandbox_file_path, validation_passed, validation_errors, validation_warnings, admin_message_id, admin_channel_id, status, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(MAX_APPROVALS);

    if (error) {
      if (isMissingTableError(error)) {
        supabaseStoreDisabled = true;
        if (APPROVAL_STORE_MODE === 'supabase') {
          throw new Error(error.message || `WORKER_APPROVAL_TABLE_MISSING:${APPROVAL_DB_TABLE}`);
        }
        setStoreError(error.message || `WORKER_APPROVAL_TABLE_MISSING:${APPROVAL_DB_TABLE}`);
        return false;
      }
      if (APPROVAL_STORE_MODE === 'supabase') {
        throw new Error(error.message || 'WORKER_APPROVAL_LOAD_FAILED');
      }
      setStoreError(error.message || 'WORKER_APPROVAL_LOAD_FAILED');
      return false;
    }

    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const safe = fromDbRow(row);
      if (safe.id) {
        store.set(safe.id, safe);
      }
    }
    enforceStoreLimit();
    activeBackend = 'supabase';
    lastStoreError = null;
    return true;
  } catch (error) {
    setStoreError(error);
    if (APPROVAL_STORE_MODE === 'supabase') {
      throw error;
    }
    return false;
  }
};

const ensureLoaded = async (): Promise<void> => {
  if (loaded) {
    return;
  }
  loaded = true;

  if (APPROVAL_STORE_MODE === 'supabase' && !isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED_FOR_WORKER_APPROVAL_STORE');
  }

  const loadedFromSupabase = await loadFromSupabase();
  if (loadedFromSupabase) {
    await saveStoreBestEffort();
    return;
  }

  try {
    const raw = await fs.readFile(APPROVAL_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }
    for (const row of parsed) {
      const safe = toSafeEntry(row);
      if (safe) {
        store.set(safe.id, safe);
      }
    }
    enforceStoreLimit();
    activeBackend = 'file';
    lastStoreError = null;
  } catch {
    // First run or invalid store file should not crash runtime.
    activeBackend = shouldUseSupabaseStore() ? 'unknown' : 'file';
  }
};

export const getWorkerApprovalStoreSnapshot = async (): Promise<WorkerApprovalStoreSnapshot> => {
  try {
    await ensureLoaded();
  } catch (error) {
    setStoreError(error);
  }

  const values = [...store.values()];
  const pendingApprovals = values.filter((entry) => entry.status === 'pending').length;
  const approvedApprovals = values.filter((entry) => entry.status === 'approved').length;
  const rejectedApprovals = values.filter((entry) => entry.status === 'rejected').length;

  return {
    configuredMode: APPROVAL_STORE_MODE,
    activeBackend,
    supabaseConfigured: isSupabaseConfigured(),
    supabaseDisabled: supabaseStoreDisabled,
    dbTable: APPROVAL_DB_TABLE,
    filePath: APPROVAL_STORE_PATH,
    loaded,
    totalApprovals: values.length,
    pendingApprovals,
    approvedApprovals,
    rejectedApprovals,
    lastError: lastStoreError,
  };
};

export const createApproval = async (
  params: Omit<PendingWorkerApproval, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<PendingWorkerApproval> => {
  await ensureLoaded();
  const id = `wapprv_${crypto.randomUUID()}`;
  const entry: PendingWorkerApproval = {
    ...params,
    id,
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
  };
  store.set(id, entry);
  const removedIds = enforceStoreLimit();
  await upsertApprovalToSupabase(entry);
  await deleteApprovalsFromSupabase(removedIds);
  await queueSave();

  return { ...entry };
};

export const getApproval = async (id: string): Promise<PendingWorkerApproval | null> => {
  await ensureLoaded();
  const entry = store.get(id);
  return entry ? { ...entry } : null;
};

export const updateApprovalStatus = async (
  id: string,
  status: WorkerApprovalStatus,
  extra?: { adminMessageId?: string; adminChannelId?: string; approvedBy?: string },
): Promise<boolean> => {
  await ensureLoaded();
  const entry = store.get(id);
  if (!entry) return false;
  entry.status = status;
  entry.updatedAt = now();
  if (extra?.adminMessageId) entry.adminMessageId = extra.adminMessageId;
  if (extra?.adminChannelId) entry.adminChannelId = extra.adminChannelId;
  if (status === 'approved') {
    entry.approvedAt = now();
    entry.approvedBy = extra?.approvedBy || 'unknown';
    entry.releaseEvidenceId = `opendev-release:${id}`;
  }
  await upsertApprovalToSupabase(entry);
  await queueSave();
  return true;
};

export const updateApprovalCode = async (id: string, code: string, sandboxDir: string, sandboxFilePath: string): Promise<boolean> => {
  await ensureLoaded();
  const entry = store.get(id);
  if (!entry) return false;
  entry.generatedCode = code;
  entry.sandboxDir = sandboxDir;
  entry.sandboxFilePath = sandboxFilePath;
  entry.status = 'pending';
  entry.updatedAt = now();
  await upsertApprovalToSupabase(entry);
  await queueSave();
  return true;
};

export const listPendingApprovals = async (): Promise<PendingWorkerApproval[]> => {
  await ensureLoaded();
  return [...store.values()].filter((e) => e.status === 'pending').map((e) => ({ ...e }));
};

export const listApprovals = async (params?: {
  status?: WorkerApprovalStatus | 'all';
}): Promise<PendingWorkerApproval[]> => {
  await ensureLoaded();
  const status = params?.status || 'all';
  const values = [...store.values()];
  const filtered = status === 'all'
    ? values
    : values.filter((entry) => entry.status === status);

  return filtered
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((entry) => ({ ...entry }));
};
