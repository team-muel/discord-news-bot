import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFileSync } from '../../utils/atomicWrite';

export type DiscordIngressSurface = 'docs-command' | 'muel-message';
export type DiscordIngressReplyMode = 'private' | 'public' | 'channel';
export type DiscordIngressRouteDecision = 'adapter_accept' | 'legacy_fallback' | 'shadow_only';
export type DiscordIngressFallbackReason = 'adapter_declined' | 'adapter_error' | 'adapter_not_selected' | 'hard_disabled' | 'empty_request' | 'shadow_mode' | 'rollout_holdout';
export type DiscordIngressEvidenceSource = 'live' | 'lab';
export type DiscordIngressPolicyMode = 'default-on' | 'shadow' | 'canary' | 'holdout-only' | 'rollback';

export type DiscordIngressTelemetry = {
  recordedAt: string;
  correlationId: string;
  surface: DiscordIngressSurface;
  guildId: string | null;
  replyMode: DiscordIngressReplyMode;
  selectedAdapterId: string | null;
  adapterId: string | null;
  routeDecision: DiscordIngressRouteDecision;
  fallbackReason: DiscordIngressFallbackReason | null;
  shadowMode: boolean;
  rolloutPercentage: number;
  stableBucket: number;
  selectedByRollout: boolean;
  policyMode: DiscordIngressPolicyMode;
  evidenceSource: DiscordIngressEvidenceSource;
};

export type DiscordIngressExecutionOptions = {
  preferredAdapterId?: string | null;
  hardDisable?: boolean;
  shadowMode?: boolean;
  rolloutPercentage?: number | null;
  rolloutKey?: string | null;
  evidenceSource?: DiscordIngressEvidenceSource;
};

type DiscordIngressSurfaceCounters = {
  total: number;
  selectedByRolloutCount: number;
  adapterAcceptCount: number;
  shadowOnlyCount: number;
  legacyFallbackCount: number;
  holdoutCount: number;
};

type DiscordIngressSurfaceEvidence = DiscordIngressSurfaceCounters & {
  lastDecisionAt: string | null;
  lastTelemetry: DiscordIngressTelemetry | null;
  bySource: Record<DiscordIngressEvidenceSource, DiscordIngressSurfaceCounters>;
};

type DiscordIngressTotalsEvidence = {
  total: number;
  selectedByRolloutCount: number;
  adapterAcceptCount: number;
  shadowOnlyCount: number;
  legacyFallbackCount: number;
  holdoutCount: number;
  hardDisabledCount: number;
  adapterDeclinedCount: number;
  adapterErrorCount: number;
  adapterNotSelectedCount: number;
  emptyRequestCount: number;
  rollbackEvidenceCount: number;
};

type DiscordIngressPolicySnapshot = {
  preferredAdapterId: string | null;
  hardDisable: boolean;
  shadowMode: boolean;
  rolloutPercentage: number;
  mode: DiscordIngressPolicyMode;
  lastUpdatedAt: string | null;
};

type DiscordIngressRollbackEvidence = {
  active: boolean;
  forcedFallbackCount: number;
  forcedFallbackCountBySource: Record<DiscordIngressEvidenceSource, number>;
  lastForcedFallbackAt: string | null;
  lastForcedFallbackSurface: DiscordIngressSurface | null;
  lastForcedFallbackSource: DiscordIngressEvidenceSource | null;
};

type DiscordIngressEvidenceEvent = {
  recordedAt: string;
  telemetry: DiscordIngressTelemetry;
};

export type DiscordIngressCutoverSnapshot = {
  generatedAt: string;
  eligibleSurfaces: DiscordIngressSurface[];
  policyBySurface: Record<DiscordIngressSurface, DiscordIngressPolicySnapshot>;
  totals: DiscordIngressTotalsEvidence;
  totalsBySource: Record<DiscordIngressEvidenceSource, DiscordIngressTotalsEvidence>;
  rollback: DiscordIngressRollbackEvidence;
  surfaces: Record<DiscordIngressSurface, DiscordIngressSurfaceEvidence>;
  recentEvents: DiscordIngressEvidenceEvent[];
};

type DiscordIngressTelemetryEnvelope = {
  correlationId: string;
  surface: DiscordIngressSurface;
  guildId: string | null;
  replyMode: DiscordIngressReplyMode;
};

type DiscordIngressRolloutSubject = {
  guildId: string | null;
  surface: DiscordIngressSurface;
  userId: string;
};

const DISCORD_INGRESS_RECENT_EVENT_LIMIT = 50;

export const DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  'tmp',
  'discord-ingress-cutover',
  'latest.json',
);

const nowIso = (): string => new Date().toISOString();

export const normalizeAdapterId = (value: unknown): string | null => {
  const text = String(value || '').trim().toLowerCase();
  return text || null;
};

export const normalizeRolloutPercentage = (value: unknown, fallback = 100): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.trunc(parsed)));
};

export const computeStableBucket = (key: string): number => {
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 8);
  const parsed = Number.parseInt(digest, 16);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed % 100;
};

export const resolveIngressRolloutKey = (
  subject: DiscordIngressRolloutSubject,
  rawKey: unknown,
): string => {
  const explicit = String(rawKey || '').trim();
  if (explicit) {
    return explicit;
  }

  return [
    subject.guildId || 'dm',
    subject.surface,
    subject.userId,
  ].join(':');
};

export const resolvePolicyMode = (params: {
  hardDisable: boolean;
  shadowMode: boolean;
  rolloutPercentage: number;
}): DiscordIngressPolicyMode => {
  if (params.hardDisable) {
    return 'rollback';
  }
  if (params.shadowMode) {
    return 'shadow';
  }
  if (params.rolloutPercentage <= 0) {
    return 'holdout-only';
  }
  if (params.rolloutPercentage < 100) {
    return 'canary';
  }
  return 'default-on';
};

const cloneSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createSurfaceCounters = (): DiscordIngressSurfaceCounters => ({
  total: 0,
  selectedByRolloutCount: 0,
  adapterAcceptCount: 0,
  shadowOnlyCount: 0,
  legacyFallbackCount: 0,
  holdoutCount: 0,
});

const createSurfaceEvidence = (): DiscordIngressSurfaceEvidence => ({
  ...createSurfaceCounters(),
  lastDecisionAt: null,
  lastTelemetry: null,
  bySource: {
    live: createSurfaceCounters(),
    lab: createSurfaceCounters(),
  },
});

const createTotalsEvidence = (): DiscordIngressTotalsEvidence => ({
  total: 0,
  selectedByRolloutCount: 0,
  adapterAcceptCount: 0,
  shadowOnlyCount: 0,
  legacyFallbackCount: 0,
  holdoutCount: 0,
  hardDisabledCount: 0,
  adapterDeclinedCount: 0,
  adapterErrorCount: 0,
  adapterNotSelectedCount: 0,
  emptyRequestCount: 0,
  rollbackEvidenceCount: 0,
});

const createRollbackEvidence = (): DiscordIngressRollbackEvidence => ({
  active: false,
  forcedFallbackCount: 0,
  forcedFallbackCountBySource: {
    live: 0,
    lab: 0,
  },
  lastForcedFallbackAt: null,
  lastForcedFallbackSurface: null,
  lastForcedFallbackSource: null,
});

const createPolicySnapshot = (): DiscordIngressPolicySnapshot => ({
  preferredAdapterId: null,
  hardDisable: false,
  shadowMode: false,
  rolloutPercentage: 100,
  mode: 'default-on',
  lastUpdatedAt: null,
});

const createEmptyDiscordIngressCutoverSnapshot = (): DiscordIngressCutoverSnapshot => ({
  generatedAt: nowIso(),
  eligibleSurfaces: ['docs-command', 'muel-message'],
  policyBySurface: {
    'docs-command': createPolicySnapshot(),
    'muel-message': createPolicySnapshot(),
  },
  totals: createTotalsEvidence(),
  totalsBySource: {
    live: createTotalsEvidence(),
    lab: createTotalsEvidence(),
  },
  rollback: createRollbackEvidence(),
  surfaces: {
    'docs-command': createSurfaceEvidence(),
    'muel-message': createSurfaceEvidence(),
  },
  recentEvents: [],
});

let discordIngressCutoverSnapshot = createEmptyDiscordIngressCutoverSnapshot();

const readPersistedDiscordIngressCutoverSnapshot = (): DiscordIngressCutoverSnapshot | null => {
  if (!existsSync(DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH, 'utf8');
    if (!raw.trim()) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<DiscordIngressCutoverSnapshot>;
    const fallback = createEmptyDiscordIngressCutoverSnapshot();

    return {
      ...fallback,
      ...parsed,
      policyBySurface: {
        'docs-command': {
          ...fallback.policyBySurface['docs-command'],
          ...(parsed.policyBySurface?.['docs-command'] || {}),
        },
        'muel-message': {
          ...fallback.policyBySurface['muel-message'],
          ...(parsed.policyBySurface?.['muel-message'] || {}),
        },
      },
      totals: {
        ...fallback.totals,
        ...(parsed.totals || {}),
      },
      totalsBySource: {
        live: {
          ...fallback.totalsBySource.live,
          ...(parsed.totalsBySource?.live || {}),
        },
        lab: {
          ...fallback.totalsBySource.lab,
          ...(parsed.totalsBySource?.lab || {}),
        },
      },
      rollback: {
        ...fallback.rollback,
        ...(parsed.rollback || {}),
        forcedFallbackCountBySource: {
          ...fallback.rollback.forcedFallbackCountBySource,
          ...(parsed.rollback?.forcedFallbackCountBySource || {}),
        },
      },
      surfaces: {
        'docs-command': {
          ...fallback.surfaces['docs-command'],
          ...(parsed.surfaces?.['docs-command'] || {}),
          bySource: {
            ...fallback.surfaces['docs-command'].bySource,
            ...(parsed.surfaces?.['docs-command']?.bySource || {}),
            live: {
              ...fallback.surfaces['docs-command'].bySource.live,
              ...(parsed.surfaces?.['docs-command']?.bySource?.live || {}),
            },
            lab: {
              ...fallback.surfaces['docs-command'].bySource.lab,
              ...(parsed.surfaces?.['docs-command']?.bySource?.lab || {}),
            },
          },
        },
        'muel-message': {
          ...fallback.surfaces['muel-message'],
          ...(parsed.surfaces?.['muel-message'] || {}),
          bySource: {
            ...fallback.surfaces['muel-message'].bySource,
            ...(parsed.surfaces?.['muel-message']?.bySource || {}),
            live: {
              ...fallback.surfaces['muel-message'].bySource.live,
              ...(parsed.surfaces?.['muel-message']?.bySource?.live || {}),
            },
            lab: {
              ...fallback.surfaces['muel-message'].bySource.lab,
              ...(parsed.surfaces?.['muel-message']?.bySource?.lab || {}),
            },
          },
        },
      },
      recentEvents: Array.isArray(parsed.recentEvents)
        ? parsed.recentEvents
            .slice(0, DISCORD_INGRESS_RECENT_EVENT_LIMIT)
            .map((event) => ({
              ...event,
              telemetry: {
                ...event.telemetry,
                evidenceSource: event?.telemetry?.evidenceSource === 'lab' ? 'lab' : 'live',
              },
            }))
        : fallback.recentEvents,
      eligibleSurfaces: Array.isArray(parsed.eligibleSurfaces) && parsed.eligibleSurfaces.length > 0
        ? parsed.eligibleSurfaces.filter((surface): surface is DiscordIngressSurface => surface === 'docs-command' || surface === 'muel-message')
        : fallback.eligibleSurfaces,
    };
  } catch {
    return null;
  }
};

const getMutableDiscordIngressCutoverSnapshot = (): DiscordIngressCutoverSnapshot => {
  if (
    discordIngressCutoverSnapshot.totals.total === 0
    && !discordIngressCutoverSnapshot.policyBySurface['docs-command'].lastUpdatedAt
    && !discordIngressCutoverSnapshot.policyBySurface['muel-message'].lastUpdatedAt
  ) {
    const persisted = readPersistedDiscordIngressCutoverSnapshot();
    if (persisted) {
      discordIngressCutoverSnapshot = persisted;
    }
  }

  return discordIngressCutoverSnapshot;
};

const persistDiscordIngressCutoverSnapshot = (): void => {
  mkdirSync(path.dirname(DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH), { recursive: true });
  atomicWriteFileSync(
    DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH,
    `${JSON.stringify(discordIngressCutoverSnapshot, null, 2)}\n`,
  );
};

const applyDiscordIngressPolicySnapshot = (surface: DiscordIngressSurface, policy: {
  preferredAdapterId: string | null;
  hardDisable: boolean;
  shadowMode: boolean;
  rolloutPercentage: number;
}): void => {
  const snapshot = getMutableDiscordIngressCutoverSnapshot();
  const updatedAt = nowIso();
  snapshot.generatedAt = updatedAt;
  snapshot.policyBySurface[surface] = {
    preferredAdapterId: policy.preferredAdapterId,
    hardDisable: policy.hardDisable,
    shadowMode: policy.shadowMode,
    rolloutPercentage: policy.rolloutPercentage,
    mode: resolvePolicyMode(policy),
    lastUpdatedAt: updatedAt,
  };
  snapshot.rollback.active = Object.values(snapshot.policyBySurface).some((item) => item.hardDisable);
  persistDiscordIngressCutoverSnapshot();
};

export const buildDiscordIngressTelemetry = (params: {
  recordedAt: string;
  envelope: DiscordIngressTelemetryEnvelope;
  selectedAdapterId: string | null;
  adapterId: string | null;
  routeDecision: DiscordIngressRouteDecision;
  fallbackReason: DiscordIngressFallbackReason | null;
  shadowMode: boolean;
  rolloutPercentage: number;
  stableBucket: number;
  selectedByRollout: boolean;
  policyMode: DiscordIngressPolicyMode;
  evidenceSource: DiscordIngressEvidenceSource;
}): DiscordIngressTelemetry => {
  return {
    recordedAt: params.recordedAt,
    correlationId: params.envelope.correlationId,
    surface: params.envelope.surface,
    guildId: params.envelope.guildId,
    replyMode: params.envelope.replyMode,
    selectedAdapterId: params.selectedAdapterId,
    adapterId: params.adapterId,
    routeDecision: params.routeDecision,
    fallbackReason: params.fallbackReason,
    shadowMode: params.shadowMode,
    rolloutPercentage: params.rolloutPercentage,
    stableBucket: params.stableBucket,
    selectedByRollout: params.selectedByRollout,
    policyMode: params.policyMode,
    evidenceSource: params.evidenceSource,
  };
};

export const recordDiscordIngressTelemetryEvent = (telemetry: DiscordIngressTelemetry): void => {
  const snapshot = getMutableDiscordIngressCutoverSnapshot();
  const surface = snapshot.surfaces[telemetry.surface];
  const evidenceSource = telemetry.evidenceSource === 'lab' ? 'lab' : 'live';
  const totalsBySource = snapshot.totalsBySource[evidenceSource];
  const surfaceBySource = surface.bySource[evidenceSource];

  snapshot.generatedAt = telemetry.recordedAt;
  snapshot.totals.total += 1;
  totalsBySource.total += 1;
  surface.total += 1;
  surfaceBySource.total += 1;

  if (telemetry.selectedByRollout) {
    snapshot.totals.selectedByRolloutCount += 1;
    totalsBySource.selectedByRolloutCount += 1;
    surface.selectedByRolloutCount += 1;
    surfaceBySource.selectedByRolloutCount += 1;
  }

  if (telemetry.routeDecision === 'adapter_accept') {
    snapshot.totals.adapterAcceptCount += 1;
    totalsBySource.adapterAcceptCount += 1;
    surface.adapterAcceptCount += 1;
    surfaceBySource.adapterAcceptCount += 1;
  }
  if (telemetry.routeDecision === 'shadow_only') {
    snapshot.totals.shadowOnlyCount += 1;
    totalsBySource.shadowOnlyCount += 1;
    surface.shadowOnlyCount += 1;
    surfaceBySource.shadowOnlyCount += 1;
  }
  if (telemetry.routeDecision === 'legacy_fallback') {
    snapshot.totals.legacyFallbackCount += 1;
    totalsBySource.legacyFallbackCount += 1;
    surface.legacyFallbackCount += 1;
    surfaceBySource.legacyFallbackCount += 1;
  }
  if (telemetry.fallbackReason === 'rollout_holdout') {
    snapshot.totals.holdoutCount += 1;
    totalsBySource.holdoutCount += 1;
    surface.holdoutCount += 1;
    surfaceBySource.holdoutCount += 1;
  }
  if (telemetry.fallbackReason === 'hard_disabled') {
    snapshot.totals.hardDisabledCount += 1;
    snapshot.totals.rollbackEvidenceCount += 1;
    totalsBySource.hardDisabledCount += 1;
    totalsBySource.rollbackEvidenceCount += 1;
    snapshot.rollback.forcedFallbackCount += 1;
    snapshot.rollback.forcedFallbackCountBySource[evidenceSource] += 1;
    snapshot.rollback.lastForcedFallbackAt = telemetry.recordedAt;
    snapshot.rollback.lastForcedFallbackSurface = telemetry.surface;
    snapshot.rollback.lastForcedFallbackSource = evidenceSource;
  }
  if (telemetry.fallbackReason === 'adapter_declined') {
    snapshot.totals.adapterDeclinedCount += 1;
    totalsBySource.adapterDeclinedCount += 1;
  }
  if (telemetry.fallbackReason === 'adapter_error') {
    snapshot.totals.adapterErrorCount += 1;
    totalsBySource.adapterErrorCount += 1;
  }
  if (telemetry.fallbackReason === 'adapter_not_selected') {
    snapshot.totals.adapterNotSelectedCount += 1;
    totalsBySource.adapterNotSelectedCount += 1;
  }
  if (telemetry.fallbackReason === 'empty_request') {
    snapshot.totals.emptyRequestCount += 1;
    totalsBySource.emptyRequestCount += 1;
  }

  surface.lastDecisionAt = telemetry.recordedAt;
  surface.lastTelemetry = telemetry;
  snapshot.recentEvents.unshift({
    recordedAt: telemetry.recordedAt,
    telemetry,
  });
  snapshot.recentEvents = snapshot.recentEvents.slice(0, DISCORD_INGRESS_RECENT_EVENT_LIMIT);
  persistDiscordIngressCutoverSnapshot();
};

export const primeDiscordIngressCutoverPolicy = (
  surface: DiscordIngressSurface,
  options: DiscordIngressExecutionOptions = {},
): void => {
  applyDiscordIngressPolicySnapshot(surface, {
    preferredAdapterId: normalizeAdapterId(options.preferredAdapterId),
    hardDisable: options.hardDisable === true,
    shadowMode: options.shadowMode === true,
    rolloutPercentage: normalizeRolloutPercentage(options.rolloutPercentage, 100),
  });
};

export const getDiscordIngressCutoverSnapshot = (): DiscordIngressCutoverSnapshot => {
  const snapshot = getMutableDiscordIngressCutoverSnapshot();
  return cloneSnapshot(snapshot);
};

export const resetDiscordIngressCutoverSnapshotForTests = (): void => {
  discordIngressCutoverSnapshot = createEmptyDiscordIngressCutoverSnapshot();
  persistDiscordIngressCutoverSnapshot();
};