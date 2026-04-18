import { getAgentRoleWorkersHealthSnapshot, listAgentRoleWorkerSpecs } from '../../../services/agent/agentRoleWorkerService';
import { getRuntimeSchedulerPolicySnapshot } from '../../../services/runtime/runtimeSchedulerPolicyService';
import { getMemoryJobRunnerStats, getMemoryQueueHealthSnapshot } from '../../../services/memory/memoryJobRunner';
import { getObsidianInboxChatLoopStats } from '../../../services/obsidian/obsidianInboxChatLoopService';
import { getObsidianLoreSyncLoopStats } from '../../../services/obsidian/obsidianLoreSyncService';
import { getObsidianMaintenanceControlSurface } from '../../../services/obsidian/obsidianMaintenanceControlService';
import { getRetrievalEvalLoopStats } from '../../../services/eval/retrievalEvalLoopService';
import { getRewardSignalLoopStatus } from '../../../services/eval/rewardSignalLoopService';
import { getEvalAutoPromoteLoopStatus } from '../../../services/eval/evalAutoPromoteLoopService';
import { getEvalMaintenanceControlSurface } from '../../../services/eval/evalMaintenanceControlService';
import {
  getOpenJarvisMemorySyncStatus,
  getOpenJarvisMemorySyncScheduleStatus,
} from '../../../services/openjarvis/openjarvisMemorySyncStatusService';
import { buildGoNoGoReport } from '../../../services/goNoGoService';
import { buildToolLearningWeeklyReport } from '../../../services/toolLearningService';
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
} from '../../../services/obsidian/knowledgeCompilerService';
import { getLatestObsidianGraphAuditSnapshot, getObsidianGraphAuditLoopStats } from '../../../services/obsidian/obsidianQualityService';
import { getObsidianRetrievalBoundarySnapshot } from '../../../services/obsidian/obsidianRagService';
import { getObsidianAdapterRuntimeStatus, getObsidianVaultLiveHealthStatus } from '../../../services/obsidian/router';
import { loadOperatingBaseline } from '../../../services/runtime/operatingBaseline';
import { getLocalAutonomySupervisorLoopStats } from '../../../services/runtime/localAutonomySupervisorService';
import { getPendingIntentCount } from '../../../services/intent';
import { toBoundedInt, toStringParam } from '../../../utils/validation';
import { getObsidianVaultRoot, getObsidianVaultRuntimeInfo, type ObsidianVaultRuntimeInfo } from '../../../utils/obsidianEnv';
import { buildDoctorReport } from '../../../../scripts/local-ai-stack-control.mjs';

import { dedupeStrings } from './paramValidation';

const LOCAL_AUTONOMY_PROFILE = 'local-nemoclaw-max-delegation';

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

const extractAffectedServices = (paths: string[]): string[] => {
  const services = paths
    .map((value) => String(value || '').trim().replace(/\\/g, '/'))
    .map((value) => value.match(/ops\/services\/([^/]+)/)?.[1] || '')
    .filter(Boolean);
  return dedupeStrings(services).slice(0, 8);
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

  const [vaultHealth, graphAudit, retrievalBoundary, schedulerPolicy, workerHealth, internalKnowledge, localAutonomy, openjarvisScheduler] = await Promise.all([
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
    includeRuntime
      ? buildDoctorReport({ profile: LOCAL_AUTONOMY_PROFILE }).catch(() => null)
      : Promise.resolve(null),
    includeRuntime || includeDocs
      ? getOpenJarvisMemorySyncScheduleStatus().catch(() => null)
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
    ...(internalKnowledge?.artifacts || []).map((artifact: { title: string }) => artifact.title),
    ...(internalKnowledge?.artifacts || []).map((artifact: { locator: string }) => artifact.locator),
  ]);
  const incidentServiceHints = dedupeStrings([
    ...extractAffectedServices((bundle?.artifacts || []).map((artifact) => artifact.locator)),
    ...extractAffectedServices((internalKnowledge?.artifacts || []).map((artifact: { locator: string }) => artifact.locator)),
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
  const openjarvisMemorySync = getOpenJarvisMemorySyncStatus();
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
        obsidianGraphAuditLoop: getObsidianGraphAuditLoopStats(),
        retrievalEvalLoop: getRetrievalEvalLoopStats(),
        rewardSignalLoop: getRewardSignalLoopStatus(),
        evalAutoPromoteLoop: getEvalAutoPromoteLoopStatus(),
        localAutonomySupervisorLoop: getLocalAutonomySupervisorLoopStats(),
      },
      controlSurfaces: {
        obsidianMaintenance: getObsidianMaintenanceControlSurface(),
        evalMaintenance: getEvalMaintenanceControlSurface(),
      },
      localAutonomy,
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
    openjarvis: includeDocs || includeRuntime
      ? {
        memorySync: openjarvisMemorySync,
        scheduler: openjarvisScheduler,
      }
      : undefined,
    localAutonomy: includeRuntime ? localAutonomy : undefined,
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
            artifactLocators: internalKnowledge.artifacts.slice(0, 3).map((artifact: { locator: string }) => artifact.locator),
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
    controlSurfaces: runtimeSummary?.controlSurfaces,
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
    ? (obsidianRecord.promotionBacklinks as PromotionBacklink[])
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