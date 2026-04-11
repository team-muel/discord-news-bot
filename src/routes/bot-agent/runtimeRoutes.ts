import { requireAdmin } from '../../middleware/auth';
import {
  ensureSupabaseMaintenanceCronJobs,
  evaluateHypoPgIndexes,
  getHypoPgCandidates,
  getSupabaseExtensionOpsSnapshot,
  listSupabaseCronJobs,
} from '../../services/infra/supabaseExtensionOpsService';
import { getPlatformLightweightingReport } from '../../services/runtime/platformLightweightingService';
import { getAgentRoleWorkersHealthSnapshot, listAgentRoleWorkerSpecs, probeHttpWorkerHealth } from '../../services/agent/agentRoleWorkerService';
import { getRuntimeSchedulerPolicySnapshot } from '../../services/runtime/runtimeSchedulerPolicyService';
import { getEfficiencySnapshot, runEfficiencyQuickWins } from '../../services/runtime/efficiencyOptimizationService';
import { getAgentTelemetryQueueSnapshot } from '../../services/agent/agentTelemetryQueue';
import { summarizeOpencodeQueueReadiness } from '../../services/opencode/opencodeGitHubQueueService';
import { getMemoryJobRunnerStats, getMemoryQueueHealthSnapshot } from '../../services/memory/memoryJobRunner';
import { getObsidianInboxChatLoopStats } from '../../services/obsidian/obsidianInboxChatLoopService';
import { getObsidianLoreSyncLoopStats } from '../../services/obsidian/obsidianLoreSyncService';
import { getRetrievalEvalLoopStats } from '../../services/eval/retrievalEvalLoopService';
import { buildAgentRuntimeReadinessReport } from '../../services/agent/agentRuntimeReadinessService';
import { evaluateGuildSloAndPersistAlerts, evaluateGuildSloReport, listGuildSloAlertEvents } from '../../services/agent/agentSloService';
import { getFinopsBudgetStatus, getFinopsSummary } from '../../services/finopsService';
import { getLlmExperimentSummary } from '../../services/llmExperimentAnalyticsService';
import { getLlmRuntimeSnapshot } from '../../services/llmClient';
import { buildSocialQualityOperationalSnapshot } from '../../services/agent/agentSocialQualitySnapshotService';
import { buildWorkerApprovalGateSnapshot } from '../../services/agent/agentWorkerApprovalGateSnapshotService';
import { buildGoNoGoReport } from '../../services/goNoGoService';
import { buildToolLearningWeeklyReport } from '../../services/toolLearningService';
import {
  compileObsidianKnowledgeBundle,
  getObsidianKnowledgeCompilationStats,
  getObsidianKnowledgeControlSurface,
  resolveObsidianIncidentGraph,
  resolveInternalKnowledge,
  runObsidianSemanticLintAudit,
  traceObsidianDecision,
  type ObsidianDecisionTraceResult,
  type ObsidianIncidentGraphResult,
  type ObsidianKnowledgePromotionCandidate,
  type ObsidianKnowledgePromotionKind,
} from '../../services/obsidian/knowledgeCompilerService';
import { getLatestObsidianGraphAuditSnapshot } from '../../services/obsidian/obsidianQualityService';
import { getObsidianRetrievalBoundarySnapshot } from '../../services/obsidian/obsidianRagService';
import { getObsidianAdapterRuntimeStatus, getObsidianVaultLiveHealthStatus } from '../../services/obsidian/router';
import { loadOperatingBaseline } from '../../services/runtime/operatingBaseline';
import { getPendingIntentCount } from '../../services/intent';
import { toBoundedInt, toStringParam } from '../../utils/validation';
import { getObsidianVaultRoot, getObsidianVaultRuntimeInfo, type ObsidianVaultRuntimeInfo } from '../../utils/obsidianEnv';
import {
  computeSystemGradient,
  computeConvergenceReport,
  getCrossLoopOriginsSnapshot,
  evaluateCrossLoopOutcomes,
} from '../../services/sprint/selfImprovementLoop';
import { syncHighRiskActionsToSandboxPolicy } from '../../services/skills/actionRunner';
import { getSupabaseClient, isSupabaseConfigured } from '../../services/supabaseClient';

import { BotAgentRouteDeps } from './types';
import {
  MCP_IMPLEMENT_WORKER_URL,
  OPENJARVIS_REQUIRE_OPENCODE_WORKER,
  MCP_OPENCODE_WORKER_URL,
  UNATTENDED_WORKER_HEALTH_TIMEOUT_MS,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN,
  LLM_EXPERIMENT_NAME,
} from '../../config';

const EXECUTOR_ACTION_CANONICAL_NAME = 'implement.execute';
const EXECUTOR_ACTION_LEGACY_NAME = 'opencode.execute';
const EXECUTOR_WORKER_ENV_CANONICAL_KEY = 'MCP_IMPLEMENT_WORKER_URL';
const EXECUTOR_WORKER_ENV_LEGACY_KEY = 'MCP_OPENCODE_WORKER_URL';

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

type PromotionBacklink = {
  artifactKind: ObsidianKnowledgePromotionKind;
  title: string;
  reason: string;
  targetPath: string;
  sourceRefs: string[];
};

type DecisionTraceSummary = {
  subject: string;
  summary: string;
  traceRefs: string[];
  contradictionCount: number;
  gapCount: number;
  supersedes: string[];
};

type IncidentGraphSummary = {
  incident: string;
  summary: string;
  affectedServices: string[];
  relatedIncidents: string[];
  relatedPlaybooks: string[];
  relatedImprovements: string[];
  blockers: string[];
  nextActions: string[];
  customerImpactLikely: boolean;
};

const toPathSlug = (value: string): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'untitled';
};

const buildPromotionTargetPath = (artifactKind: ObsidianKnowledgePromotionKind, title: string): string => {
  const slug = toPathSlug(title);
  const date = new Date().toISOString().slice(0, 10);
  switch (artifactKind) {
    case 'decision':
      return `plans/decisions/${slug}.md`;
    case 'development_slice':
      return `plans/development/${date}_${slug}.md`;
    case 'service_profile':
      return `ops/services/${slug}/PROFILE.md`;
    case 'playbook':
      return `ops/playbooks/${slug}.md`;
    case 'improvement':
      return `ops/improvement/${slug}.md`;
    case 'repository_context':
      return `ops/contexts/repos/${slug}.md`;
    case 'runtime_snapshot':
      return `ops/_runtime/${slug}.md`;
    case 'requirement':
    default:
      return `plans/requirements/${slug}.md`;
  }
};

const buildPromotionBacklinks = (candidates: ObsidianKnowledgePromotionCandidate[]): PromotionBacklink[] => {
  const seen = new Set<string>();
  const result: PromotionBacklink[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.artifactKind}:${candidate.title}`;
    if (!candidate.title || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      artifactKind: candidate.artifactKind,
      title: candidate.title,
      reason: candidate.reason,
      targetPath: buildPromotionTargetPath(candidate.artifactKind, candidate.title),
      sourceRefs: dedupeStrings(candidate.sourceRefs),
    });
  }
  return result.slice(0, 8);
};

const summarizeDecisionTrace = (trace: ObsidianDecisionTraceResult | null): DecisionTraceSummary | undefined => {
  if (!trace) {
    return undefined;
  }

  return {
    subject: trace.subject,
    summary: trace.summary,
    traceRefs: dedupeStrings([
      ...trace.trace.map((step) => step.locator),
      ...trace.supersedes,
      ...trace.artifacts.map((artifact) => artifact.locator),
    ]).slice(0, 12),
    contradictionCount: trace.contradictions.length,
    gapCount: trace.gaps.length,
    supersedes: trace.supersedes.slice(0, 8),
  };
};

const summarizeIncidentGraph = (graph: ObsidianIncidentGraphResult | null): IncidentGraphSummary | undefined => {
  if (!graph) {
    return undefined;
  }

  return {
    incident: graph.incident,
    summary: graph.summary,
    affectedServices: graph.affectedServices.slice(0, 8),
    relatedIncidents: graph.relatedIncidents.slice(0, 8),
    relatedPlaybooks: graph.relatedPlaybooks.slice(0, 8),
    relatedImprovements: graph.relatedImprovements.slice(0, 8),
    blockers: graph.blockers.slice(0, 8),
    nextActions: graph.nextActions.slice(0, 8),
    customerImpactLikely: graph.customerImpactLikely,
  };
};

const buildIncidentQuery = (goal: string): string => {
  const normalized = String(goal || '').trim();
  if (!normalized) {
    return 'operator incident';
  }
  return /(incident|outage|rollback|recovery|playbook|runbook)/i.test(normalized)
    ? normalized
    : `${normalized} incident`;
};

const buildSemanticTargets = (values: Array<string | null | undefined>): string[] => {
  return dedupeStrings(values).slice(0, 8);
};

const readRemoteVaultRuntime = (adapterRuntime: Record<string, unknown> | null | undefined): Partial<ObsidianVaultRuntimeInfo> | null => {
  const remoteMcp = adapterRuntime?.remoteMcp;
  if (!remoteMcp || typeof remoteMcp !== 'object') {
    return null;
  }

  const remoteAdapterRuntime = (remoteMcp as Record<string, unknown>).remoteAdapterRuntime;
  if (!remoteAdapterRuntime || typeof remoteAdapterRuntime !== 'object') {
    return null;
  }

  const vaultRuntime = (remoteAdapterRuntime as Record<string, unknown>).vaultRuntime;
  if (!vaultRuntime || typeof vaultRuntime !== 'object') {
    return null;
  }

  return vaultRuntime as Partial<ObsidianVaultRuntimeInfo>;
};

const buildVaultParitySnapshot = (params: {
  localVault: ObsidianVaultRuntimeInfo;
  adapterRuntime: Record<string, unknown> | null | undefined;
}) => {
  const { localVault, adapterRuntime } = params;
  const selectedByCapability = adapterRuntime?.selectedByCapability;
  const remoteSelectedForWrite = Boolean(
    selectedByCapability
    && typeof selectedByCapability === 'object'
    && (selectedByCapability as Record<string, unknown>).write_note === 'remote-mcp',
  );
  const remoteVault = readRemoteVaultRuntime(adapterRuntime);

  if (!remoteSelectedForWrite) {
    return {
      compared: false,
      remoteSelectedForWrite: false,
      ok: null,
      reason: 'remote_mcp_not_selected_for_write',
      local: localVault,
      remote: remoteVault,
      sharedTopLevelDirectories: [],
      sameResolvedName: null,
    };
  }

  if (!remoteVault) {
    return {
      compared: false,
      remoteSelectedForWrite: true,
      ok: null,
      reason: 'remote_vault_runtime_missing',
      local: localVault,
      remote: null,
      sharedTopLevelDirectories: [],
      sameResolvedName: null,
    };
  }

  const localDirs = new Set((localVault.topLevelDirectories || []).map((value) => String(value || '').trim()).filter(Boolean));
  const remoteDirs = new Set(
    (Array.isArray(remoteVault.topLevelDirectories) ? remoteVault.topLevelDirectories : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const sharedTopLevelDirectories = ['chat', 'guilds', 'ops'].filter((dir) => localDirs.has(dir) && remoteDirs.has(dir));
  const sameResolvedName = localVault.resolvedName && remoteVault.resolvedName
    ? localVault.resolvedName === remoteVault.resolvedName
    : null;
  const sameDesktopShape = Boolean(localVault.looksLikeDesktopVault) && Boolean(remoteVault.looksLikeDesktopVault);
  const ok = sameDesktopShape && sharedTopLevelDirectories.length >= 3 && sameResolvedName !== false;

  return {
    compared: true,
    remoteSelectedForWrite: true,
    ok,
    reason: ok ? 'desktop_vault_shape_aligned' : 'desktop_vault_shape_mismatch',
    local: localVault,
    remote: remoteVault,
    sharedTopLevelDirectories,
    sameResolvedName,
  };
};

export const buildOperatorSnapshot = async (params: {
  guildId?: string;
  days?: number;
  includeDocs?: boolean;
  includeRuntime?: boolean;
  includePendingIntents?: boolean;
  includeInternalKnowledge?: boolean;
  internalKnowledgeGoal?: string;
}) => {
  const guildId = toStringParam(params.guildId) || undefined;
  const days = toBoundedInt(params.days, 14, { min: 1, max: 90 });
  const includeDocs = params.includeDocs !== false;
  const includeRuntime = params.includeRuntime !== false;
  const includePendingIntents = params.includePendingIntents === true && Boolean(guildId);
  const includeInternalKnowledge = includeDocs && params.includeInternalKnowledge === true;
  const internalKnowledgeGoal = toStringParam(params.internalKnowledgeGoal)
    || (guildId
      ? `operator snapshot runtime readiness for guild ${guildId}`
      : 'operator snapshot runtime readiness and shared knowledge state');

  const [vaultHealth, graphAudit, retrievalBoundary, schedulerPolicy, workerHealth, internalKnowledge] = await Promise.all([
    getObsidianVaultLiveHealthStatus(),
    getLatestObsidianGraphAuditSnapshot(),
    getObsidianRetrievalBoundarySnapshot(),
    getRuntimeSchedulerPolicySnapshot(),
    getAgentRoleWorkersHealthSnapshot(),
    includeInternalKnowledge
      ? resolveInternalKnowledge({
        goal: internalKnowledgeGoal,
        targets: dedupeSnapshotTargets(guildId),
        sourceHints: ['obsidian', 'internal-docs', 'runtime'],
        includeRelatedArtifacts: false,
        maxArtifacts: 3,
        maxFacts: 4,
        audience: 'ops',
      }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const bundle = includeDocs
    ? await compileObsidianKnowledgeBundle({
      goal: internalKnowledgeGoal,
      domains: ['ops', 'runtime', 'requirements'],
      sourceHints: ['obsidian', 'internal-docs', 'runtime'],
      maxArtifacts: 4,
      maxFacts: 4,
      audience: 'ops',
    }).catch(() => null)
    : null;

  const semanticTargets = buildSemanticTargets([
    ...dedupeSnapshotTargets(guildId),
    ...(bundle?.artifacts || []).map((artifact) => artifact.title),
    ...(bundle?.artifacts || []).map((artifact) => artifact.locator),
    ...(internalKnowledge?.artifacts || []).map((artifact) => artifact.title),
    ...(internalKnowledge?.artifacts || []).map((artifact) => artifact.locator),
  ]);
  const incidentServiceHints = dedupeStrings([
    ...extractAffectedServices((bundle?.artifacts || []).map((artifact) => artifact.locator)),
    ...extractAffectedServices((internalKnowledge?.artifacts || []).map((artifact) => artifact.locator)),
  ]).slice(0, 6);
  const [decisionTraceResult, incidentGraphResult] = includeDocs
    ? await Promise.all([
      traceObsidianDecision({
        subject: internalKnowledgeGoal,
        targets: semanticTargets,
        sourceHints: ['obsidian', 'internal-docs', 'runtime'],
        maxArtifacts: 4,
        maxFacts: 4,
        audience: 'ops',
      }).catch(() => null),
      resolveObsidianIncidentGraph({
        incident: buildIncidentQuery(internalKnowledgeGoal),
        serviceHints: incidentServiceHints,
        sourceHints: ['obsidian', 'internal-docs', 'runtime'],
        maxArtifacts: 5,
        maxFacts: 5,
        includeImprovements: true,
        audience: 'ops',
      }).catch(() => null),
    ])
    : [null, null];

  const localVault = getObsidianVaultRuntimeInfo();
  const adapterRuntime = getObsidianAdapterRuntimeStatus();
  const vaultParity = buildVaultParitySnapshot({
    localVault,
    adapterRuntime: adapterRuntime as Record<string, unknown>,
  });

  const snapshot: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    guildId: guildId || null,
    windowDays: days,
  };

  const runtimeSummary = includeRuntime
    ? {
      schedulerPolicy,
      workers: {
        specs: listAgentRoleWorkerSpecs(),
        health: workerHealth,
      },
      loops: {
        memoryJobRunner: getMemoryJobRunnerStats(),
        obsidianInboxChatLoop: getObsidianInboxChatLoopStats(),
        obsidianLoreSyncLoop: getObsidianLoreSyncLoopStats(),
        retrievalEvalLoop: getRetrievalEvalLoopStats(),
      },
    }
    : undefined;
  const decisionTrace = summarizeDecisionTrace(decisionTraceResult);
  const incidentGraph = summarizeIncidentGraph(incidentGraphResult);
  const promotionBacklinks = buildPromotionBacklinks(bundle?.recommendedPromotions || []);

  Object.assign(snapshot, {
    generatedAt: new Date().toISOString(),
    guildId: guildId || null,
    windowDays: days,
    operatingBaseline: loadOperatingBaseline(),
    obsidian: includeDocs
      ? {
        vaultPathConfigured: Boolean(getObsidianVaultRoot()),
        vault: localVault,
        adapterRuntime,
        accessPosture: adapterRuntime.accessPosture,
        vaultParity,
        vaultHealth,
        cacheStats: retrievalBoundary.supabaseBacked.cacheStats,
        compiler: getObsidianKnowledgeCompilationStats(),
        knowledgeControl: getObsidianKnowledgeControlSurface(),
        internalKnowledge: internalKnowledge
          ? {
            goal: internalKnowledgeGoal,
            summary: internalKnowledge.summary,
            preferredPath: internalKnowledge.preferredPath,
            confidence: internalKnowledge.confidence,
            artifactLocators: internalKnowledge.artifacts.slice(0, 3).map((artifact) => artifact.locator),
            accessNotes: internalKnowledge.accessNotes.slice(0, 3),
            gapCount: internalKnowledge.gaps.length,
          }
          : undefined,
        decisionTrace,
        incidentGraph,
        promotionBacklinks: promotionBacklinks.length > 0 ? promotionBacklinks : undefined,
        graphAudit,
        retrievalBoundary,
      }
      : undefined,
    runtime: runtimeSummary,
    schedulerPolicy: runtimeSummary?.schedulerPolicy,
    workers: runtimeSummary?.workers,
    loops: runtimeSummary?.loops,
  });

  if (!guildId) {
    return snapshot;
  }

  const [goNoGo, queueHealth, learning, pendingIntentCount] = await Promise.all([
    buildGoNoGoReport({ guildId, days }),
    getMemoryQueueHealthSnapshot(guildId),
    buildToolLearningWeeklyReport({ guildId, days }),
    includePendingIntents ? getPendingIntentCount(guildId).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    ...snapshot,
    releaseGate: {
      decision: goNoGo.decision,
      failedChecks: goNoGo.failedChecks,
      checks: goNoGo.checks,
    },
    memory: {
      scope: goNoGo.scope,
      quality: goNoGo.metrics,
      queue: goNoGo.queue,
      queueHealth,
    },
    learning,
    telemetryQueue: goNoGo.telemetryQueue,
    pendingIntentCount,
  };
};

const extractAffectedServices = (paths: string[]): string[] => {
  const services = paths
    .map((value) => String(value || '').trim().replace(/\\/g, '/'))
    .map((value) => value.match(/ops\/services\/([^/]+)/)?.[1] || '')
    .filter(Boolean);
  return dedupeStrings(services).slice(0, 8);
};

export const buildActiveWorkset = async (params: {
  guildId?: string;
  objective?: string;
  days?: number;
  includeEvidence?: boolean;
  maxArtifacts?: number;
  maxFacts?: number;
}) => {
  const guildId = toStringParam(params.guildId) || undefined;
  const objective = toStringParam(params.objective)
    || (guildId ? `active workset for guild ${guildId}` : 'active operator workset');
  const days = toBoundedInt(params.days, 14, { min: 1, max: 90 });
  const includeEvidence = params.includeEvidence !== false;
  const maxArtifacts = toBoundedInt(params.maxArtifacts, 5, { min: 1, max: 12 });
  const maxFacts = toBoundedInt(params.maxFacts, 6, { min: 1, max: 16 });

  const [snapshot, bundle, lint] = await Promise.all([
    buildOperatorSnapshot({
      guildId,
      days,
      includeDocs: true,
      includeRuntime: true,
      includePendingIntents: Boolean(guildId),
      includeInternalKnowledge: true,
      internalKnowledgeGoal: objective,
    }),
    compileObsidianKnowledgeBundle({
      goal: objective,
      domains: ['ops', 'runtime', 'requirements'],
      sourceHints: ['obsidian', 'runtime', 'internal-docs'],
      maxArtifacts,
      maxFacts,
      audience: 'ops',
    }),
    runObsidianSemanticLintAudit({ maxIssues: 6 }),
  ]);

  const snapshotRecord = snapshot as Record<string, any>;
  const failedChecks = Array.isArray(snapshotRecord.releaseGate?.failedChecks)
    ? snapshotRecord.releaseGate.failedChecks.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const pendingIntentCount = typeof snapshotRecord.pendingIntentCount === 'number'
    ? snapshotRecord.pendingIntentCount
    : null;
  const obsidianRecord = snapshotRecord.obsidian as Record<string, unknown> | undefined;
  const internalKnowledge = obsidianRecord?.internalKnowledge as Record<string, any> | undefined;
  const decisionTrace = (obsidianRecord?.decisionTrace || null) as DecisionTraceSummary | null;
  const incidentGraph = (obsidianRecord?.incidentGraph || null) as IncidentGraphSummary | null;
  const promotionBacklinks = Array.isArray(obsidianRecord?.promotionBacklinks)
    ? (obsidianRecord?.promotionBacklinks as PromotionBacklink[])
    : [];
  const artifactLocators = dedupeStrings([
    ...bundle.artifacts.map((artifact) => artifact.locator),
    ...((internalKnowledge?.artifactLocators as string[] | undefined) || []),
    ...(decisionTrace?.traceRefs || []),
    ...(incidentGraph?.relatedIncidents || []),
    ...(incidentGraph?.relatedPlaybooks || []),
    ...(incidentGraph?.relatedImprovements || []),
    ...promotionBacklinks.map((link) => link.targetPath),
    ...(lint.persistence?.issuePaths || []),
    ...(lint.persistence?.summaryPath ? [lint.persistence.summaryPath] : []),
  ]);
  const currentFocus = dedupeStrings([
    ...bundle.artifacts.slice(0, 4).map((artifact) => artifact.title),
    decisionTrace?.subject || null,
    incidentGraph?.incident || null,
    ...promotionBacklinks.map((link) => link.title),
    internalKnowledge?.summary ? String(internalKnowledge.summary) : null,
  ]).slice(0, 6);
  const blockers = dedupeStrings([
    ...failedChecks,
    ...lint.issues.filter((issue) => issue.severity !== 'low').map((issue) => issue.message),
    ...(incidentGraph?.blockers || []),
    pendingIntentCount && pendingIntentCount > 0 ? `${pendingIntentCount} pending intents remain open.` : null,
  ]).slice(0, 8);
  const nextActions = dedupeStrings([
    ...bundle.gaps.map((gap) => gap.suggestedNextStep),
    ...lint.followUps,
    ...(incidentGraph?.nextActions || []),
    ...promotionBacklinks.map((link) => `Promote ${link.title} into ${link.targetPath}.`),
    ...(((internalKnowledge?.accessNotes as string[] | undefined) || []).slice(0, 3)),
  ]).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    guildId: guildId || null,
    objective,
    summary: `Resolved active workset from ${bundle.artifacts.length} compiled artifacts with ${blockers.length} blockers and ${nextActions.length} next actions.`,
    currentFocus,
    blockers,
    nextActions,
    affectedServices: dedupeStrings([
      ...extractAffectedServices(artifactLocators),
      ...(incidentGraph?.affectedServices || []),
    ]).slice(0, 8),
    evidence: includeEvidence
      ? dedupeStrings([
        ...bundle.artifacts.slice(0, maxArtifacts).map((artifact) => artifact.locator),
        ...(decisionTrace?.traceRefs || []),
        ...(incidentGraph?.relatedIncidents || []),
        ...(incidentGraph?.relatedPlaybooks || []),
        ...(incidentGraph?.relatedImprovements || []),
        ...promotionBacklinks.map((link) => link.targetPath),
        ...(lint.persistence?.summaryPath ? [lint.persistence.summaryPath] : []),
      ]).slice(0, maxArtifacts).map((locator) => {
        const matchingArtifact = bundle.artifacts.find((artifact) => artifact.locator === locator);
        const matchingPromotion = promotionBacklinks.find((link) => link.targetPath === locator);
        return {
          title: matchingArtifact?.title || matchingPromotion?.title || locator,
          locator,
          whyIncluded: matchingArtifact?.whyIncluded || matchingPromotion?.reason || 'semantic control-plane evidence',
        };
      })
      : [],
    objectRefs: artifactLocators,
    decisionTrace,
    incidentGraph,
    promotionBacklinks,
    lint: {
      healthy: lint.healthy,
      issueCount: lint.issueCount,
      persistence: lint.persistence
        ? {
          summaryPath: lint.persistence.summaryPath,
          issuePaths: lint.persistence.issuePaths,
          writtenArtifacts: lint.persistence.writtenArtifacts,
        }
        : undefined,
    },
    releaseGate: snapshotRecord.releaseGate
      ? {
        decision: snapshotRecord.releaseGate.decision || null,
        failedChecks,
      }
      : null,
    pendingIntentCount,
  };
};

const dedupeSnapshotTargets = (guildId?: string): string[] => {
  return [
    'shared MCP',
    'control tower',
    'operating baseline',
    'operator snapshot',
    guildId ? `guild ${guildId}` : null,
  ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
};

const probeOpencodeWorkerHealth = async () => {
  const required = OPENJARVIS_REQUIRE_OPENCODE_WORKER;
  const workerUrl = MCP_IMPLEMENT_WORKER_URL || MCP_OPENCODE_WORKER_URL;
  const timeoutMs = UNATTENDED_WORKER_HEALTH_TIMEOUT_MS;
  if (!required && !workerUrl) {
    return {
      required: false,
      configured: false,
      reachable: null,
      latencyMs: null,
      status: null,
      endpoint: null,
      checkedAt: new Date().toISOString(),
      reason: 'worker_not_required',
      label: 'implement',
      contract: {
        canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
        persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
        legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
        canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
        legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
      },
    };
  }

  if (!workerUrl) {
    return {
      required,
      configured: false,
      reachable: false,
      latencyMs: null,
      status: null,
      endpoint: null,
      checkedAt: new Date().toISOString(),
      reason: 'worker_url_missing',
      label: 'implement',
      contract: {
        canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
        persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
        legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
        canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
        legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
      },
    };
  }

  const health = await probeHttpWorkerHealth(workerUrl, timeoutMs);

  return {
    required,
    configured: true,
    reachable: health.ok,
    latencyMs: health.latencyMs,
    status: health.status,
    endpoint: health.endpoint,
    checkedAt: new Date().toISOString(),
    reason: health.ok ? undefined : health.error || 'probe_failed',
    label: 'implement',
    contract: {
      canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
      persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
      legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
      canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
      legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
    },
  };
};

export function registerBotAgentRuntimeRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;
  router.get('/agent/runtime/worker-approval-gates', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const recentLimit = toBoundedInt(req.query?.recentLimit, 5, { min: 1, max: 20 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildWorkerApprovalGateSnapshot({ guildId, recentLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/social-quality-snapshot', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildSocialQualityOperationalSnapshot({ guildId, days });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/telemetry-queue', requireAdmin, async (_req, res, next) => {
    return res.json({ ok: true, queue: getAgentTelemetryQueueSnapshot() });
  });

  router.get('/agent/runtime/role-workers', requireAdmin, async (_req, res, next) => {
    try {
      const specs = listAgentRoleWorkerSpecs();
      const health = await getAgentRoleWorkersHealthSnapshot();
      return res.json({ ok: true, workers: specs, health });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/unattended-health', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const actionName = toStringParam(req.query?.actionName) || undefined;
    try {
      const telemetry = getAgentTelemetryQueueSnapshot();
      const readiness = guildId
        ? await summarizeOpencodeQueueReadiness({ guildId })
        : null;
      const workerHealth = await probeOpencodeWorkerHealth();
      const advisoryWorkersHealth = await getAgentRoleWorkersHealthSnapshot();
      const llmRuntime = await getLlmRuntimeSnapshot({ guildId: guildId || undefined, actionName });
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        telemetry,
        executorReadiness: readiness,
        opencodeReadiness: readiness,
        workerHealth,
        advisoryWorkersHealth,
        llmRuntime,
        notes: {
          guildScoped: Boolean(guildId),
          actionName: actionName || null,
          executorContract: {
            canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
            persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
            legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
            canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
            legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
          },
          publishLock: {
            enabled: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED),
            failOpen: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/extensions', requireAdmin, async (req, res, next) => {
    const includeTopQueries = String(req.query?.includeTopQueries || 'true').trim().toLowerCase() !== 'false';
    const topLimit = toBoundedInt(req.query?.topLimit, 10, { min: 1, max: 50 });
    try {
      const snapshot = await getSupabaseExtensionOpsSnapshot({ includeTopQueries, topLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/cron-jobs', requireAdmin, async (_req, res, next) => {
    try {
      const jobs = await listSupabaseCronJobs();
      return res.json({ ok: true, jobs, count: jobs.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/supabase/cron-jobs/ensure-maintenance', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const llmRetentionDays = toBoundedInt(req.body?.llmRetentionDays, 30, { min: 1, max: 365 });
    try {
      const installed = await ensureSupabaseMaintenanceCronJobs({ llmRetentionDays });
      return res.status(202).json({ ok: true, llmRetentionDays, installed, count: installed.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/hypopg/candidates', requireAdmin, async (_req, res, next) => {
    try {
      const candidates = await getHypoPgCandidates();
      return res.json({ ok: true, candidates, count: candidates.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/supabase/hypopg/evaluate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const ddls = Array.isArray(req.body?.ddls)
      ? req.body.ddls.map((item: unknown) => toStringParam(item)).filter(Boolean)
      : [];
    if (ddls.length === 0) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'ddls array is required' });
    }

    try {
      const evaluations = await evaluateHypoPgIndexes(ddls);
      return res.status(202).json({ ok: true, evaluations, count: evaluations.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/lightweighting-plan', requireAdmin, async (_req, res, next) => {
    try {
      const report = await getPlatformLightweightingReport();
      return res.json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/scheduler-policy', requireAdmin, async (_req, res, next) => {
    try {
      const snapshot = await getRuntimeSchedulerPolicySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/efficiency', requireAdmin, async (_req, res, next) => {
    try {
      const snapshot = await getEfficiencySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/efficiency/quick-wins', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const dryRun = String(req.body?.dryRun ?? 'true').trim().toLowerCase() !== 'false';
    const llmRetentionDays = toBoundedInt(req.body?.llmRetentionDays, 30, { min: 1, max: 365 });
    const evaluateHypopgTop = toBoundedInt(req.body?.evaluateHypopgTop, 2, { min: 1, max: 10 });

    try {
      const result = await runEfficiencyQuickWins({
        dryRun,
        llmRetentionDays,
        evaluateHypopgTop,
      });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/loops', requireAdmin, async (_req, res, next) => {
    return res.json({
      ok: true,
      memoryJobRunner: getMemoryJobRunnerStats(),
      obsidianInboxChatLoop: getObsidianInboxChatLoopStats(),
      obsidianLoreSyncLoop: getObsidianLoreSyncLoopStats(),
      retrievalEvalLoop: getRetrievalEvalLoopStats(),
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/agent/runtime/operator-snapshot', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    const includeDocs = parseBool(String(req.query?.includeDocs || ''), true);
    const includeRuntime = parseBool(String(req.query?.includeRuntime || ''), true);
    const includePendingIntents = parseBool(String(req.query?.includePendingIntents || ''), false);
    const includeInternalKnowledge = parseBool(String(req.query?.includeInternalKnowledge || ''), false);
    const internalKnowledgeGoal = toStringParam(req.query?.internalKnowledgeGoal) || undefined;

    try {
      const snapshot = await buildOperatorSnapshot({
        guildId,
        days,
        includeDocs,
        includeRuntime,
        includePendingIntents,
        includeInternalKnowledge,
        internalKnowledgeGoal,
      });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/workset', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const objective = toStringParam(req.query?.objective) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    const includeEvidence = parseBool(String(req.query?.includeEvidence || ''), true);

    try {
      const workset = await buildActiveWorkset({
        guildId,
        objective,
        days,
        includeEvidence,
        maxArtifacts: req.query?.maxArtifacts !== undefined ? toBoundedInt(req.query?.maxArtifacts, 5, { min: 1, max: 12 }) : undefined,
        maxFacts: req.query?.maxFacts !== undefined ? toBoundedInt(req.query?.maxFacts, 6, { min: 1, max: 16 }) : undefined,
      });
      return res.json({ ok: true, workset });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/knowledge-control-plane', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildOperatorSnapshot({
        guildId,
        days,
        includeDocs: true,
        includeRuntime: true,
        includeInternalKnowledge: true,
        internalKnowledgeGoal: `knowledge control plane readiness for guild ${guildId}`,
      });
      return res.json({
        ok: true,
        snapshot,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/readiness', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const windowDays = toBoundedInt(req.query?.windowDays, 30, { min: 1, max: 180 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const report = await buildAgentRuntimeReadinessReport({ guildId, windowDays });
      return res.json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/slo/report', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const report = await evaluateGuildSloReport({ guildId });
      return res.json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/slo/alerts', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const limit = toBoundedInt(req.query?.limit, 100, { min: 1, max: 500 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const alerts = await listGuildSloAlertEvents({ guildId, limit });
      return res.json({ ok: true, guildId, alerts, count: alerts.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/slo/evaluate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const force = String(req.body?.force || req.query?.force || '').trim().toLowerCase() === 'true';
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const report = await evaluateGuildSloAndPersistAlerts({ guildId, actorId, force });
      return res.status(202).json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/finops/summary', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 30, { min: 1, max: 180 });

    try {
      const summary = await getFinopsSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/finops/showback', requireAdmin, async (req, res, next) => {
    const days = toBoundedInt(req.query?.days, 30, { min: 1, max: 180 });

    try {
      const summary = await getFinopsSummary({ days });
      return res.json({
        ok: true,
        days,
        byGuild: summary.byGuild,
        generatedAt: summary.generatedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/finops/budget', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const budget = await getFinopsBudgetStatus(guildId);
      return res.json({ ok: true, budget });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/llm/experiments/summary', requireAdmin, async (req, res, next) => {
    const experimentName = toStringParam(req.query?.experimentName || req.query?.name || LLM_EXPERIMENT_NAME || 'hf_ab_v1');
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 180 });
    if (!experimentName) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'experimentName is required' });
    }

    try {
      const summary = await getLlmExperimentSummary({ experimentName, guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      next(error);
    }
  });

  // ── E-02: Channel routing configuration (guild → channel → provider mapping) ──

  const VALID_CHANNEL_PROVIDERS = new Set(['native', 'openclaw', 'openshell', 'disabled']);
  const channelRoutingCache = new Map<string, Record<string, string>>();
  const DEFAULT_CHANNEL_ROUTING: Record<string, string> = { discord: 'native', whatsapp: 'openclaw', telegram: 'openclaw' };

  const loadChannelRouting = async (guildId: string): Promise<Record<string, string>> => {
    const cached = channelRoutingCache.get(guildId);
    if (cached) return cached;
    if (!isSupabaseConfigured()) return DEFAULT_CHANNEL_ROUTING;
    try {
      const db = getSupabaseClient();
      const { data } = await db
        .from('guild_channel_routing')
        .select('channels')
        .eq('guild_id', guildId)
        .maybeSingle();
      if (data?.channels && typeof data.channels === 'object') {
        const channels = data.channels as Record<string, string>;
        channelRoutingCache.set(guildId, channels);
        return channels;
      }
    } catch { /* fall through to default */ }
    return DEFAULT_CHANNEL_ROUTING;
  };

  const saveChannelRouting = async (guildId: string, channels: Record<string, string>): Promise<void> => {
    channelRoutingCache.set(guildId, channels);
    if (!isSupabaseConfigured()) return;
    try {
      const db = getSupabaseClient();
      await db
        .from('guild_channel_routing')
        .upsert({ guild_id: guildId, channels, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
    } catch { /* non-blocking: cache is authoritative during outage */ }
  };

  router.get('/agent/runtime/channel-routing', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    const channels = await loadChannelRouting(guildId);
    return res.json({ ok: true, guildId, channels });
  });

  router.put('/agent/runtime/channel-routing', requireAdmin, adminActionRateLimiter, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId);
    const channels = req.body?.channels as Record<string, string> | undefined;
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'channels object is required (must be key-value map, not array)' });
    }
    // Validate channel provider values
    for (const [channel, provider] of Object.entries(channels)) {
      if (typeof provider !== 'string' || !VALID_CHANNEL_PROVIDERS.has(provider)) {
        return res.status(400).json({
          ok: false,
          error: 'VALIDATION',
          message: `Invalid provider "${String(provider)}" for channel "${channel}". Valid: ${[...VALID_CHANNEL_PROVIDERS].join(', ')}`,
        });
      }
    }
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(channels)) {
      const key = String(k).slice(0, 50).replace(/[^a-zA-Z0-9_-]/g, '');
      if (key) sanitized[key] = String(v);
    }
    await saveChannelRouting(guildId, sanitized);
    return res.json({ ok: true, guildId, channels: sanitized, updatedAt: new Date().toISOString() });
  });

  // ── D-06: Sync HIGH_RISK_APPROVAL_ACTIONS to OpenShell network policy ──

  router.post('/agent/runtime/sandbox-policy-sync', requireAdmin, adminActionRateLimiter, async (_req, res, next) => {
    try {
      const result = await syncHighRiskActionsToSandboxPolicy();
      return res.json({ ok: result.synced, ...result });
    } catch (error) {
      next(error);
    }
  });

  // ──── Self-Improvement Loop Endpoints ───────────────────────────────────────

  router.get('/agent/runtime/self-improvement/gradient', requireAdmin, async (_req, res, next) => {
    try {
      const gradient = await computeSystemGradient();
      return res.json({ ok: true, gradient });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/self-improvement/convergence', requireAdmin, async (_req, res, next) => {
    try {
      const report = await computeConvergenceReport();
      return res.json({ ok: true, convergence: report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/self-improvement/cross-loop', requireAdmin, async (_req, res, next) => {
    try {
      const origins = getCrossLoopOriginsSnapshot();
      const outcomes = await evaluateCrossLoopOutcomes();
      return res.json({ ok: true, origins: origins.slice(0, 50), outcomes });
    } catch (error) {
      next(error);
    }
  });

}
