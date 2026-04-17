import { spawnSync } from 'node:child_process';
import {
  executeDiscordIngress,
  type DiscordIngressCutoverSnapshot,
  type DiscordIngressEvidenceSource,
  type DiscordIngressSurface,
} from '../../src/discord/runtime/discordIngressAdapter';

export type CommandCheck = {
  label: string;
  command: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
};

export type Verdict = 'pass' | 'fail' | 'pending';

export type SurfaceVerdict = {
  verdict: Verdict;
  reason: string;
  observedCount: number;
  selectedCount: number;
};

export type ExerciseSummary = {
  exercised: boolean;
  surfaces: Record<DiscordIngressSurface, SurfaceVerdict>;
  rollback: {
    verdict: Verdict;
    reason: string;
    observedFallbacks: number;
    selectedAdapterId: string | null;
    surfaces: Record<DiscordIngressSurface, {
      verdict: Verdict;
      reason: string;
      observedFallbacks: number;
      selectedAdapterId: string | null;
    }>;
  };
};

export type LabExerciseSummary = ExerciseSummary & {
  accepted: boolean;
};

export type SchedulerPolicySummary = {
  total: number;
  appOwned: number;
  dbOwned: number;
  enabled: number;
  running: number;
};

export type RuntimeHealthEvidence = {
  status: 'ok' | 'degraded';
  botStatusGrade: 'healthy' | 'degraded' | 'offline';
  anyEnabled: boolean;
  healthy: boolean;
  allEnabledHealthy: boolean;
};

export type ExternalOperatorRuntimeEvidence = {
  source: 'external-health';
  url: string;
  health: RuntimeHealthEvidence;
  schedulerPolicySummary: SchedulerPolicySummary | null;
  botReady: boolean | null;
  automationHealthy: boolean | null;
};

const clipText = (value: string, maxChars = 1200, maxLines = 20): string => {
  const clippedChars = String(value || '').trim().slice(0, maxChars);
  return clippedChars.split(/\r?\n/).slice(-maxLines).join('\n').trim();
};

export const normalizeBaseUrl = (value: string): string | null => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
};

export const buildOperatorRuntimeHealthUrls = (rawCandidates: unknown[]): string[] => {
  return Array.from(new Set(rawCandidates
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => entry.endsWith('/health') ? entry : `${entry.replace(/\/+$/, '')}/health`)));
};

export const parseExternalSchedulerPolicySummary = (payload: Record<string, unknown>): SchedulerPolicySummary | null => {
  const directSummary = payload.schedulerPolicySummary;
  const runtimeSchedulerPolicy = payload.runtimeSchedulerPolicy;
  const summary = directSummary && typeof directSummary === 'object'
    ? directSummary
    : (runtimeSchedulerPolicy && typeof runtimeSchedulerPolicy === 'object'
      ? (runtimeSchedulerPolicy as Record<string, unknown>).summary
      : null);
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const value = summary as Record<string, unknown>;
  return {
    total: Number(value.total) || 0,
    appOwned: Number(value.appOwned) || 0,
    dbOwned: Number(value.dbOwned) || 0,
    enabled: Number(value.enabled) || 0,
    running: Number(value.running) || 0,
  };
};

export const parseExternalRuntimeHealthEvidence = (payload: Record<string, unknown>, url: string): ExternalOperatorRuntimeEvidence | null => {
  const botStatusGrade = String(payload.botStatusGrade || '').trim();
  const status = String(payload.status || '').trim();
  if (!botStatusGrade && !status) {
    return null;
  }

  const bot = payload.bot && typeof payload.bot === 'object'
    ? payload.bot as Record<string, unknown>
    : null;
  const automation = payload.automation && typeof payload.automation === 'object'
    ? payload.automation as Record<string, unknown>
    : null;
  const health: RuntimeHealthEvidence = {
    status: status === 'ok' ? 'ok' : 'degraded',
    botStatusGrade: botStatusGrade === 'healthy' || botStatusGrade === 'degraded' || botStatusGrade === 'offline'
      ? botStatusGrade
      : 'offline',
    anyEnabled: botStatusGrade !== 'offline',
    healthy: botStatusGrade === 'healthy' || botStatusGrade === 'degraded',
    allEnabledHealthy: status === 'ok',
  };

  return {
    source: 'external-health',
    url,
    health,
    schedulerPolicySummary: parseExternalSchedulerPolicySummary(payload),
    botReady: bot ? Boolean(bot.ready) : null,
    automationHealthy: automation ? Boolean(automation.healthy) : null,
  };
};

export const probeExternalOperatorRuntimeEvidence = async (
  candidateUrls: string[],
): Promise<ExternalOperatorRuntimeEvidence | null> => {
  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        continue;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        continue;
      }

      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!payload || typeof payload !== 'object') {
        continue;
      }

      const parsed = parseExternalRuntimeHealthEvidence(payload, url);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Try the next candidate URL.
    }
  }

  return null;
};

export const runCommand = (root: string, label: string, command: string): CommandCheck => {
  const startedAt = Date.now();
  const child = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
      })
    : spawnSync('bash', ['-lc', command], {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
      });

  const exitCode = Number.isInteger(child.status) ? Number(child.status) : 1;
  const stdout = String(child.stdout || '');
  const stderr = child.error ? `${child.stderr || ''}\n${String(child.error)}` : String(child.stderr || '');
  return {
    label,
    command,
    ok: exitCode === 0,
    exitCode,
    stdout,
    stderr,
    stdoutTail: clipText(stdout),
    stderrTail: clipText(stderr),
    durationMs: Math.max(0, Date.now() - startedAt),
  };
};

export const tryResolveGitRevision = (root: string): string => {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    const text = String(result.stdout || '').trim();
    if (text) {
      return text;
    }
  }

  return 'unknown';
};

export const parseLastJsonObject = (value: string): Record<string, unknown> | null => {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const marker = text.lastIndexOf('\n{');
  const candidate = marker >= 0 ? text.slice(marker + 1) : text;
  if (!candidate.trim().startsWith('{')) {
    return null;
  }

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const summarizeSurfacePolicy = (
  snapshot: DiscordIngressCutoverSnapshot,
  surface: DiscordIngressSurface,
) => snapshot.policyBySurface[surface];

const getSurfaceEvidence = (
  snapshot: DiscordIngressCutoverSnapshot,
  surface: DiscordIngressSurface,
  evidenceSource: DiscordIngressEvidenceSource = 'live',
) => snapshot.surfaces[surface].bySource?.[evidenceSource] ?? snapshot.surfaces[surface];

export const resolveSelectedAdapterOwner = (
  snapshot: DiscordIngressCutoverSnapshot,
  surface: DiscordIngressSurface,
  evidenceSource: DiscordIngressEvidenceSource = 'live',
): string | null => {
  const event = snapshot.recentEvents.find((entry) => (
    entry.telemetry.surface === surface
    && entry.telemetry.evidenceSource === evidenceSource
    && (entry.telemetry.routeDecision === 'adapter_accept' || entry.telemetry.routeDecision === 'shadow_only')
  ));

  return event?.telemetry.adapterId || event?.telemetry.selectedAdapterId || null;
};

export const evaluateSurfaceParity = (
  snapshot: DiscordIngressCutoverSnapshot,
  surface: DiscordIngressSurface,
  evidenceSource: DiscordIngressEvidenceSource = 'live',
): SurfaceVerdict => {
  const surfaceEvidence = getSurfaceEvidence(snapshot, surface, evidenceSource);
  const policy = snapshot.policyBySurface[surface];

  if (!policy.lastUpdatedAt) {
    return {
      verdict: 'pending',
      reason: 'policy_not_primed',
      observedCount: surfaceEvidence.total,
      selectedCount: surfaceEvidence.selectedByRolloutCount,
    };
  }

  if (surfaceEvidence.total === 0) {
    return {
      verdict: 'pending',
      reason: 'no_live_evidence',
      observedCount: 0,
      selectedCount: 0,
    };
  }

  if (surfaceEvidence.selectedByRolloutCount === 0) {
    return {
      verdict: 'pending',
      reason: 'observed_only_holdout_or_rollback',
      observedCount: surfaceEvidence.total,
      selectedCount: 0,
    };
  }

  const selectedAdapterOwner = resolveSelectedAdapterOwner(snapshot, surface, evidenceSource);
  if (!selectedAdapterOwner) {
    return {
      verdict: 'pending',
      reason: 'selected_owner_not_observed',
      observedCount: surfaceEvidence.total,
      selectedCount: surfaceEvidence.selectedByRolloutCount,
    };
  }

  if (policy.preferredAdapterId && selectedAdapterOwner !== policy.preferredAdapterId) {
    return {
      verdict: 'fail',
      reason: `selected_owner_mismatch:${selectedAdapterOwner}`,
      observedCount: surfaceEvidence.total,
      selectedCount: surfaceEvidence.selectedByRolloutCount,
    };
  }

  if (surfaceEvidence.adapterAcceptCount + surfaceEvidence.shadowOnlyCount > 0) {
    return {
      verdict: 'pass',
      reason: `observed=${surfaceEvidence.total}, selected=${surfaceEvidence.selectedByRolloutCount}, owner=${selectedAdapterOwner}`,
      observedCount: surfaceEvidence.total,
      selectedCount: surfaceEvidence.selectedByRolloutCount,
    };
  }

  return {
    verdict: 'fail',
    reason: 'selected_traffic_never_reached_adapter',
    observedCount: surfaceEvidence.total,
    selectedCount: surfaceEvidence.selectedByRolloutCount,
  };
};

export const summarizeMixedValue = <T>(values: T[]): T | 'mixed' => {
  const unique = Array.from(new Set(values));
  return unique.length === 1 ? unique[0] : 'mixed';
};

const buildExerciseParityReason = (
  execution: Awaited<ReturnType<typeof executeDiscordIngress>>,
  evidenceSource: DiscordIngressEvidenceSource,
): string => {
  if (execution.telemetry.routeDecision === 'adapter_accept') {
    return `${evidenceSource}_selected_path_adapter_accept`;
  }
  if (execution.telemetry.routeDecision === 'shadow_only') {
    return `${evidenceSource}_selected_path_shadow_only`;
  }
  return `${evidenceSource}_selected_path_failed:${execution.telemetry.fallbackReason || 'unknown'}`;
};

export const runIngressExercise = async (params: {
  docsPolicyAdapterId: string;
  messagePolicyAdapterId: string;
  docsShadowMode: boolean;
  messageShadowMode: boolean;
  evidenceSource: DiscordIngressEvidenceSource;
}): Promise<ExerciseSummary> => {
  const evidencePrefix = params.evidenceSource === 'lab' ? 'lab' : 'live';
  const buildAdapter = (adapterId: string) => ({
    id: adapterId,
    route: async () => ({
      answer: `${evidencePrefix} rehearsal ok`,
      adapterId,
      continuityQueued: false,
    }),
  });

  const docsExecution = await executeDiscordIngress({
    request: `${evidencePrefix} docs parity rehearsal`,
    guildId: `${evidencePrefix}-guild`,
    userId: `${evidencePrefix}-user`,
    channel: { id: `${evidencePrefix}-docs-channel` } as never,
    messageId: `${evidencePrefix}-docs-msg`,
    correlationId: `${evidencePrefix}-docs-selected`,
    entryLabel: '/해줘',
    surface: 'docs-command',
    replyMode: 'private',
    tenantLane: 'operator-personal',
  }, {
    preferredAdapterId: params.docsPolicyAdapterId,
    rolloutPercentage: 100,
    shadowMode: params.docsShadowMode,
    hardDisable: false,
    evidenceSource: params.evidenceSource,
  }, [buildAdapter(params.docsPolicyAdapterId)]);

  const messageExecution = await executeDiscordIngress({
    request: `${evidencePrefix} prefixed parity rehearsal`,
    guildId: `${evidencePrefix}-guild`,
    userId: `${evidencePrefix}-user`,
    channel: { id: `${evidencePrefix}-prefixed-channel` } as never,
    messageId: `${evidencePrefix}-prefixed-msg`,
    correlationId: `${evidencePrefix}-prefixed-selected`,
    entryLabel: '뮤엘 메시지',
    surface: 'muel-message',
    replyMode: 'channel',
    tenantLane: 'operator-personal',
  }, {
    preferredAdapterId: params.messagePolicyAdapterId,
    rolloutPercentage: 100,
    shadowMode: params.messageShadowMode,
    hardDisable: false,
    evidenceSource: params.evidenceSource,
  }, [buildAdapter(params.messagePolicyAdapterId)]);

  const docsRollbackExecution = await executeDiscordIngress({
    request: `${evidencePrefix} docs rollback rehearsal`,
    guildId: `${evidencePrefix}-guild`,
    userId: `${evidencePrefix}-user`,
    channel: { id: `${evidencePrefix}-docs-rollback-channel` } as never,
    messageId: `${evidencePrefix}-docs-rollback-msg`,
    correlationId: `${evidencePrefix}-docs-rollback`,
    entryLabel: '/해줘',
    surface: 'docs-command',
    replyMode: 'private',
    tenantLane: 'operator-personal',
  }, {
    preferredAdapterId: params.docsPolicyAdapterId,
    rolloutPercentage: 100,
    shadowMode: false,
    hardDisable: true,
    evidenceSource: params.evidenceSource,
  }, [buildAdapter(params.docsPolicyAdapterId)]);

  const messageRollbackExecution = await executeDiscordIngress({
    request: `${evidencePrefix} prefixed rollback rehearsal`,
    guildId: `${evidencePrefix}-guild`,
    userId: `${evidencePrefix}-user`,
    channel: { id: `${evidencePrefix}-prefixed-rollback-channel` } as never,
    messageId: `${evidencePrefix}-prefixed-rollback-msg`,
    correlationId: `${evidencePrefix}-prefixed-rollback`,
    entryLabel: '뮤엘 메시지',
    surface: 'muel-message',
    replyMode: 'channel',
    tenantLane: 'operator-personal',
  }, {
    preferredAdapterId: params.messagePolicyAdapterId,
    rolloutPercentage: 100,
    shadowMode: false,
    hardDisable: true,
    evidenceSource: params.evidenceSource,
  }, [buildAdapter(params.messagePolicyAdapterId)]);

  const toSurfaceVerdict = (execution: Awaited<ReturnType<typeof executeDiscordIngress>>): SurfaceVerdict => ({
    verdict: execution.telemetry.routeDecision === 'adapter_accept' || execution.telemetry.routeDecision === 'shadow_only' ? 'pass' : 'fail',
    reason: buildExerciseParityReason(execution, params.evidenceSource),
    observedCount: 1,
    selectedCount: execution.telemetry.selectedByRollout ? 1 : 0,
  });

  const toRollbackSurfaceVerdict = (
    execution: Awaited<ReturnType<typeof executeDiscordIngress>>,
  ): ExerciseSummary['rollback']['surfaces'][DiscordIngressSurface] => ({
    verdict: execution.telemetry.fallbackReason === 'hard_disabled' ? 'pass' : 'fail',
    reason: execution.telemetry.fallbackReason === 'hard_disabled'
      ? `${evidencePrefix} rollback rehearsal produced forced legacy fallback`
      : `${evidencePrefix} rollback rehearsal failed (${execution.telemetry.fallbackReason || 'unknown'})`,
    observedFallbacks: execution.telemetry.fallbackReason === 'hard_disabled' ? 1 : 0,
    selectedAdapterId: execution.telemetry.selectedAdapterId,
  });

  const rollbackSurfaces = {
    'docs-command': toRollbackSurfaceVerdict(docsRollbackExecution),
    'muel-message': toRollbackSurfaceVerdict(messageRollbackExecution),
  } satisfies ExerciseSummary['rollback']['surfaces'];
  const rollbackObservedFallbacks = rollbackSurfaces['docs-command'].observedFallbacks + rollbackSurfaces['muel-message'].observedFallbacks;
  const rollbackSelectedAdapterId = rollbackSurfaces['docs-command'].selectedAdapterId === rollbackSurfaces['muel-message'].selectedAdapterId
    ? rollbackSurfaces['docs-command'].selectedAdapterId
    : null;
  const rollbackPassed = rollbackSurfaces['docs-command'].verdict === 'pass'
    && rollbackSurfaces['muel-message'].verdict === 'pass';

  return {
    exercised: true,
    surfaces: {
      'docs-command': toSurfaceVerdict(docsExecution),
      'muel-message': toSurfaceVerdict(messageExecution),
    },
    rollback: {
      verdict: rollbackPassed ? 'pass' : 'fail',
      reason: rollbackPassed
        ? `${evidencePrefix} rollback rehearsal produced forced legacy fallback on docs-command and muel-message`
        : `${evidencePrefix} rollback rehearsal failed for one or more eligible surfaces`,
      observedFallbacks: rollbackObservedFallbacks,
      selectedAdapterId: rollbackSelectedAdapterId,
      surfaces: rollbackSurfaces,
    },
  };
};

export const runLabExercise = async (params: {
  docsPolicyAdapterId: string;
  messagePolicyAdapterId: string;
  docsShadowMode: boolean;
  messageShadowMode: boolean;
  acceptLabEvidence: boolean;
}): Promise<LabExerciseSummary> => {
  const summary = await runIngressExercise({
    docsPolicyAdapterId: params.docsPolicyAdapterId,
    messagePolicyAdapterId: params.messagePolicyAdapterId,
    docsShadowMode: params.docsShadowMode,
    messageShadowMode: params.messageShadowMode,
    evidenceSource: 'lab',
  });

  return {
    ...summary,
    accepted: params.acceptLabEvidence,
  };
};