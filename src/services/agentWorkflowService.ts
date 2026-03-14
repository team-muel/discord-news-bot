import { parseIntegerEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type WorkflowPriority = 'fast' | 'balanced' | 'precise';
export type WorkflowRole = 'planner' | 'researcher' | 'critic';

export type WorkflowStepTemplate = {
  role: WorkflowRole;
  title: string;
  skipWhenFast?: boolean;
  skipWhenRequestedSkill?: boolean;
};

const WORKFLOW_CACHE_TTL_MS = Math.max(5_000, parseIntegerEnv(process.env.AGENT_WORKFLOW_CACHE_TTL_MS, 60_000));

const DEFAULT_STEPS: Record<WorkflowPriority, WorkflowStepTemplate[]> = {
  fast: [
    {
      role: 'planner',
      title: '목표 실행 계획 수립',
      skipWhenFast: true,
    },
    {
      role: 'researcher',
      title: '실행안/근거 초안 작성',
    },
    {
      role: 'critic',
      title: '리스크 검토 및 보완',
      skipWhenFast: true,
    },
  ],
  balanced: [
    {
      role: 'planner',
      title: '목표 실행 계획 수립',
    },
    {
      role: 'researcher',
      title: '실행안/근거 초안 작성',
    },
    {
      role: 'critic',
      title: '리스크 검토 및 보완',
    },
  ],
  precise: [
    {
      role: 'planner',
      title: '목표 실행 계획 수립',
    },
    {
      role: 'researcher',
      title: '실행안/근거 초안 작성',
    },
    {
      role: 'critic',
      title: '리스크 검토 및 보완',
    },
  ],
};

let workflowCache = new Map<string, WorkflowStepTemplate[]>();
let cacheLoadedAt = 0;
let cacheLoading: Promise<void> | null = null;

const normalizePriority = (value: string): WorkflowPriority => {
  const lowered = String(value || '').trim().toLowerCase();
  if (lowered === 'fast') return 'fast';
  if (lowered === 'precise') return 'precise';
  return 'balanced';
};

const normalizeRole = (value: unknown): WorkflowRole | null => {
  const lowered = String(value || '').trim().toLowerCase();
  if (lowered === 'planner') return 'planner';
  if (lowered === 'researcher') return 'researcher';
  if (lowered === 'critic') return 'critic';
  return null;
};

const parseStepTemplates = (value: unknown): WorkflowStepTemplate[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: WorkflowStepTemplate[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const row = raw as Record<string, unknown>;
    const role = normalizeRole(row.role);
    const title = String(row.title || '').trim();
    if (!role || !title) {
      continue;
    }
    out.push({
      role,
      title,
      skipWhenFast: Boolean(row.skipWhenFast),
      skipWhenRequestedSkill: Boolean(row.skipWhenRequestedSkill),
    });
  }

  return out;
};

const mergeWithDefaults = (priority: WorkflowPriority, custom: WorkflowStepTemplate[]): WorkflowStepTemplate[] => {
  if (custom.length === 0) {
    return DEFAULT_STEPS[priority].map((step) => ({ ...step }));
  }
  return custom.map((step) => ({ ...step }));
};

const isCacheFresh = () => Date.now() - cacheLoadedAt < WORKFLOW_CACHE_TTL_MS;

export const refreshWorkflowProfileCache = async (): Promise<void> => {
  if (!isSupabaseConfigured()) {
    workflowCache = new Map();
    cacheLoadedAt = Date.now();
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_workflow_profiles')
    .select('guild_id, priority, steps, enabled')
    .eq('enabled', true)
    .limit(500);

  if (error) {
    return;
  }

  const nextCache = new Map<string, WorkflowStepTemplate[]>();
  for (const raw of data || []) {
    const row = raw as Record<string, unknown>;
    const guildId = String(row.guild_id || '').trim() || '*';
    const priority = normalizePriority(String(row.priority || 'balanced'));
    const steps = parseStepTemplates(row.steps);
    if (steps.length === 0) {
      continue;
    }
    nextCache.set(`${guildId}:${priority}`, steps);
  }

  workflowCache = nextCache;
  cacheLoadedAt = Date.now();
};

export const primeWorkflowProfileCache = (): void => {
  if (cacheLoading || isCacheFresh()) {
    return;
  }

  cacheLoading = refreshWorkflowProfileCache()
    .catch(() => undefined)
    .finally(() => {
      cacheLoading = null;
    });
};

export const getWorkflowStepTemplates = (params: {
  guildId: string;
  priority: WorkflowPriority;
  hasRequestedSkill: boolean;
}): WorkflowStepTemplate[] => {
  primeWorkflowProfileCache();

  const keyGuild = `${params.guildId}:${params.priority}`;
  const keyGlobal = `*:${params.priority}`;
  const custom = workflowCache.get(keyGuild) || workflowCache.get(keyGlobal) || [];
  const source = mergeWithDefaults(params.priority, custom);
  return source.map((step) => ({ ...step }));
};
