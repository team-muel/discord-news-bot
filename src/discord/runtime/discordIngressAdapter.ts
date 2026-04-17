import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Channel } from 'discord.js';
import { OPENCLAW_ENABLED } from '../../config';
import logger from '../../logger';
import { generateTextWithMeta, isAnyLlmConfigured } from '../../services/llmClient';
import { atomicWriteFileSync } from '../../utils/atomicWrite';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  buildSourceRef,
  channelDisplayPrefix,
  parentLabel,
  resolveChannelMeta,
} from '../../utils/discordChannelMeta';
import {
  checkOpenClawGatewayChatSupport,
  sendGatewayChat,
} from '../../services/openclaw/gatewayHealth';
import { enqueueOpenJarvisHermesRuntimeObjectives } from '../../services/openjarvis/openjarvisHermesRuntimeControlService';
import {
  AUTOMATION_INTENT_PATTERN,
  CODING_INTENT_PATTERN,
} from '../runtimePolicy';
import {
  buildDiscordIngressTelemetry,
  computeStableBucket,
  getDiscordIngressCutoverSnapshot as readDiscordIngressCutoverSnapshotState,
  normalizeAdapterId,
  normalizeRolloutPercentage,
  primeDiscordIngressCutoverPolicy as applyDiscordIngressCutoverPolicy,
  recordDiscordIngressTelemetryEvent,
  resetDiscordIngressCutoverSnapshotForTests as resetDiscordIngressCutoverSnapshotState,
  resolveIngressRolloutKey,
  resolvePolicyMode,
} from './discordIngressCutover';

export type DiscordIngressSurface = 'docs-command' | 'muel-message';
export type DiscordIngressReplyMode = 'private' | 'public' | 'channel';
export type DiscordIngressTenantLane = 'operator-personal' | 'public-guild';

export type DiscordIngressRouteRequest = {
  request: string;
  guildId: string | null;
  userId: string;
  channel: Channel | null | undefined;
  messageId?: string | null;
  correlationId?: string | null;
  entryLabel: string;
  surface: DiscordIngressSurface;
  replyMode: DiscordIngressReplyMode;
  tenantLane?: DiscordIngressTenantLane;
};

export type DiscordIngressContext = {
  channelSummary: string | null;
  sourceRef: string | null;
  skipContinuity: boolean;
};

export type DiscordIngressEnvelope = {
  request: string;
  guildId: string | null;
  userId: string;
  channel: Channel | null | undefined;
  messageId: string | null;
  correlationId: string;
  entryLabel: string;
  surface: DiscordIngressSurface;
  replyMode: DiscordIngressReplyMode;
  tenantLane: DiscordIngressTenantLane;
  context: DiscordIngressContext;
};

export type DiscordIngressResult = {
  answer: string;
  adapterId: string;
  continuityQueued: boolean;
};

export type DiscordIngressHandler = (
  params: DiscordIngressRouteRequest,
) => Promise<DiscordIngressResult | null>;
export type DiscordIngressAdapter = {
  id: string;
  route: (envelope: DiscordIngressEnvelope) => Promise<DiscordIngressResult | null>;
};

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

export type DiscordIngressExecution = {
  result: DiscordIngressResult | null;
  telemetry: DiscordIngressTelemetry;
};

export type DiscordIngressExecutionOptions = {
  preferredAdapterId?: string | null;
  hardDisable?: boolean;
  shadowMode?: boolean;
  rolloutPercentage?: number | null;
  rolloutKey?: string | null;
  evidenceSource?: DiscordIngressEvidenceSource;
  preferCallOverrides?: boolean;
};

export type DiscordIngressExecutionHandler = (
  params: DiscordIngressRouteRequest,
) => Promise<DiscordIngressExecution>;

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

export type DiscordIngressRuntimePolicyOverride = {
  preferredAdapterId: string | null;
  hardDisable: boolean | null;
  shadowMode: boolean | null;
  rolloutPercentage: number | null;
  lastUpdatedAt: string | null;
};

export type DiscordIngressRuntimePolicyOverrides = Record<DiscordIngressSurface, DiscordIngressRuntimePolicyOverride>;

export const DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  'tmp',
  'discord-ingress-cutover',
  'latest.json',
);

export const DISCORD_INGRESS_RUNTIME_POLICY_PATH = path.resolve(
  process.cwd(),
  'tmp',
  'discord-ingress-cutover',
  'runtime-policy.json',
);

export const normalizeDiscordRequest = (value: unknown, maxLength = 220): string => {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

const nowIso = (): string => new Date().toISOString();

const cloneSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createRuntimePolicyOverride = (): DiscordIngressRuntimePolicyOverride => ({
  preferredAdapterId: null,
  hardDisable: null,
  shadowMode: null,
  rolloutPercentage: null,
  lastUpdatedAt: null,
});

const createEmptyDiscordIngressRuntimePolicyOverrides = (): DiscordIngressRuntimePolicyOverrides => ({
  'docs-command': createRuntimePolicyOverride(),
  'muel-message': createRuntimePolicyOverride(),
});

let discordIngressRuntimePolicyOverrides = createEmptyDiscordIngressRuntimePolicyOverrides();

const normalizeRuntimePolicyOverride = (
  value: Partial<DiscordIngressRuntimePolicyOverride> | null | undefined,
): DiscordIngressRuntimePolicyOverride => ({
  preferredAdapterId: value && 'preferredAdapterId' in value ? normalizeAdapterId(value.preferredAdapterId) : null,
  hardDisable: typeof value?.hardDisable === 'boolean' ? value.hardDisable : null,
  shadowMode: typeof value?.shadowMode === 'boolean' ? value.shadowMode : null,
  rolloutPercentage: value && value.rolloutPercentage !== undefined && value.rolloutPercentage !== null
    ? normalizeRolloutPercentage(value.rolloutPercentage, 100)
    : null,
  lastUpdatedAt: typeof value?.lastUpdatedAt === 'string' && value.lastUpdatedAt.trim()
    ? value.lastUpdatedAt
    : null,
});

const readPersistedDiscordIngressRuntimePolicyOverrides = (): DiscordIngressRuntimePolicyOverrides | null => {
  if (!existsSync(DISCORD_INGRESS_RUNTIME_POLICY_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(DISCORD_INGRESS_RUNTIME_POLICY_PATH, 'utf8');
    if (!raw.trim()) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<DiscordIngressRuntimePolicyOverrides>;
    const fallback = createEmptyDiscordIngressRuntimePolicyOverrides();
    return {
      'docs-command': normalizeRuntimePolicyOverride(parsed['docs-command'] || fallback['docs-command']),
      'muel-message': normalizeRuntimePolicyOverride(parsed['muel-message'] || fallback['muel-message']),
    };
  } catch {
    return null;
  }
};

const persistDiscordIngressRuntimePolicyOverrides = (): void => {
  mkdirSync(path.dirname(DISCORD_INGRESS_RUNTIME_POLICY_PATH), { recursive: true });
  atomicWriteFileSync(
    DISCORD_INGRESS_RUNTIME_POLICY_PATH,
    `${JSON.stringify(discordIngressRuntimePolicyOverrides, null, 2)}\n`,
  );
};

const getMutableDiscordIngressRuntimePolicyOverrides = (): DiscordIngressRuntimePolicyOverrides => {
  if (
    !discordIngressRuntimePolicyOverrides['docs-command'].lastUpdatedAt
    && !discordIngressRuntimePolicyOverrides['muel-message'].lastUpdatedAt
  ) {
    const persisted = readPersistedDiscordIngressRuntimePolicyOverrides();
    if (persisted) {
      discordIngressRuntimePolicyOverrides = persisted;
    }
  }

  return discordIngressRuntimePolicyOverrides;
};

const hasRuntimePolicyOverride = (surface: DiscordIngressSurface): boolean => {
  const overrides = getMutableDiscordIngressRuntimePolicyOverrides()[surface];
  return overrides.preferredAdapterId !== null
    || overrides.hardDisable !== null
    || overrides.shadowMode !== null
    || overrides.rolloutPercentage !== null;
};

export const getDiscordIngressRuntimePolicyOverrides = (): DiscordIngressRuntimePolicyOverrides => {
  return cloneSnapshot(getMutableDiscordIngressRuntimePolicyOverrides());
};

export const setDiscordIngressRuntimePolicyOverride = (
  surface: DiscordIngressSurface,
  override: Partial<DiscordIngressExecutionOptions> | null,
): DiscordIngressRuntimePolicyOverride => {
  const overrides = getMutableDiscordIngressRuntimePolicyOverrides();
  if (!override) {
    overrides[surface] = createRuntimePolicyOverride();
    persistDiscordIngressRuntimePolicyOverrides();
    return cloneSnapshot(overrides[surface]);
  }

  const current = overrides[surface];
  overrides[surface] = {
    preferredAdapterId: override.preferredAdapterId !== undefined
      ? normalizeAdapterId(override.preferredAdapterId)
      : current.preferredAdapterId,
    hardDisable: override.hardDisable !== undefined
      ? override.hardDisable === true
      : current.hardDisable,
    shadowMode: override.shadowMode !== undefined
      ? override.shadowMode === true
      : current.shadowMode,
    rolloutPercentage: override.rolloutPercentage !== undefined
      ? (override.rolloutPercentage === null ? null : normalizeRolloutPercentage(override.rolloutPercentage, 100))
      : current.rolloutPercentage,
    lastUpdatedAt: nowIso(),
  };
  persistDiscordIngressRuntimePolicyOverrides();
  return cloneSnapshot(overrides[surface]);
};

export const resolveDiscordIngressEffectivePolicy = (
  surface: DiscordIngressSurface,
  options: DiscordIngressExecutionOptions = {},
): DiscordIngressPolicySnapshot => {
  const overrides = getMutableDiscordIngressRuntimePolicyOverrides()[surface];
  const preferCallOverrides = options.preferCallOverrides === true;
  const preferredAdapterId = preferCallOverrides
    ? (options.preferredAdapterId !== undefined
      ? normalizeAdapterId(options.preferredAdapterId)
      : overrides.preferredAdapterId)
    : (overrides.preferredAdapterId !== null
      ? overrides.preferredAdapterId
      : normalizeAdapterId(options.preferredAdapterId));
  const hardDisable = preferCallOverrides
    ? (options.hardDisable !== undefined
      ? options.hardDisable === true
      : (typeof overrides.hardDisable === 'boolean' ? overrides.hardDisable : false))
    : (typeof overrides.hardDisable === 'boolean'
      ? overrides.hardDisable
      : options.hardDisable === true);
  const shadowMode = preferCallOverrides
    ? (options.shadowMode !== undefined
      ? options.shadowMode === true
      : (typeof overrides.shadowMode === 'boolean' ? overrides.shadowMode : false))
    : (typeof overrides.shadowMode === 'boolean'
      ? overrides.shadowMode
      : options.shadowMode === true);
  const rolloutPercentage = preferCallOverrides
    ? (options.rolloutPercentage !== undefined
      ? normalizeRolloutPercentage(options.rolloutPercentage, 100)
      : (overrides.rolloutPercentage !== null ? overrides.rolloutPercentage : 100))
    : (overrides.rolloutPercentage !== null
      ? overrides.rolloutPercentage
      : normalizeRolloutPercentage(options.rolloutPercentage, 100));
  return {
    preferredAdapterId,
    hardDisable,
    shadowMode,
    rolloutPercentage,
    mode: resolvePolicyMode({
      hardDisable,
      shadowMode,
      rolloutPercentage,
    }),
    lastUpdatedAt: hasRuntimePolicyOverride(surface) ? overrides.lastUpdatedAt : null,
  };
};

export const findDiscordIngressRolloutKey = (
  rolloutPercentage: number,
  targetSelected: boolean,
  seedPrefix = 'cutover',
): string | null => {
  const normalizedRollout = normalizeRolloutPercentage(rolloutPercentage, 100);
  if (targetSelected && normalizedRollout <= 0) {
    return null;
  }
  if (!targetSelected && normalizedRollout >= 100) {
    return null;
  }

  for (let index = 0; index < 10_000; index += 1) {
    const candidate = `${seedPrefix}:${index}`;
    const selected = normalizedRollout > 0 && computeStableBucket(candidate) < normalizedRollout;
    if (selected === targetSelected) {
      return candidate;
    }
  }

  return null;
};

export const primeDiscordIngressCutoverPolicy = (
  surface: DiscordIngressSurface,
  options: DiscordIngressExecutionOptions = {},
): void => {
  const effectivePolicy = resolveDiscordIngressEffectivePolicy(surface, options);
  applyDiscordIngressCutoverPolicy(surface, {
    preferredAdapterId: effectivePolicy.preferredAdapterId,
    hardDisable: effectivePolicy.hardDisable,
    shadowMode: effectivePolicy.shadowMode,
    rolloutPercentage: effectivePolicy.rolloutPercentage,
  });
};

export const getDiscordIngressCutoverSnapshot = (): DiscordIngressCutoverSnapshot => {
  return cloneSnapshot(readDiscordIngressCutoverSnapshotState());
};

export const resetDiscordIngressCutoverSnapshotForTests = (): void => {
  discordIngressRuntimePolicyOverrides = createEmptyDiscordIngressRuntimePolicyOverrides();
  resetDiscordIngressCutoverSnapshotState();
  persistDiscordIngressRuntimePolicyOverrides();
};

const resolveCorrelationId = (value: unknown): string => {
  const text = String(value || '').trim();
  return text || randomUUID();
};

export const buildDiscordIngressContext = (params: {
  guildId: string | null;
  channel: Channel | null | undefined;
  messageId?: string | null;
}): DiscordIngressContext => {
  if (!params.guildId || !params.channel) {
    return {
      channelSummary: null,
      sourceRef: null,
      skipContinuity: false,
    };
  }

  const channelMeta = resolveChannelMeta(params.channel);
  const prefix = channelDisplayPrefix(channelMeta);
  const parent = parentLabel(channelMeta);
  return {
    channelSummary: [
      `${prefix}${channelMeta.channelName || channelMeta.channelId}`,
      parent,
    ].filter(Boolean).join(' | ') || null,
    sourceRef: params.messageId
      ? buildSourceRef(params.guildId, channelMeta, params.messageId)
      : null,
    skipContinuity: channelMeta.isPrivateThread,
  };
};

export const buildDiscordIngressEnvelope = (
  params: DiscordIngressRouteRequest,
): DiscordIngressEnvelope => {
  return {
    request: normalizeDiscordRequest(params.request, 1_500),
    guildId: params.guildId,
    userId: params.userId,
    channel: params.channel,
    messageId: params.messageId ?? null,
    correlationId: resolveCorrelationId(params.correlationId),
    entryLabel: params.entryLabel,
    surface: params.surface,
    replyMode: params.replyMode,
    tenantLane: params.tenantLane ?? (params.guildId ? 'public-guild' : 'operator-personal'),
    context: buildDiscordIngressContext({
      guildId: params.guildId,
      channel: params.channel,
      messageId: params.messageId,
    }),
  };
};

const shouldQueueDiscordHermesObjective = (request: string): boolean => {
  return CODING_INTENT_PATTERN.test(request) || AUTOMATION_INTENT_PATTERN.test(request);
};

const buildDiscordHermesObjective = (params: {
  entryLabel: string;
  request: string;
  channelSummary: string | null;
}): string => {
  const prefix = params.channelSummary
    ? `${params.entryLabel} @ ${params.channelSummary}`
    : params.entryLabel;
  return normalizeDiscordRequest(`Discord ingress follow-up (${prefix}): ${params.request}`, 220);
};

const queueDiscordHermesObjective = (envelope: DiscordIngressEnvelope): boolean => {
  if (envelope.context.skipContinuity || !shouldQueueDiscordHermesObjective(envelope.request)) {
    return false;
  }

  const objective = buildDiscordHermesObjective({
    entryLabel: envelope.entryLabel,
    request: envelope.request,
    channelSummary: envelope.context.channelSummary,
  });

  void enqueueOpenJarvisHermesRuntimeObjectives({
    objective,
    runtimeLane: envelope.tenantLane,
  }).then((result) => {
    if (!result.ok) {
      logger.debug('[BOT] Discord ingress continuity queue skipped: %s', result.error || result.errorCode || 'unknown');
    }
  }).catch((error) => {
    logger.debug('[BOT] Discord ingress continuity queue failed: %s', getErrorMessage(error));
  });

  return true;
};

const buildDiscordIngressSystemPrompt = (): string => {
  return [
    '당신은 Discord 커뮤니티의 Muel입니다.',
    '항상 한국어로 짧고 실무적으로 답변하세요.',
    '내부 제어면(Hermes, OpenJarvis, continuity, queue, packet)은 사용자에게 언급하지 마세요.',
    '코딩이나 자동화 요청이어도 지금 당장 도움이 되는 다음 행동 중심으로 답하세요.',
  ].join('\n');
};

const buildDiscordIngressUserPrompt = (envelope: DiscordIngressEnvelope): string => {
  return [
    `Discord surface: ${envelope.surface}`,
    `Discord reply mode: ${envelope.replyMode}`,
    `tenant_lane: ${envelope.tenantLane}`,
    envelope.context.channelSummary ? `Discord context: ${envelope.context.channelSummary}` : null,
    envelope.context.sourceRef ? `discord_source: ${envelope.context.sourceRef}` : null,
    `User request: ${envelope.request}`,
  ].filter(Boolean).join('\n');
};

const getDiscordIngressMaxOutputTokens = (surface: DiscordIngressSurface): number => {
  return surface === 'docs-command' ? 800 : 600;
};

export const chatSdkDiscordIngressAdapter: DiscordIngressAdapter = {
  id: 'chat-sdk',
  route: async (envelope) => {
    if (!envelope.request || !isAnyLlmConfigured()) {
      return null;
    }

    const response = await generateTextWithMeta({
      system: buildDiscordIngressSystemPrompt(),
      user: buildDiscordIngressUserPrompt(envelope),
      maxTokens: getDiscordIngressMaxOutputTokens(envelope.surface),
      temperature: 0.2,
      actionName: `discord.${envelope.surface}`,
      guildId: envelope.guildId || undefined,
      requestedBy: envelope.userId,
    });
    const answer = normalizeDiscordRequest(response.text, 1_800);
    if (!answer) {
      return null;
    }

    return {
      answer,
      adapterId: 'chat-sdk',
      continuityQueued: queueDiscordHermesObjective(envelope),
    };
  },
};

export const openClawDiscordIngressAdapter: DiscordIngressAdapter = {
  id: 'openclaw',
  route: async (envelope) => {
    if (!OPENCLAW_ENABLED || !envelope.request) {
      return null;
    }

    const gatewayChatSupported = await checkOpenClawGatewayChatSupport();
    if (!gatewayChatSupported) {
      return null;
    }

    const answer = await sendGatewayChat({
      system: buildDiscordIngressSystemPrompt(),
      user: buildDiscordIngressUserPrompt(envelope),
      guildId: envelope.guildId || undefined,
      actionName: `discord.${envelope.surface}`,
      temperature: 0.2,
      maxTokens: getDiscordIngressMaxOutputTokens(envelope.surface),
    });

    if (!answer) {
      return null;
    }

    return {
      answer: normalizeDiscordRequest(answer, 1_800),
      adapterId: 'openclaw',
      continuityQueued: queueDiscordHermesObjective(envelope),
    };
  },
};

const DEFAULT_DISCORD_INGRESS_ADAPTERS: ReadonlyArray<DiscordIngressAdapter> = [
  openClawDiscordIngressAdapter,
  chatSdkDiscordIngressAdapter,
];

const selectDiscordIngressAdapter = (
  preferredAdapterId: string | null,
  adapters: ReadonlyArray<DiscordIngressAdapter>,
): DiscordIngressAdapter | null => {
  if (preferredAdapterId) {
    return adapters.find((adapter) => adapter.id === preferredAdapterId) || null;
  }

  return adapters[0] || null;
};

const logDiscordIngressTelemetry = (telemetry: DiscordIngressTelemetry): void => {
  logger.info(
    '[BOT] discord ingress at=%s correlationId=%s surface=%s selectedAdapter=%s adapterId=%s decision=%s fallback=%s guildId=%s replyMode=%s shadow=%s rollout=%d bucket=%d selected=%s mode=%s evidence=%s',
    telemetry.recordedAt,
    telemetry.correlationId,
    telemetry.surface,
    telemetry.selectedAdapterId || 'none',
    telemetry.adapterId || 'none',
    telemetry.routeDecision,
    telemetry.fallbackReason || 'none',
    telemetry.guildId || 'dm',
    telemetry.replyMode,
    telemetry.shadowMode ? '1' : '0',
    telemetry.rolloutPercentage,
    telemetry.stableBucket,
    telemetry.selectedByRollout ? '1' : '0',
    telemetry.policyMode,
    telemetry.evidenceSource,
  );
};

export async function executeDiscordIngress(
  params: DiscordIngressRouteRequest,
  options: DiscordIngressExecutionOptions = {},
  adapters: ReadonlyArray<DiscordIngressAdapter> = DEFAULT_DISCORD_INGRESS_ADAPTERS,
): Promise<DiscordIngressExecution> {
  const envelope = buildDiscordIngressEnvelope(params);
  const effectivePolicy = resolveDiscordIngressEffectivePolicy(params.surface, options);
  const preferredAdapterId = effectivePolicy.preferredAdapterId;
  const hardDisable = effectivePolicy.hardDisable;
  const shadowMode = effectivePolicy.shadowMode;
  const rolloutPercentage = effectivePolicy.rolloutPercentage;
  const stableBucket = computeStableBucket(resolveIngressRolloutKey(envelope, options.rolloutKey));
  const selectedByRollout = rolloutPercentage > 0 && stableBucket < rolloutPercentage;
  const evidenceSource: DiscordIngressEvidenceSource = options.evidenceSource === 'lab' ? 'lab' : 'live';
  const policyMode = effectivePolicy.mode;
  const finalizeExecution = (result: DiscordIngressResult | null, telemetry: DiscordIngressTelemetry): DiscordIngressExecution => {
    logDiscordIngressTelemetry(telemetry);
    recordDiscordIngressTelemetryEvent(telemetry);
    return { result, telemetry };
  };

  if (!envelope.request) {
    const telemetry = buildDiscordIngressTelemetry({
      recordedAt: nowIso(),
      envelope,
      selectedAdapterId: preferredAdapterId,
      adapterId: null,
      routeDecision: 'legacy_fallback',
      fallbackReason: 'empty_request',
      shadowMode,
      rolloutPercentage,
      stableBucket,
      selectedByRollout,
      policyMode,
      evidenceSource,
    });
    return finalizeExecution(null, telemetry);
  }

  if (hardDisable) {
    const telemetry = buildDiscordIngressTelemetry({
      recordedAt: nowIso(),
      envelope,
      selectedAdapterId: preferredAdapterId,
      adapterId: null,
      routeDecision: 'legacy_fallback',
      fallbackReason: 'hard_disabled',
      shadowMode,
      rolloutPercentage,
      stableBucket,
      selectedByRollout,
      policyMode,
      evidenceSource,
    });
    return finalizeExecution(null, telemetry);
  }

  if (!selectedByRollout) {
    const telemetry = buildDiscordIngressTelemetry({
      recordedAt: nowIso(),
      envelope,
      selectedAdapterId: preferredAdapterId,
      adapterId: null,
      routeDecision: 'legacy_fallback',
      fallbackReason: 'rollout_holdout',
      shadowMode,
      rolloutPercentage,
      stableBucket,
      selectedByRollout,
      policyMode,
      evidenceSource,
    });
    return finalizeExecution(null, telemetry);
  }

  const selectedAdapter = selectDiscordIngressAdapter(preferredAdapterId, adapters);
  const selectedAdapterId = selectedAdapter?.id || preferredAdapterId;
  if (!selectedAdapter) {
    const telemetry = buildDiscordIngressTelemetry({
      recordedAt: nowIso(),
      envelope,
      selectedAdapterId,
      adapterId: null,
      routeDecision: 'legacy_fallback',
      fallbackReason: 'adapter_not_selected',
      shadowMode,
      rolloutPercentage,
      stableBucket,
      selectedByRollout,
      policyMode,
      evidenceSource,
    });
    return finalizeExecution(null, telemetry);
  }

  try {
    const result = await selectedAdapter.route(envelope);
    if (!result) {
      const telemetry = buildDiscordIngressTelemetry({
        recordedAt: nowIso(),
        envelope,
        selectedAdapterId,
        adapterId: selectedAdapter.id,
        routeDecision: 'legacy_fallback',
        fallbackReason: 'adapter_declined',
        shadowMode,
        rolloutPercentage,
        stableBucket,
        selectedByRollout,
        policyMode,
        evidenceSource,
      });
      return finalizeExecution(null, telemetry);
    }

    if (shadowMode) {
      const telemetry = buildDiscordIngressTelemetry({
        recordedAt: nowIso(),
        envelope,
        selectedAdapterId,
        adapterId: result.adapterId,
        routeDecision: 'shadow_only',
        fallbackReason: 'shadow_mode',
        shadowMode,
        rolloutPercentage,
        stableBucket,
        selectedByRollout,
        policyMode,
        evidenceSource,
      });
      return finalizeExecution(null, telemetry);
    }

    const telemetry = buildDiscordIngressTelemetry({
      recordedAt: nowIso(),
      envelope,
      selectedAdapterId,
      adapterId: result.adapterId,
      routeDecision: 'adapter_accept',
      fallbackReason: null,
      shadowMode,
      rolloutPercentage,
      stableBucket,
      selectedByRollout,
      policyMode,
      evidenceSource,
    });
    return finalizeExecution(result, telemetry);
  } catch (error) {
    logger.warn(
      '[BOT] Discord ingress adapter error correlationId=%s adapterId=%s surface=%s: %s',
      envelope.correlationId,
      selectedAdapter.id,
      envelope.surface,
      getErrorMessage(error),
    );
    const telemetry = buildDiscordIngressTelemetry({
      recordedAt: nowIso(),
      envelope,
      selectedAdapterId,
      adapterId: selectedAdapter.id,
      routeDecision: 'legacy_fallback',
      fallbackReason: 'adapter_error',
      shadowMode,
      rolloutPercentage,
      stableBucket,
      selectedByRollout,
      policyMode,
      evidenceSource,
    });
    return finalizeExecution(null, telemetry);
  }
};

export const routeDiscordIngress = async (
  params: DiscordIngressRouteRequest,
  adapters: ReadonlyArray<DiscordIngressAdapter> = DEFAULT_DISCORD_INGRESS_ADAPTERS,
): Promise<DiscordIngressResult | null> => {
  const envelope = buildDiscordIngressEnvelope(params);
  if (!envelope.request) {
    return null;
  }

  for (const adapter of adapters) {
    const result = await adapter.route(envelope);
    if (result) {
      return result;
    }
  }

  return null;
}