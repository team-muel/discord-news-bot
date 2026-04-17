const compact = (value: unknown): string => String(value || '').trim();
const toNullableString = (value: unknown): string | null => compact(value) || null;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const toStringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.map((entry) => compact(entry)).filter(Boolean)
  : [];

const WORKFLOW_ARTIFACT_REF_KINDS = ['repo-file', 'vault-note', 'log', 'url', 'git-ref', 'workflow-session', 'other'] as const;
const WORKFLOW_ARTIFACT_PLANES = ['github', 'obsidian', 'hot-state', 'external', 'other'] as const;
const WORKFLOW_GITHUB_SETTLEMENT_KINDS = ['repo-file', 'branch', 'commit', 'pull-request', 'issue', 'ci-run', 'review', 'release', 'other'] as const;

const normalizeWorkflowArtifactRefKind = (value: unknown): string => {
  const kind = compact(value).toLowerCase();
  return (WORKFLOW_ARTIFACT_REF_KINDS as readonly string[]).includes(kind)
    ? kind
    : 'other';
};

const looksLikeWorkflowArtifactPath = (value: unknown): boolean => {
  const normalized = compact(value).replace(/\\/g, '/');
  if (!normalized || /\r|\n/.test(normalized) || /^https?:\/\//i.test(normalized)) {
    return false;
  }
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) {
    return true;
  }

  return /^(src|docs|plans|ops|guilds|chat|retros|tmp|config|scripts)\/.+/.test(normalized)
    || /^[^\s]+\/(?:[^\s].*)\.[A-Za-z0-9]{1,10}$/.test(normalized);
};

const inferWorkflowArtifactRefKindFromLocator = (locator: unknown): string => {
  const normalized = compact(locator).replace(/\\/g, '/').toLowerCase();
  if (/^https?:\/\//.test(normalized)) {
    return 'url';
  }
  if (normalized.startsWith('workflow session:') || normalized.startsWith('supabase:') || normalized.startsWith('local-file:')) {
    return 'workflow-session';
  }
  if (normalized.endsWith('.log') || /(^|\/)(logs?|tmp)\//.test(normalized)) {
    return 'log';
  }
  if (normalized.endsWith('.md') && (/^\/vault\//.test(normalized) || /^(chat|guilds|ops|plans|retros)\//.test(normalized))) {
    return 'vault-note';
  }
  if (/^[0-9a-f]{7,40}$/i.test(normalized) || normalized.startsWith('branch:')) {
    return 'git-ref';
  }
  if (looksLikeWorkflowArtifactPath(normalized)) {
    return 'repo-file';
  }
  return 'other';
};

const resolveWorkflowArtifactRefKind = (params: {
  locator?: unknown;
  refKind?: unknown;
}): string => {
  if (compact(params.refKind)) {
    return normalizeWorkflowArtifactRefKind(params.refKind);
  }
  return inferWorkflowArtifactRefKindFromLocator(params.locator);
};

const normalizeWorkflowArtifactPlane = (value: unknown): string | null => {
  const plane = compact(value).toLowerCase();
  if (!plane) {
    return null;
  }

  return (WORKFLOW_ARTIFACT_PLANES as readonly string[]).includes(plane)
    ? plane
    : 'other';
};

const normalizeWorkflowGithubSettlementKind = (value: unknown): string | null => {
  const settlementKind = compact(value).toLowerCase();
  if (!settlementKind) {
    return null;
  }

  return (WORKFLOW_GITHUB_SETTLEMENT_KINDS as readonly string[]).includes(settlementKind)
    ? settlementKind
    : 'other';
};

const inferWorkflowArtifactPlane = (params: {
  locator?: unknown;
  refKind?: unknown;
  artifactPlane?: unknown;
}): string | null => {
  const explicitPlane = normalizeWorkflowArtifactPlane(params.artifactPlane);
  if (explicitPlane) {
    return explicitPlane;
  }

  const refKind = resolveWorkflowArtifactRefKind({ locator: params.locator, refKind: params.refKind });
  const locator = compact(params.locator).replace(/\\/g, '/').toLowerCase();

  if (refKind === 'repo-file' || refKind === 'git-ref') {
    return 'github';
  }
  if (refKind === 'vault-note') {
    return 'obsidian';
  }
  if (refKind === 'workflow-session' || refKind === 'log') {
    return 'hot-state';
  }
  if (refKind === 'url') {
    return /^https?:\/\/(www\.)?(github\.com|raw\.githubusercontent\.com)\//.test(locator)
      ? 'github'
      : 'external';
  }

  return locator ? 'other' : null;
};

const inferWorkflowGithubSettlementKind = (params: {
  locator?: unknown;
  refKind?: unknown;
  artifactPlane?: unknown;
  githubSettlementKind?: unknown;
}): string | null => {
  const explicitSettlementKind = normalizeWorkflowGithubSettlementKind(params.githubSettlementKind);
  if (explicitSettlementKind) {
    return explicitSettlementKind;
  }

  const artifactPlane = inferWorkflowArtifactPlane(params);
  if (artifactPlane !== 'github') {
    return null;
  }

  const refKind = resolveWorkflowArtifactRefKind({ locator: params.locator, refKind: params.refKind });
  const locator = compact(params.locator).replace(/\\/g, '/').toLowerCase();

  if (refKind === 'repo-file') {
    return 'repo-file';
  }

  if (refKind === 'git-ref') {
    if (locator.startsWith('branch:')) {
      return 'branch';
    }
    if (/^[0-9a-f]{7,40}$/i.test(locator)) {
      return 'commit';
    }
    return 'other';
  }

  if (refKind === 'url') {
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(locator)) {
      return locator.includes('pullrequestreview') ? 'review' : 'pull-request';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/issues\/\d+/.test(locator)) {
      return 'issue';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/.test(locator)) {
      return 'ci-run';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/(commit|commits)\/[0-9a-f]{7,40}/.test(locator)) {
      return 'commit';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/tree\/[^/?#]+/.test(locator)) {
      return 'branch';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/releases\/tag\/[^/?#]+/.test(locator)) {
      return 'release';
    }
    if (/^https?:\/\/(www\.)?(github\.com\/[^/]+\/[^/]+\/blob\/|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)/.test(locator)) {
      return 'repo-file';
    }
  }

  return 'other';
};

const buildWorkflowArtifactRefPayloadEntry = (ref: Record<string, unknown>): Record<string, unknown> | null => {
  const locator = compact(ref.locator);
  if (!locator) {
    return null;
  }

  const refKind = resolveWorkflowArtifactRefKind({
    locator,
    refKind: ref.refKind ?? ref.ref_kind,
  });
  const normalizedRef: Record<string, unknown> = {
    locator,
    ref_kind: refKind,
    title: toNullableString(ref.title),
  };
  const artifactPlane = inferWorkflowArtifactPlane({
    locator,
    refKind,
    artifactPlane: ref.artifactPlane ?? ref.artifact_plane,
  });
  if (artifactPlane) {
    normalizedRef.artifact_plane = artifactPlane;
  }
  const githubSettlementKind = inferWorkflowGithubSettlementKind({
    locator,
    refKind,
    artifactPlane,
    githubSettlementKind: ref.githubSettlementKind ?? ref.github_settlement_kind,
  });
  if (githubSettlementKind) {
    normalizedRef.github_settlement_kind = githubSettlementKind;
  }
  return normalizedRef;
};

const parseWorkflowArtifactRefSummaryEntries = (params: {
  entries?: unknown;
  createdAt?: unknown;
  fallbackLane?: string;
  runtimeLane?: unknown;
  sourceStepName?: unknown;
  sourceEvent?: unknown;
}) => {
  const fallbackLane = compact(params.fallbackLane) || DEFAULT_WORKFLOW_RUNTIME_LANE;
  const eventRuntimeLane = compact(params.runtimeLane)
    ? normalizeWorkflowRuntimeLane(params.runtimeLane, fallbackLane)
    : fallbackLane;
  const entries = Array.isArray(params.entries) ? params.entries : [];

  return entries.flatMap((entry) => {
    if (!isRecord(entry) || !compact(entry.locator)) {
      return [];
    }

    const locator = compact(entry.locator);
    const refKind = resolveWorkflowArtifactRefKind({ locator, refKind: entry.ref_kind ?? entry.refKind });
    return [{
      createdAt: toNullableString(params.createdAt),
      locator,
      refKind,
      title: toNullableString(entry.title),
      artifactPlane: inferWorkflowArtifactPlane({
        locator,
        refKind,
        artifactPlane: entry.artifact_plane ?? entry.artifactPlane,
      }),
      githubSettlementKind: inferWorkflowGithubSettlementKind({
        locator,
        refKind,
        artifactPlane: entry.artifact_plane ?? entry.artifactPlane,
        githubSettlementKind: entry.github_settlement_kind ?? entry.githubSettlementKind,
      }),
      runtimeLane: compact(entry.runtime_lane)
        ? normalizeWorkflowRuntimeLane(entry.runtime_lane, eventRuntimeLane)
        : eventRuntimeLane,
      sourceStepName: toNullableString(entry.source_step_name ?? entry.sourceStepName) || toNullableString(params.sourceStepName),
      sourceEvent: toNullableString(entry.source_event ?? entry.sourceEvent) || toNullableString(params.sourceEvent),
    }];
  });
};

export const DEFAULT_WORKFLOW_RUNTIME_LANE = 'system-internal';

export const normalizeWorkflowRuntimeLane = (value: unknown, fallbackLane = DEFAULT_WORKFLOW_RUNTIME_LANE): string => {
  const lane = compact(value).toLowerCase();
  if (!lane) return fallbackLane;
  return lane;
};

export const inferWorkflowRuntimeLane = (params: {
  workflowName?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
}, fallbackLane = DEFAULT_WORKFLOW_RUNTIME_LANE): string => {
  if (compact(params.metadata?.runtime_lane)) {
    return normalizeWorkflowRuntimeLane(params.metadata?.runtime_lane, fallbackLane);
  }

  const workflowName = compact(params.workflowName).toLowerCase();
  const scope = compact(params.scope).toLowerCase();
  if (workflowName.startsWith('sprint')) {
    return 'system-sprint';
  }
  if (workflowName === 'goal-pipeline') {
    if (scope && !['system', 'mcp'].includes(scope)) {
      return 'public-guild';
    }
    return fallbackLane;
  }
  return fallbackLane;
};

export const buildWorkflowRecallRequestPayload = (request: {
  payload?: Record<string, unknown>;
  blockedAction?: unknown;
  nextAction?: unknown;
  requestedBy?: unknown;
  runtimeLane?: unknown;
  failedStepNames?: unknown[];
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    ...(request.payload || {}),
  };
  if (compact(request.blockedAction)) payload.blocked_action = compact(request.blockedAction);
  if (compact(request.nextAction)) payload.next_action = compact(request.nextAction);
  if (compact(request.requestedBy)) payload.requested_by = compact(request.requestedBy);
  if (compact(request.runtimeLane)) payload.runtime_lane = normalizeWorkflowRuntimeLane(request.runtimeLane);
  if (request.failedStepNames?.length) {
    payload.failed_step_names = request.failedStepNames.map((name) => compact(name)).filter(Boolean);
  }
  return payload;
};

export const buildWorkflowDecisionDistillatePayload = (distillate: {
  payload?: Record<string, unknown>;
  nextAction?: unknown;
  runtimeLane?: unknown;
  sourceEvent?: unknown;
  promoteAs?: unknown;
  tags?: unknown[];
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    ...(distillate.payload || {}),
  };
  if (compact(distillate.nextAction)) payload.next_action = compact(distillate.nextAction);
  if (compact(distillate.runtimeLane)) payload.runtime_lane = normalizeWorkflowRuntimeLane(distillate.runtimeLane);
  if (compact(distillate.sourceEvent)) payload.source_event = compact(distillate.sourceEvent);
  if (compact(distillate.promoteAs)) payload.promote_as = compact(distillate.promoteAs);
  if (distillate.tags?.length) {
    payload.tags = distillate.tags.map((tag) => compact(tag)).filter(Boolean);
  }
  return payload;
};

export const buildWorkflowCapabilityDemandEvent = (batch: {
  payload?: Record<string, unknown>;
  demands?: Array<Record<string, unknown>>;
  runtimeLane?: unknown;
  sourceEvent?: unknown;
  tags?: unknown;
}): { payload: Record<string, unknown>; decisionReason: string } | null => {
  const demands = (batch.demands || []).flatMap((demand) => {
    const summary = compact(demand.summary);
    if (!summary) {
      return [];
    }

    const normalized: Record<string, unknown> = { summary };
    if (compact(demand.objective)) normalized.objective = compact(demand.objective);
    if (compact(demand.missingCapability)) normalized.missing_capability = compact(demand.missingCapability);
    if (compact(demand.missingSource)) normalized.missing_source = compact(demand.missingSource);
    if (compact(demand.failedOrInsufficientRoute)) {
      normalized.failed_or_insufficient_route = compact(demand.failedOrInsufficientRoute);
    }
    if (compact(demand.cheapestEnablementPath)) {
      normalized.cheapest_enablement_path = compact(demand.cheapestEnablementPath);
    }
    if (compact(demand.proposedOwner)) normalized.proposed_owner = compact(demand.proposedOwner);
    if (compact(demand.recallCondition)) normalized.recall_condition = compact(demand.recallCondition);
    if (compact(demand.runtimeLane)) normalized.runtime_lane = normalizeWorkflowRuntimeLane(demand.runtimeLane);
    if (compact(demand.sourceEvent)) normalized.source_event = compact(demand.sourceEvent);

    const evidenceRefs = toStringArray(demand.evidenceRefs);
    if (evidenceRefs.length > 0) {
      normalized.evidence_refs = evidenceRefs;
    }

    const evidenceRefDetails = Array.isArray(demand.evidenceRefDetails)
      ? demand.evidenceRefDetails.flatMap((ref) => {
        if (!isRecord(ref)) {
          return [];
        }
        const normalizedRef = buildWorkflowArtifactRefPayloadEntry(ref);
        return normalizedRef ? [normalizedRef] : [];
      })
      : [];
    if (evidenceRefDetails.length > 0) {
      normalized.evidence_ref_details = evidenceRefDetails;
    }

    const tags = toStringArray(demand.tags);
    if (tags.length > 0) {
      normalized.tags = tags;
    }

    return [normalized];
  });

  if (demands.length === 0) {
    return null;
  }

  const payload: Record<string, unknown> = {
    ...(batch.payload || {}),
    demands,
  };
  if (compact(batch.runtimeLane)) payload.runtime_lane = normalizeWorkflowRuntimeLane(batch.runtimeLane);
  if (compact(batch.sourceEvent)) payload.source_event = compact(batch.sourceEvent);
  const tags = toStringArray(batch.tags);
  if (tags.length > 0) payload.tags = tags;

  const decisionReason = demands.length === 1
    ? String(demands[0].summary || '').trim() || 'capability demand captured'
    : `${demands.length} capability demands captured`;

  return { payload, decisionReason };
};

export const buildWorkflowArtifactRefEvent = (batch: {
  payload?: Record<string, unknown>;
  refs?: Array<Record<string, unknown>>;
  runtimeLane?: unknown;
  sourceStepName?: unknown;
  sourceEvent?: unknown;
}): { payload: Record<string, unknown>; decisionReason: string } | null => {
  const refs = (batch.refs || [])
    .map((ref) => {
      const normalizedRef: Record<string, unknown> = {
        locator: compact(ref.locator),
        ref_kind: normalizeWorkflowArtifactRefKind(ref.refKind),
        title: toNullableString(ref.title),
      };
      const artifactPlane = inferWorkflowArtifactPlane({
        locator: ref.locator,
        refKind: ref.refKind,
        artifactPlane: ref.artifactPlane,
      });
      if (artifactPlane) {
        normalizedRef.artifact_plane = artifactPlane;
      }
      const githubSettlementKind = inferWorkflowGithubSettlementKind({
        locator: ref.locator,
        refKind: ref.refKind,
        artifactPlane: ref.artifactPlane,
        githubSettlementKind: ref.githubSettlementKind,
      });
      if (githubSettlementKind) {
        normalizedRef.github_settlement_kind = githubSettlementKind;
      }
      return normalizedRef;
    })
    .filter((ref) => Boolean(ref.locator));

  if (refs.length === 0) {
    return null;
  }

  const payload: Record<string, unknown> = {
    ...(batch.payload || {}),
    refs,
  };
  if (compact(batch.runtimeLane)) payload.runtime_lane = normalizeWorkflowRuntimeLane(batch.runtimeLane);
  if (compact(batch.sourceStepName)) payload.source_step_name = compact(batch.sourceStepName);
  if (compact(batch.sourceEvent)) payload.source_event = compact(batch.sourceEvent);

  return {
    payload,
    decisionReason: compact(batch.sourceStepName)
      ? `artifact refs from ${compact(batch.sourceStepName)}`
      : `${refs.length} artifact refs captured`,
  };
};

export const parseWorkflowRecallRequestSummary = (
  row: {
    created_at?: unknown;
    decision_reason?: unknown;
    evidence_id?: unknown;
    payload?: unknown;
  } | null,
  fallbackLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
) => {
  if (!row) return null;
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    createdAt: toNullableString(row.created_at),
    decisionReason: toNullableString(row.decision_reason),
    evidenceId: toNullableString(row.evidence_id),
    blockedAction: toNullableString(payload.blocked_action),
    nextAction: toNullableString(payload.next_action),
    requestedBy: toNullableString(payload.requested_by),
    runtimeLane: compact(payload.runtime_lane)
      ? normalizeWorkflowRuntimeLane(payload.runtime_lane, fallbackLane)
      : fallbackLane,
    failedStepNames: toStringArray(payload.failed_step_names),
  };
};

export const parseWorkflowDecisionDistillateSummary = (
  row: {
    created_at?: unknown;
    decision_reason?: unknown;
    evidence_id?: unknown;
    payload?: unknown;
  } | null,
  fallbackLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
) => {
  if (!row) return null;
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    createdAt: toNullableString(row.created_at),
    summary: toNullableString(row.decision_reason),
    evidenceId: toNullableString(row.evidence_id),
    nextAction: toNullableString(payload.next_action),
    runtimeLane: compact(payload.runtime_lane)
      ? normalizeWorkflowRuntimeLane(payload.runtime_lane, fallbackLane)
      : fallbackLane,
    sourceEvent: toNullableString(payload.source_event),
    promoteAs: toNullableString(payload.promote_as),
    tags: toStringArray(payload.tags),
  };
};

export const parseWorkflowCapabilityDemandSummaries = (
  row: {
    created_at?: unknown;
    decision_reason?: unknown;
    payload?: unknown;
  } | null,
  fallbackLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
) => {
  if (!row) return [];
  const payload = isRecord(row.payload) ? row.payload : {};
  const eventRuntimeLane = compact(payload.runtime_lane)
    ? normalizeWorkflowRuntimeLane(payload.runtime_lane, fallbackLane)
    : fallbackLane;
  const eventSourceEvent = toNullableString(payload.source_event);
  const eventTags = toStringArray(payload.tags);
  const hasLegacyDemandShape = [
    payload.summary,
    payload.objective,
    payload.missing_capability,
    payload.missing_source,
    payload.failed_or_insufficient_route,
    payload.cheapest_enablement_path,
    payload.proposed_owner,
    payload.recall_condition,
  ].some((value) => compact(value));
  const rawDemands = Array.isArray(payload.demands)
    ? payload.demands
    : (hasLegacyDemandShape || toStringArray(payload.evidence_refs).length > 0 ? [payload] : []);

  return rawDemands.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const summary = toNullableString(entry.summary) || (hasLegacyDemandShape ? toNullableString(row.decision_reason) : null);
    if (!summary) {
      return [];
    }

    const entryTags = toStringArray(entry.tags);
    const evidenceRefs = toStringArray(entry.evidence_refs);
    const evidenceRefDetails = Array.isArray(entry.evidence_ref_details)
      ? parseWorkflowArtifactRefSummaryEntries({
        entries: entry.evidence_ref_details,
        createdAt: row.created_at,
        fallbackLane: eventRuntimeLane,
        runtimeLane: entry.runtime_lane,
        sourceEvent: entry.source_event || eventSourceEvent,
      })
      : parseWorkflowArtifactRefSummaryEntries({
        entries: evidenceRefs.map((locator) => ({ locator })),
        createdAt: row.created_at,
        fallbackLane: eventRuntimeLane,
        runtimeLane: entry.runtime_lane,
        sourceEvent: entry.source_event || eventSourceEvent,
      });
    return [{
      createdAt: toNullableString(row.created_at),
      summary,
      objective: toNullableString(entry.objective),
      missingCapability: toNullableString(entry.missing_capability),
      missingSource: toNullableString(entry.missing_source),
      failedOrInsufficientRoute: toNullableString(entry.failed_or_insufficient_route),
      cheapestEnablementPath: toNullableString(entry.cheapest_enablement_path),
      proposedOwner: toNullableString(entry.proposed_owner),
      evidenceRefs,
      evidenceRefDetails,
      recallCondition: toNullableString(entry.recall_condition),
      runtimeLane: compact(entry.runtime_lane)
        ? normalizeWorkflowRuntimeLane(entry.runtime_lane, eventRuntimeLane)
        : eventRuntimeLane,
      sourceEvent: toNullableString(entry.source_event) || eventSourceEvent,
      tags: entryTags.length > 0 ? entryTags : eventTags,
    }];
  });
};

export const parseWorkflowArtifactRefSummaries = (
  row: {
    created_at?: unknown;
    payload?: unknown;
  } | null,
  fallbackLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
) => {
  if (!row) return [];
  const payload = isRecord(row.payload) ? row.payload : {};
  return parseWorkflowArtifactRefSummaryEntries({
    entries: payload.refs,
    createdAt: row.created_at,
    fallbackLane,
    runtimeLane: payload.runtime_lane,
    sourceStepName: payload.source_step_name,
    sourceEvent: payload.source_event,
  });
};