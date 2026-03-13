import crypto from 'node:crypto';

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
  status: WorkerApprovalStatus;
  createdAt: string;
  updatedAt: string;
};

const MAX_APPROVALS = 200;
const store = new Map<string, PendingWorkerApproval>();

const now = (): string => new Date().toISOString();

export const createApproval = (
  params: Omit<PendingWorkerApproval, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): PendingWorkerApproval => {
  const id = `wapprv_${crypto.randomUUID()}`;
  const entry: PendingWorkerApproval = {
    ...params,
    id,
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
  };
  store.set(id, entry);

  if (store.size > MAX_APPROVALS) {
    const oldest = [...store.keys()].slice(0, store.size - MAX_APPROVALS);
    for (const k of oldest) store.delete(k);
  }

  return { ...entry };
};

export const getApproval = (id: string): PendingWorkerApproval | null => {
  const entry = store.get(id);
  return entry ? { ...entry } : null;
};

export const updateApprovalStatus = (
  id: string,
  status: WorkerApprovalStatus,
  extra?: { adminMessageId?: string; adminChannelId?: string },
): boolean => {
  const entry = store.get(id);
  if (!entry) return false;
  entry.status = status;
  entry.updatedAt = now();
  if (extra?.adminMessageId) entry.adminMessageId = extra.adminMessageId;
  if (extra?.adminChannelId) entry.adminChannelId = extra.adminChannelId;
  return true;
};

export const updateApprovalCode = (id: string, code: string, sandboxDir: string, sandboxFilePath: string): boolean => {
  const entry = store.get(id);
  if (!entry) return false;
  entry.generatedCode = code;
  entry.sandboxDir = sandboxDir;
  entry.sandboxFilePath = sandboxFilePath;
  entry.status = 'pending';
  entry.updatedAt = now();
  return true;
};

export const listPendingApprovals = (): PendingWorkerApproval[] =>
  [...store.values()].filter((e) => e.status === 'pending').map((e) => ({ ...e }));
