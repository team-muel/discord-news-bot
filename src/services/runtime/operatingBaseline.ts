import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPERATING_BASELINE_PATH = path.resolve(__dirname, '../../../config/runtime/operating-baseline.json');

export type OperatingBaselineService = {
  envKey?: string;
  legacyEnvKey?: string;
  indexingEnvKey?: string;
  url?: string;
  legacyUrl?: string;
  directUrl?: string;
  healthPath?: string;
  alwaysOn?: boolean;
};

export type OperatingBaselineCapabilityAuditFinding = {
  id?: string;
  status?: 'optional-lane' | 'accepted-gap';
  summary?: string;
  rationale?: string;
};

export type OperatingBaselineDocument = {
  schemaVersion: number;
  updatedAt: string;
  environment: string;
  description: string;
  gcpWorker?: {
    projectId?: string;
    instanceName?: string;
    zone?: string;
    machineType?: string;
    memoryGb?: number;
    bootDiskGb?: number;
    staticIpName?: string;
    staticIpAddress?: string;
    publicBaseUrl?: string;
  };
  services?: Record<string, OperatingBaselineService>;
  lanes?: {
    alwaysOnRequired?: string[];
    optInRemoteProviderLanes?: string[];
    localAccelerationOnly?: string[];
  };
  readiness?: {
    localHybridCheck?: {
      command?: string;
      meaning?: string;
    };
    localLearningLoopCheck?: {
      command?: string;
      meaning?: string;
    };
    alwaysOnChecks?: string[];
    optionalLaneChecks?: string[];
  };
  capabilityAudit?: {
    acknowledgedFindings?: OperatingBaselineCapabilityAuditFinding[];
  };
  externalOssRoles?: Record<string, string>;
};

export type OperatingBaselineSummary = {
  machineType: string;
  memoryGb: number | null;
  publicBaseUrl: string;
  alwaysOnRequired: string[];
  optInRemoteProviderLanes: string[];
  localAccelerationOnly: string[];
  localHybridMeaning: string;
  openjarvisRole: string;
};

let cachedMtimeMs = -1;
let cachedBaseline: OperatingBaselineDocument | null = null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export const loadOperatingBaseline = (): OperatingBaselineDocument | null => {
  try {
    const stat = fs.statSync(OPERATING_BASELINE_PATH);
    if (stat.mtimeMs === cachedMtimeMs) {
      return cachedBaseline;
    }

    const raw = fs.readFileSync(OPERATING_BASELINE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as OperatingBaselineDocument;
    cachedMtimeMs = stat.mtimeMs;
    cachedBaseline = parsed;
    return parsed;
  } catch {
    return null;
  }
};

export const getOperatingBaselinePath = (): string => OPERATING_BASELINE_PATH;

export const summarizeOperatingBaseline = (
  baseline: OperatingBaselineDocument | null | undefined,
): OperatingBaselineSummary => {
  const alwaysOnRequired = isStringArray(baseline?.lanes?.alwaysOnRequired)
    ? baseline?.lanes?.alwaysOnRequired || []
    : [];
  const optInRemoteProviderLanes = isStringArray(baseline?.lanes?.optInRemoteProviderLanes)
    ? baseline?.lanes?.optInRemoteProviderLanes || []
    : [];
  const localAccelerationOnly = isStringArray(baseline?.lanes?.localAccelerationOnly)
    ? baseline?.lanes?.localAccelerationOnly || []
    : [];

  return {
    machineType: String(baseline?.gcpWorker?.machineType || '').trim() || 'unknown',
    memoryGb: Number.isFinite(Number(baseline?.gcpWorker?.memoryGb))
      ? Number(baseline?.gcpWorker?.memoryGb)
      : null,
    publicBaseUrl: String(baseline?.gcpWorker?.publicBaseUrl || '').trim() || 'unknown',
    alwaysOnRequired,
    optInRemoteProviderLanes,
    localAccelerationOnly,
    localHybridMeaning: String(baseline?.readiness?.localHybridCheck?.meaning || '').trim()
      || 'Local hybrid checks validate local readiness only.',
    openjarvisRole: String(baseline?.externalOssRoles?.openjarvis || '').trim()
      || 'Operations, eval, and learning lane.',
  };
};