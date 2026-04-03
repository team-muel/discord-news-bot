import { getSupabaseExtensionOpsSnapshot } from './infra/supabaseExtensionOpsService';
import { getRuntimeSchedulerPolicySnapshot } from './runtimeSchedulerPolicyService';

export type LightweightingItem = {
  id: string;
  title: string;
  category: 'timer-consolidation' | 'duplicate-removal' | 'diagnostics-consolidation';
  priority: 'high' | 'medium' | 'low';
  current: string;
  target: string;
  files: string[];
  readiness: 'ready' | 'blocked' | 'in-progress';
  blockers?: string[];
};

export type PlatformLightweightingReport = {
  generatedAt: string;
  extensionReadiness: {
    pgCron: boolean;
    pgStatStatements: boolean;
    hypopg: boolean;
    pgTrgm: boolean;
  };
  summary: {
    total: number;
    ready: number;
    blocked: number;
    highPriority: number;
  };
  items: LightweightingItem[];
};

export const getPlatformLightweightingReport = async (): Promise<PlatformLightweightingReport> => {
  const extensionSnapshot = await getSupabaseExtensionOpsSnapshot({ includeTopQueries: false });
  const schedulerPolicy = await getRuntimeSchedulerPolicySnapshot();
  const extensionSet = new Set(
    extensionSnapshot.extensions
      .filter((item) => item.installed)
      .map((item) => item.extensionName),
  );

  const pgCron = extensionSet.has('pg_cron');
  const pgStatStatements = extensionSet.has('pg_stat_statements');
  const hypopg = extensionSet.has('hypopg');
  const pgTrgm = extensionSet.has('pg_trgm');
  const schedulerMapReady = schedulerPolicy.summary.total > 0 && schedulerPolicy.summary.appOwned > 0;

  const items: LightweightingItem[] = [
    {
      id: 'timer-001',
      title: 'Move maintenance cleanup from app loops to pg_cron',
      category: 'timer-consolidation',
      priority: 'high',
      current: 'login-session, obsidian sync, SLO check all have app/db owner toggle; pg_cron jobs registered via pgCronBootstrapService',
      target: 'daily cleanup guaranteed by pg_cron jobs with app loop disabled by default',
      files: [
        'docs/SUPABASE_SCHEMA.sql',
        'src/discord/auth.ts',
        'src/services/infra/pgCronBootstrapService.ts',
        'src/services/runtimeSchedulerPolicyService.ts',
      ],
      readiness: pgCron ? 'ready' : 'blocked',
      blockers: pgCron ? [] : ['pg_cron extension is not installed'],
    },
    {
      id: 'dup-001',
      title: 'Unify memory search branch logic around hybrid RPC first',
      category: 'duplicate-removal',
      priority: 'high',
      current: 'single searchMemoryHybrid helper used by agentMemoryStore, agentMemoryService, and memoryEvolutionService',
      target: 'keep one rpc-first pipeline and use classic path only for resilience fallback',
      files: ['src/services/agent/agentMemoryStore.ts', 'src/services/agent/agentMemoryService.ts', 'src/services/memory/memoryEvolutionService.ts'],
      readiness: 'ready',
    },
    {
      id: 'diag-001',
      title: 'Replace ad-hoc SQL tuning checks with pg_stat_statements + hypopg loop',
      category: 'diagnostics-consolidation',
      priority: 'high',
      current: 'query hotspots are inferred indirectly',
      target: 'top SQL + hypothetical index simulation via unified APIs',
      files: ['src/services/supabaseExtensionOpsService.ts', 'src/routes/bot.ts', 'docs/SUPABASE_SCHEMA.sql'],
      readiness: pgStatStatements && hypopg ? 'ready' : 'blocked',
      blockers: (pgStatStatements && hypopg) ? [] : [
        !pgStatStatements ? 'pg_stat_statements extension is not installed' : '',
        !hypopg ? 'hypopg extension is not installed' : '',
      ].filter(Boolean),
    },
    {
      id: 'timer-002',
      title: 'Consolidate ops loops behind one runtime scheduler policy',
      category: 'timer-consolidation',
      priority: 'medium',
      current: 'each domain loop has app/db owner toggle; scheduler policy snapshot reflects ownership',
      target: 'single policy map for loop ownership and startup wiring',
      files: [
        'src/discord/runtime/readyWorkloads.ts',
        'src/services/agent/agentOpsService.ts',
        'src/services/eval/retrievalEvalLoopService.ts',
        'src/services/runtimeSchedulerPolicyService.ts',
      ],
      readiness: schedulerMapReady ? 'ready' : 'blocked',
      blockers: schedulerMapReady ? [] : ['runtime scheduler policy snapshot is empty or app-owned loops are not visible'],
    },
    {
      id: 'dup-002',
      title: 'Remove dead helper from llmClient and flatten provider wrappers',
      category: 'duplicate-removal',
      priority: 'low',
      current: 'unused helper wrappers remain after provider metadata refactor',
      target: 'remove dead wrappers and keep one provider dispatch path',
      files: ['src/services/llmClient.ts'],
      readiness: 'ready',
    },
  ];

  const ready = items.filter((item) => item.readiness === 'ready').length;
  const blocked = items.filter((item) => item.readiness === 'blocked').length;
  const highPriority = items.filter((item) => item.priority === 'high').length;

  return {
    generatedAt: new Date().toISOString(),
    extensionReadiness: {
      pgCron,
      pgStatStatements,
      hypopg,
      pgTrgm,
    },
    summary: {
      total: items.length,
      ready,
      blocked,
      highPriority,
    },
    items,
  };
};
