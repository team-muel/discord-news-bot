import { doc } from './obsidianDocBuilder';
import {
  buildEntityArtifactPath,
  buildKnowledgePathIndex,
  buildTopicArtifactPath,
  describeKnowledgePath,
  INDEX_PATH,
  LINT_PATH,
  LOG_PATH,
  normalizePath,
  stripKnownSourcePrefix,
  SUPERVISOR_PATH,
  CONTROL_TOWER_PATHS,
  toKnowledgeWikilink,
} from './obsidianPathUtils';
import { buildKnowledgeAccessProfile, cloneCatalogEntry, cloneCatalogPolicy } from './obsidianCatalogService';
import type {
  ObsidianKnowledgeCatalogDocument,
  ObsidianKnowledgeCompilationStats,
  ObsidianKnowledgeControlBlueprint,
  ObsidianKnowledgeLintIssue,
  ObsidianKnowledgeLintSummary,
  ObsidianSemanticLintAuditIssue,
  ObsidianSemanticLintAuditResult,
} from './knowledgeCompilerService';

type ObsidianKnowledgeSupervisorAction = {
  kind: 'refresh-grounding' | 'repair-lifecycle' | 'resolve-canonical-collision' | 'backfill-shared-coverage' | 'repair-graph-quality' | 'resolve-runtime-mismatch';
  severity: 'low' | 'medium' | 'high';
  summary: string;
  targetPaths: string[];
  suggestedNextStep: string;
};

type ObsidianKnowledgeSupervisorReport = {
  healthy: boolean;
  summary: string;
  actionCount: number;
  focusPaths: string[];
  actions: ObsidianKnowledgeSupervisorAction[];
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

const getHighestSeverity = (values: Array<'low' | 'medium' | 'high'>): 'low' | 'medium' | 'high' => {
  if (values.includes('high')) {
    return 'high';
  }
  if (values.includes('medium')) {
    return 'medium';
  }
  return 'low';
};

const isLikelyKnowledgePath = (value: string): boolean => {
  const normalized = normalizePath(stripKnownSourcePrefix(value));
  return normalized.includes('/') || normalized.toLowerCase().endsWith('.md');
};

const renderKnowledgeReference = (value: string): string => {
  const normalized = normalizePath(stripKnownSourcePrefix(value));
  if (!normalized) {
    return 'n/a';
  }
  return isLikelyKnowledgePath(normalized) ? toKnowledgeWikilink(normalized) : normalized;
};

const dedupeSupervisorActions = (actions: ObsidianKnowledgeSupervisorAction[]): ObsidianKnowledgeSupervisorAction[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgeSupervisorAction[] = [];
  for (const action of actions) {
    const key = `${action.kind}:${action.summary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      ...action,
      targetPaths: dedupeStrings(action.targetPaths),
    });
  }
  return result;
};

const buildSupervisorActionsFromLintSummary = (summary: ObsidianKnowledgeLintSummary): ObsidianKnowledgeSupervisorAction[] => {
  const actions: ObsidianKnowledgeSupervisorAction[] = [];
  const issuesByKind = (kind: ObsidianKnowledgeLintIssue['kind']) => summary.issues.filter((issue) => issue.kind === kind);

  if (summary.missingSourceRefs > 0) {
    actions.push({
      kind: 'refresh-grounding',
      severity: 'medium',
      summary: `${summary.missingSourceRefs} knowledge notes still lack source_refs grounding.`,
      targetPaths: issuesByKind('missing_source_refs').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Refresh source_refs before treating the note as durable semantic memory.',
    });
  }

  if (summary.invalidLifecycleNotes > 0) {
    actions.push({
      kind: 'repair-lifecycle',
      severity: 'medium',
      summary: `${summary.invalidLifecycleNotes} knowledge notes have inconsistent lifecycle metadata.`,
      targetPaths: issuesByKind('invalid_lifecycle').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Normalize status, valid_at, invalid_at, and supersession metadata so lifecycle stays machine-readable.',
    });
  }

  if (summary.canonicalCollisions > 0) {
    actions.push({
      kind: 'resolve-canonical-collision',
      severity: 'high',
      summary: `${summary.canonicalCollisions} canonical entities still have multiple active notes.`,
      targetPaths: issuesByKind('canonical_collision').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Close the collision with supersedes, invalid_at, or an explicit canonical winner.',
    });
  }

  if (summary.staleActiveNotes > 0) {
    actions.push({
      kind: 'repair-lifecycle',
      severity: 'medium',
      summary: `${summary.staleActiveNotes} active knowledge notes look stale enough to refresh or supersede.`,
      targetPaths: issuesByKind('stale_active_note').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Refresh, invalidate, or supersede stale active notes so the graph stops advertising outdated truth.',
    });
  }

  return actions;
};

const buildSupervisorActionsFromSemanticIssues = (issues: ObsidianSemanticLintAuditIssue[]): ObsidianKnowledgeSupervisorAction[] => {
  const actions: ObsidianKnowledgeSupervisorAction[] = [];

  const groupedIssues = {
    coverage: issues.filter((issue) => issue.kind === 'coverage-gap'),
    graph: issues.filter((issue) => issue.kind === 'graph-quality'),
    runtime: issues.filter((issue) => issue.kind === 'runtime-doc-mismatch'),
  };

  if (groupedIssues.coverage.length > 0) {
    actions.push({
      kind: 'backfill-shared-coverage',
      severity: getHighestSeverity(groupedIssues.coverage.map((issue) => issue.severity)),
      summary: `${groupedIssues.coverage.length} shared coverage gaps are still open in the semantic owner surface.`,
      targetPaths: groupedIssues.coverage.flatMap((issue) => issue.evidenceRefs),
      suggestedNextStep: 'Backfill missing shared wiki targets before repo mirrors become the only visible truth.',
    });
  }

  if (groupedIssues.graph.length > 0) {
    actions.push({
      kind: 'repair-graph-quality',
      severity: getHighestSeverity(groupedIssues.graph.map((issue) => issue.severity)),
      summary: `${groupedIssues.graph.length} graph-quality issues are still blocking clean traversal.`,
      targetPaths: groupedIssues.graph.flatMap((issue) => issue.evidenceRefs),
      suggestedNextStep: 'Repair unresolved links, orphans, or missing required properties before widening downstream automation.',
    });
  }

  if (groupedIssues.runtime.length > 0) {
    actions.push({
      kind: 'resolve-runtime-mismatch',
      severity: getHighestSeverity(groupedIssues.runtime.map((issue) => issue.severity)),
      summary: `${groupedIssues.runtime.length} runtime-vs-doc mismatches are still visible in the active write/read path.`,
      targetPaths: groupedIssues.runtime.flatMap((issue) => issue.evidenceRefs),
      suggestedNextStep: 'Align runtime routing, adapter selection, and vault parity with the documented semantic-owner path.',
    });
  }

  return actions;
};

const cloneBlueprint = (value: ObsidianKnowledgeControlBlueprint): ObsidianKnowledgeControlBlueprint => ({
  model: value.model,
  controlPaths: [...value.controlPaths],
  reflectionChecklist: [...value.reflectionChecklist],
  planes: value.planes.map((plane) => ({
    ...plane,
    pathPatterns: [...plane.pathPatterns],
    primaryQuestions: [...plane.primaryQuestions],
  })),
});

export const buildKnowledgeSupervisorReport = async (params: {
  triggeredPath: string;
  entityKey: string | null;
  topics: string[];
  lintSummary: ObsidianKnowledgeLintSummary;
}, deps: {
  runSemanticLintAudit: (params: {
    maxIssues?: number;
    includeGraphAudit?: boolean;
    persistFindings?: boolean;
  }) => Promise<ObsidianSemanticLintAuditResult>;
}): Promise<ObsidianKnowledgeSupervisorReport> => {
  const semanticAudit = await deps.runSemanticLintAudit({
    maxIssues: 8,
    includeGraphAudit: true,
    persistFindings: false,
  });
  const actions = dedupeSupervisorActions([
    ...buildSupervisorActionsFromLintSummary(params.lintSummary),
    ...buildSupervisorActionsFromSemanticIssues(semanticAudit.issues.filter((issue) => issue.kind !== 'compiler-lint')),
  ]);
  const focusPaths = dedupeStrings([
    params.triggeredPath,
    params.entityKey ? buildEntityArtifactPath(params.entityKey) : null,
    ...params.topics.map((topic) => buildTopicArtifactPath(topic)),
    ...actions.flatMap((action) => action.targetPaths.filter((value) => isLikelyKnowledgePath(value))),
  ]).slice(0, 12);
  const highestSeverity = actions.length > 0
    ? getHighestSeverity(actions.map((action) => action.severity))
    : 'low';

  return {
    healthy: actions.length === 0,
    summary: actions.length === 0
      ? `Supervisor sees no blocking follow-up actions after compiling ${toKnowledgeWikilink(params.triggeredPath)}.`
      : `Supervisor flagged ${actions.length} follow-up action${actions.length === 1 ? '' : 's'} after compiling ${toKnowledgeWikilink(params.triggeredPath)}. Highest severity: ${highestSeverity}.`,
    actionCount: actions.length,
    focusPaths,
    actions,
  };
};

export const buildSupervisorArtifact = (params: {
  generatedAt: string;
  triggeredPath: string;
  entityKey: string | null;
  topics: string[];
  report: ObsidianKnowledgeSupervisorReport;
  reflectionChecklist: string[];
}) => {
  const descriptor = describeKnowledgePath(params.triggeredPath);
  const builder = doc()
    .title('Knowledge Control Supervisor')
    .tag('knowledge-control', 'auto-generated', 'supervisor')
    .property('schema', 'knowledge-supervisor/v1')
    .property('source', 'knowledge-compiler')
    .property('generated_at', params.generatedAt)
    .property('action_count', params.report.actionCount)
    .property('healthy', params.report.healthy)
    .property('trigger_path', params.triggeredPath)
    .property('plane', descriptor.plane)
    .property('concern', descriptor.concern);

  if (params.entityKey) {
    builder.property('entity_key', params.entityKey);
  }

  builder.section('Summary')
    .line(params.report.summary)
    .line(`Generated at: ${params.generatedAt}`)
    .line(`Trigger: ${toKnowledgeWikilink(params.triggeredPath)}`)
    .line(`Plane: ${descriptor.plane} | Concern: ${descriptor.concern}`)
    .line(`Topics: ${params.topics.length > 0 ? params.topics.join(', ') : 'none'}`);

  if (params.report.focusPaths.length > 0) {
    builder.section('Focus Paths').bullets(params.report.focusPaths.map((value) => renderKnowledgeReference(value)));
  }

  if (params.report.actions.length === 0) {
    builder.section('Priority Actions').line('No immediate supervisor actions. Keep monitoring index, log, and semantic lint drift.');
  } else {
    builder.section('Priority Actions').table(
      ['Severity', 'Kind', 'Targets', 'Next'],
      params.report.actions.map((action) => [
        action.severity,
        action.kind,
        action.targetPaths.length > 0 ? action.targetPaths.slice(0, 3).map((value) => renderKnowledgeReference(value)).join(', ') : 'n/a',
        action.suggestedNextStep,
      ]),
    );
  }

  builder.section('Verification Checklist').bullets([...params.reflectionChecklist]);

  return builder.buildWithFrontmatter();
};

export const buildKnowledgeControlSurface = (params: {
  compiler: ObsidianKnowledgeCompilationStats;
  artifactPaths: string[];
  blueprint: ObsidianKnowledgeControlBlueprint;
  backfillCatalog: ObsidianKnowledgeCatalogDocument;
}) => {
  const supervisorAvailable = params.artifactPaths.includes(SUPERVISOR_PATH);
  return {
    compiler: params.compiler,
    artifactPaths: params.artifactPaths,
    artifactSupport: {
      enabled: true,
      queryParam: 'artifact',
      acceptedAliases: [
        'index',
        'log',
        'lint',
        'supervisor',
        'blueprint',
        'canonical-map',
        'cadence',
        'gate-entrypoints',
        'topic:<slug>',
        'entity:<slug>',
      ],
    },
    supervisor: {
      alias: 'supervisor',
      path: SUPERVISOR_PATH,
      available: supervisorAvailable,
      includedInLastRun: supervisorAvailable && params.compiler.lastArtifacts.includes(SUPERVISOR_PATH),
      lastCompiledAt: params.compiler.lastCompiledAt,
    },
    controlPaths: [...CONTROL_TOWER_PATHS],
    blueprint: cloneBlueprint(params.blueprint),
    backfillCatalog: {
      schemaVersion: params.backfillCatalog.schemaVersion,
      updatedAt: params.backfillCatalog.updatedAt,
      description: params.backfillCatalog.description,
      policy: cloneCatalogPolicy(params.backfillCatalog.policy),
      entries: params.backfillCatalog.entries.map(cloneCatalogEntry),
    },
    accessProfile: buildKnowledgeAccessProfile(params.backfillCatalog),
    bundleSupport: {
      enabled: true,
      queryParam: 'bundleFor',
      acceptedAliases: ['blueprint', 'canonical-map', 'cadence', 'gate-entrypoints'],
    },
    pathIndex: buildKnowledgePathIndex([
      ...CONTROL_TOWER_PATHS.map((path) => ({ path, generated: false })),
      ...params.artifactPaths.map((path) => ({ path, generated: true })),
    ]),
  };
};