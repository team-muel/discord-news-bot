import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DISCORD_DOCS_INGRESS_ADAPTER,
  DISCORD_DOCS_INGRESS_HARD_DISABLE,
  DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
  DISCORD_DOCS_INGRESS_SHADOW_MODE,
  DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
  DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE,
  DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
  DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE,
  PORT,
  PUBLIC_BASE_URL,
  START_BOT,
} from '../src/config';
import { getBotRuntimeSnapshot } from '../src/bot';
import { getAutomationRuntimeSnapshot, isAutomationEnabled } from '../src/services/automationBot';
import { getMemoryJobQueueStats, getMemoryJobRunnerStats } from '../src/services/memory/memoryJobRunner';
import { getRuntimeAlertsStats } from '../src/services/runtime/runtimeAlertService';
import { getRuntimeSchedulerPolicySnapshot } from '../src/services/runtime/runtimeSchedulerPolicyService';
import { summarizeRuntimeHealth } from '../src/routes/health';
import {
  DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH,
  getDiscordIngressCutoverSnapshot,
  primeDiscordIngressCutoverPolicy,
  type DiscordIngressCutoverSnapshot,
  type DiscordIngressEvidenceSource,
  type DiscordIngressSurface,
} from '../src/discord/runtime/discordIngressAdapter';
import {
  buildOperatorRuntimeHealthUrls,
  evaluateSurfaceParity,
  normalizeBaseUrl,
  parseLastJsonObject,
  probeExternalOperatorRuntimeEvidence,
  resolveSelectedAdapterOwner,
  runCommand,
  runIngressExercise,
  runLabExercise,
  summarizeMixedValue,
  summarizeSurfacePolicy,
  tryResolveGitRevision,
  type CommandCheck,
  type ExerciseSummary,
  type Verdict,
} from './lib/chatSdkDiscordCutoverValidator';

type SurfacePolicyTarget = {
  preferredAdapterId: string | null;
  hardDisable: boolean;
  shadowMode: boolean;
  rolloutPercentage: number;
};

type CutoverPolicyTarget = Record<DiscordIngressSurface, SurfacePolicyTarget>;

type DiscordIngressRemoteClient = {
  baseUrl: string;
  getSnapshot: () => Promise<DiscordIngressCutoverSnapshot>;
  applyPolicy: (policies: CutoverPolicyTarget) => Promise<DiscordIngressCutoverSnapshot>;
  exercise: (params: { evidenceSource: DiscordIngressEvidenceSource; includeRollback?: boolean }) => Promise<ExerciseSummary>;
};

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'chat-sdk-cutover');

const parseArg = (name: string, fallback = ''): string => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const hasArg = (name: string): boolean => {
  const prefix = `--${name}=`;
  return process.argv.some((arg) => arg.startsWith(prefix));
};

const parseBool = (value: string, fallback = false): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parseIntArg = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(parseArg(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOptionalIntArg = (name: string): number | null => {
  if (!hasArg(name)) {
    return null;
  }

  const parsed = Number.parseInt(parseArg(name, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseOptionalBoolArg = (name: string): boolean | null => {
  if (!hasArg(name)) {
    return null;
  }

  return parseBool(parseArg(name, 'false'));
};

const nowIso = (): string => new Date().toISOString();

const toRunStamp = (iso: string): string => {
  const cleaned = String(iso || '').replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const [date, time] = cleaned.split('T');
  return `${date || '00000000'}-${(time || '000000').slice(0, 6)}`;
};

const resolveRuntimeBaseUrl = (): string | null => {
  const rawCandidates = [
    String(parseArg('internalBaseUrl', '')).trim(),
    String(parseArg('runtimeBaseUrl', '')).trim(),
    String(parseArg('runtimeHealthUrl', '')).trim(),
    String(PUBLIC_BASE_URL || '').trim(),
  ];

  for (const candidate of rawCandidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const getInternalServiceRoleToken = (): string => {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? '').trim();
};

const getInternalRouteTimeoutMs = (): number => {
  return parseIntArg('internalRouteTimeoutMs', 120_000);
};

const createDiscordIngressRemoteClient = (): DiscordIngressRemoteClient | null => {
  const baseUrl = resolveRuntimeBaseUrl();
  const token = getInternalServiceRoleToken();
  if (!baseUrl || !token) {
    return null;
  }

  const requestJson = async <T>(endpoint: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(getInternalRouteTimeoutMs()),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`internal route failed ${response.status}: ${body.slice(0, 300)}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    if (!payload.ok) {
      throw new Error(String(payload.message || payload.error || 'internal route returned non-ok payload'));
    }

    return payload as T;
  };

  return {
    baseUrl,
    getSnapshot: async () => {
      const payload = await requestJson<{ snapshot: DiscordIngressCutoverSnapshot }>('/api/internal/discord/ingress/cutover/snapshot');
      return payload.snapshot;
    },
    applyPolicy: async (policies) => {
      const payload = await requestJson<{ snapshot: DiscordIngressCutoverSnapshot }>('/api/internal/discord/ingress/cutover/policy', {
        method: 'POST',
        body: JSON.stringify({ policies }),
      });
      return payload.snapshot;
    },
    exercise: async ({ evidenceSource, includeRollback = true }) => {
      const payload = await requestJson<{ summary: ExerciseSummary }>('/api/internal/discord/ingress/cutover/exercise', {
        method: 'POST',
        body: JSON.stringify({ evidenceSource, includeRollback }),
      });
      return payload.summary;
    },
  };
};

const buildTargetPolicy = (): CutoverPolicyTarget => {
  const globalAdapterId = String(parseArg('preferredAdapterId', '')).trim() || null;
  const globalRolloutPercentage = parseOptionalIntArg('rolloutPercentage');
  const globalShadowMode = parseOptionalBoolArg('shadowMode');
  const globalHardDisable = parseOptionalBoolArg('hardDisable');

  const docsAdapterId = String(parseArg('docsAdapterId', globalAdapterId || DISCORD_DOCS_INGRESS_ADAPTER)).trim() || DISCORD_DOCS_INGRESS_ADAPTER;
  const messageAdapterId = String(parseArg('muelAdapterId', globalAdapterId || DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER)).trim() || DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER;
  const docsRolloutPercentage = parseOptionalIntArg('docsRolloutPercentage') ?? globalRolloutPercentage ?? DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT;
  const messageRolloutPercentage = parseOptionalIntArg('muelRolloutPercentage') ?? globalRolloutPercentage ?? DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT;
  const docsShadowMode = parseOptionalBoolArg('docsShadowMode') ?? globalShadowMode ?? DISCORD_DOCS_INGRESS_SHADOW_MODE;
  const messageShadowMode = parseOptionalBoolArg('muelShadowMode') ?? globalShadowMode ?? DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE;
  const docsHardDisable = parseOptionalBoolArg('docsHardDisable') ?? globalHardDisable ?? DISCORD_DOCS_INGRESS_HARD_DISABLE;
  const messageHardDisable = parseOptionalBoolArg('muelHardDisable') ?? globalHardDisable ?? DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE;

  return {
    'docs-command': {
      preferredAdapterId: docsAdapterId,
      hardDisable: docsHardDisable,
      shadowMode: docsShadowMode,
      rolloutPercentage: docsRolloutPercentage,
    },
    'muel-message': {
      preferredAdapterId: messageAdapterId,
      hardDisable: messageHardDisable,
      shadowMode: messageShadowMode,
      rolloutPercentage: messageRolloutPercentage,
    },
  };
};

export const runChatSdkDiscordCutoverValidation = async (): Promise<void> => {
  const generatedAt = nowIso();
  const runId = `chat-sdk-cutover-${toRunStamp(generatedAt)}`;
  const dryRun = parseBool(parseArg('dryRun', 'false'));
  const runChecks = parseBool(parseArg('runChecks', 'true'), true);
  const exerciseLiveEvidence = parseBool(parseArg('exerciseLiveEvidence', dryRun ? 'false' : 'true'), !dryRun);
  const exerciseRollback = parseBool(parseArg('exerciseRollback', 'false'));
  const rollbackDryRun = parseBool(parseArg('rollbackDryRun', 'true'));
  const exerciseLabEvidence = parseBool(parseArg('exerciseLabEvidence', 'false'));
  const acceptLabEvidence = parseBool(parseArg('acceptLabEvidence', 'false'));
  const rollbackMaxRecoveryMinutes = parseIntArg('rollbackMaxRecoveryMinutes', 10);
  const environment = String(parseArg('environment', process.env.NODE_ENV || 'development')).trim() || 'development';
  const targetPolicy = buildTargetPolicy();
  const remoteClient = createDiscordIngressRemoteClient();
  const applyLivePolicy = parseBool(
    parseArg('applyLivePolicy', 'false'),
    false,
  );

  if (applyLivePolicy && !remoteClient) {
    throw new Error('live cutover apply requested but no internal runtime base URL or service-role token is available');
  }

  const commandChecks: CommandCheck[] = [];
  if (runChecks) {
    commandChecks.push(runCommand(ROOT, 'discord-tests', 'npm run test:discord'));
    commandChecks.push(runCommand(ROOT, 'typecheck', 'npx tsc --noEmit'));
    commandChecks.push(runCommand(ROOT, 'gate-validation', 'npm run gates:validate:strict'));
    commandChecks.push(runCommand(ROOT, 'rollback-readiness-validation', 'npm run rehearsal:stage-rollback:validate:strict'));
  }

  const rollbackCommand = exerciseRollback
    ? runCommand(
        ROOT,
        'rollback-rehearsal',
        `node scripts/archive/run-stage-rollback-rehearsal.mjs --dryRun=${rollbackDryRun ? 'true' : 'false'} --maxRecoveryMinutes=${rollbackMaxRecoveryMinutes}`,
      )
    : null;
  if (rollbackCommand) {
    commandChecks.push(rollbackCommand);
  }

  if (applyLivePolicy && remoteClient) {
    await remoteClient.applyPolicy(targetPolicy);
  } else {
    primeDiscordIngressCutoverPolicy('docs-command', targetPolicy['docs-command']);
    primeDiscordIngressCutoverPolicy('muel-message', targetPolicy['muel-message']);
  }

  const discordTestsCheck = commandChecks.find((item) => item.label === 'discord-tests') ?? null;
  const discordTestsRan = Boolean(discordTestsCheck);
  const discordTestsPassed = discordTestsCheck?.ok ?? false;
  const rollbackPayload = rollbackCommand ? parseLastJsonObject(rollbackCommand.stdout) : null;
  const snapshot = applyLivePolicy && remoteClient
    ? await remoteClient.getSnapshot()
    : getDiscordIngressCutoverSnapshot();
  const docsPolicy = summarizeSurfacePolicy(snapshot, 'docs-command');
  const messagePolicy = summarizeSurfacePolicy(snapshot, 'muel-message');
  const liveExercise = exerciseLiveEvidence
    ? await (applyLivePolicy && remoteClient
      ? remoteClient.exercise({ evidenceSource: 'live', includeRollback: true })
      : runIngressExercise({
          docsPolicyAdapterId: docsPolicy.preferredAdapterId || targetPolicy['docs-command'].preferredAdapterId || DISCORD_DOCS_INGRESS_ADAPTER,
          messagePolicyAdapterId: messagePolicy.preferredAdapterId || targetPolicy['muel-message'].preferredAdapterId || DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
          docsShadowMode: docsPolicy.shadowMode || targetPolicy['docs-command'].shadowMode,
          messageShadowMode: messagePolicy.shadowMode || targetPolicy['muel-message'].shadowMode,
          evidenceSource: 'live',
        }))
    : null;
  const labExercise = exerciseLabEvidence
    ? await (applyLivePolicy && remoteClient
      ? (async () => {
          const summary = await remoteClient.exercise({ evidenceSource: 'lab', includeRollback: true });
          return {
            ...summary,
            accepted: acceptLabEvidence,
          };
        })()
      : runLabExercise({
          docsPolicyAdapterId: docsPolicy.preferredAdapterId || targetPolicy['docs-command'].preferredAdapterId || DISCORD_DOCS_INGRESS_ADAPTER,
          messagePolicyAdapterId: messagePolicy.preferredAdapterId || targetPolicy['muel-message'].preferredAdapterId || DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
          docsShadowMode: docsPolicy.shadowMode || targetPolicy['docs-command'].shadowMode,
          messageShadowMode: messagePolicy.shadowMode || targetPolicy['muel-message'].shadowMode,
          acceptLabEvidence,
        }))
    : null;
  const refreshedSnapshot = applyLivePolicy && remoteClient
    ? await remoteClient.getSnapshot()
    : getDiscordIngressCutoverSnapshot();
  const labEvidenceAcceptedForDecision = acceptLabEvidence && environment !== 'production';
  const refreshedDocsPolicy = summarizeSurfacePolicy(refreshedSnapshot, 'docs-command');
  const refreshedMessagePolicy = summarizeSurfacePolicy(refreshedSnapshot, 'muel-message');
  const liveSelectedOwnerBySurface = {
    'docs-command': resolveSelectedAdapterOwner(refreshedSnapshot, 'docs-command', 'live'),
    'muel-message': resolveSelectedAdapterOwner(refreshedSnapshot, 'muel-message', 'live'),
  };
  const adapterId = summarizeMixedValue([
    refreshedDocsPolicy.preferredAdapterId || DISCORD_DOCS_INGRESS_ADAPTER,
    refreshedMessagePolicy.preferredAdapterId || DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
  ]);
  const shadowMode = summarizeMixedValue([
    refreshedDocsPolicy.shadowMode || DISCORD_DOCS_INGRESS_SHADOW_MODE,
    refreshedMessagePolicy.shadowMode || DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE,
  ]);
  const rolloutPercentage = summarizeMixedValue([
    refreshedDocsPolicy.rolloutPercentage || DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
    refreshedMessagePolicy.rolloutPercentage || DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
  ]);
  const adapterRevision = tryResolveGitRevision(ROOT);

  const liveDocsParity = evaluateSurfaceParity(refreshedSnapshot, 'docs-command', 'live');
  const livePrefixedParity = evaluateSurfaceParity(refreshedSnapshot, 'muel-message', 'live');
  const docsParity = labEvidenceAcceptedForDecision && liveDocsParity.verdict !== 'pass' && labExercise?.surfaces['docs-command'].verdict === 'pass'
    ? {
        ...labExercise.surfaces['docs-command'],
        reason: `${labExercise.surfaces['docs-command'].reason}; live=${liveDocsParity.reason}`,
      }
    : liveDocsParity;
  const prefixedParity = labEvidenceAcceptedForDecision && livePrefixedParity.verdict !== 'pass' && labExercise?.surfaces['muel-message'].verdict === 'pass'
    ? {
        ...labExercise.surfaces['muel-message'],
        reason: `${labExercise.surfaces['muel-message'].reason}; live=${livePrefixedParity.reason}`,
      }
    : livePrefixedParity;

  const fallbackVerdict: { verdict: Verdict; reason: string; observedFallbacks: number } = !discordTestsRan
    ? {
        verdict: 'pending',
        reason: 'discord test project not run',
        observedFallbacks: refreshedSnapshot.totalsBySource.live?.legacyFallbackCount ?? refreshedSnapshot.totals.legacyFallbackCount,
      }
    : discordTestsPassed
      ? {
          verdict: 'pass',
          reason: (refreshedSnapshot.totalsBySource.live?.legacyFallbackCount ?? refreshedSnapshot.totals.legacyFallbackCount) > 0
            ? `runtime fallback observed count=${refreshedSnapshot.totalsBySource.live?.legacyFallbackCount ?? refreshedSnapshot.totals.legacyFallbackCount}`
            : 'covered by discord test project',
          observedFallbacks: refreshedSnapshot.totalsBySource.live?.legacyFallbackCount ?? refreshedSnapshot.totals.legacyFallbackCount,
        }
      : {
          verdict: 'fail',
          reason: 'discord test project failed',
          observedFallbacks: refreshedSnapshot.totalsBySource.live?.legacyFallbackCount ?? refreshedSnapshot.totals.legacyFallbackCount,
        };

  const continuityVerdict: { verdict: Verdict; reason: string } = !discordTestsRan
    ? { verdict: 'pending', reason: 'discord test project not run' }
    : discordTestsPassed
      ? { verdict: 'pass', reason: 'covered by discord ingress adapter tests' }
      : { verdict: 'fail', reason: 'discord test project failed' };

  const sanitizationVerdict: { verdict: Verdict; reason: string } = !discordTestsRan
    ? { verdict: 'pending', reason: 'discord test project not run' }
    : discordTestsPassed
      ? { verdict: 'pass', reason: 'covered by discord surface tests and current message clipping' }
      : { verdict: 'fail', reason: 'discord test project failed' };

  const bot = getBotRuntimeSnapshot();
  const automation = getAutomationRuntimeSnapshot();
  const runtimeHealth = summarizeRuntimeHealth({
    botEnabled: START_BOT,
    botReady: bot.ready,
    automationEnabled: isAutomationEnabled(),
    automationReady: automation.healthy,
  });
  const schedulerPolicy = await getRuntimeSchedulerPolicySnapshot();
  const externalRuntimeEvidence = await probeExternalOperatorRuntimeEvidence(buildOperatorRuntimeHealthUrls([
    String(parseArg('runtimeHealthUrl', '')).trim(),
    `http://127.0.0.1:${PORT}/health`,
    `http://localhost:${PORT}/health`,
    PUBLIC_BASE_URL ? `${String(PUBLIC_BASE_URL).replace(/\/+$/, '')}/health` : '',
    normalizeBaseUrl(process.env.OPENJARVIS_SERVE_URL || ''),
    normalizeBaseUrl(process.env.MCP_IMPLEMENT_WORKER_URL || ''),
    normalizeBaseUrl(process.env.MCP_ARCHITECT_WORKER_URL || ''),
    normalizeBaseUrl(process.env.MCP_REVIEW_WORKER_URL || ''),
    normalizeBaseUrl(process.env.MCP_OPERATE_WORKER_URL || ''),
  ]));
  const effectiveRuntimeHealth = externalRuntimeEvidence?.health ?? runtimeHealth;
  const effectiveSchedulerPolicySummary = externalRuntimeEvidence?.schedulerPolicySummary ?? schedulerPolicy.summary;
  const runtimeHealthSource = externalRuntimeEvidence?.source || 'in-process';
  const runtimeHealthUrl = externalRuntimeEvidence?.url || null;
  const effectiveBotReady = externalRuntimeEvidence?.botReady ?? bot.ready;
  const effectiveAutomationHealthy = externalRuntimeEvidence?.automationHealthy ?? automation.healthy;
  const runtimeAlerts = getRuntimeAlertsStats();
  const memoryRunner = getMemoryJobRunnerStats();
  let memoryQueue:
    | Awaited<ReturnType<typeof getMemoryJobQueueStats>>
    | null = null;
  let memoryQueueError: string | null = null;
  try {
    memoryQueue = await getMemoryJobQueueStats();
  } catch (error) {
    memoryQueueError = error instanceof Error ? error.message : String(error);
  }

  const operatorRuntimeVerdict: {
    verdict: Verdict;
    reason: string;
    ready: boolean;
    schedulerPolicyOk: boolean;
    deadletters: number | null;
    structuredErrors: number;
    source: 'external-health' | 'in-process';
    url: string | null;
  } = {
    verdict: effectiveRuntimeHealth.healthy && effectiveSchedulerPolicySummary.total > 0 ? 'pass' : 'fail',
    reason: effectiveRuntimeHealth.healthy && effectiveSchedulerPolicySummary.total > 0
      ? 'runtime health and scheduler policy snapshots available'
      : 'runtime health degraded or scheduler policy snapshot unavailable',
    ready: effectiveRuntimeHealth.healthy,
    schedulerPolicyOk: effectiveSchedulerPolicySummary.total > 0,
    deadletters: memoryQueue?.deadlettered ?? null,
    structuredErrors: refreshedSnapshot.totalsBySource.live?.adapterErrorCount ?? refreshedSnapshot.totals.adapterErrorCount,
    source: runtimeHealthSource,
    url: runtimeHealthUrl,
  };

  const rollbackVerdict = (() => {
    if (rollbackCommand) {
      const rehearsalPassed = rollbackCommand.ok && String(rollbackPayload?.overall || '') === 'pass';
      return {
        exercised: true,
        verdict: rehearsalPassed ? 'pass' as Verdict : 'fail' as Verdict,
        reason: rehearsalPassed ? 'rollback rehearsal passed' : 'rollback rehearsal failed',
        artifactPath: rollbackDryRun ? null : rollbackCommand.stdoutTail,
      };
    }

    const liveForcedFallbackCount = refreshedSnapshot.rollback.forcedFallbackCountBySource?.live
      ?? refreshedSnapshot.rollback.forcedFallbackCount;
    if (liveForcedFallbackCount > 0) {
      return {
        exercised: true,
        verdict: 'pass' as Verdict,
        reason: `forced legacy fallback observed count=${liveForcedFallbackCount}`,
        artifactPath: null,
      };
    }

    if (labEvidenceAcceptedForDecision && labExercise?.rollback.verdict === 'pass') {
      return {
        exercised: true,
        verdict: 'pass' as Verdict,
        reason: `${labExercise.rollback.reason}; live=rollback not exercised and no forced fallback evidence observed`,
        artifactPath: null,
      };
    }

    return {
      exercised: false,
      verdict: 'pending' as Verdict,
      reason: 'rollback not exercised and no forced fallback evidence observed',
      artifactPath: null,
    };
  })();

  const requiredActions: string[] = [];
  const commandFailures = commandChecks.filter((item) => !item.ok);
  if (commandFailures.length > 0) {
    requiredActions.push(`rerun and fix local gate stack failures: ${commandFailures.map((item) => item.label).join(', ')}`);
  }
  if (docsParity.verdict !== 'pass') {
    requiredActions.push(`collect live parity evidence for docs.ask (${docsParity.reason})`);
  }
  if (prefixedParity.verdict !== 'pass') {
    requiredActions.push(`collect live parity evidence for prefixed muel message (${prefixedParity.reason})`);
  }
  if (rollbackVerdict.verdict !== 'pass') {
    requiredActions.push(`exercise rollback or force fallback evidence (${rollbackVerdict.reason})`);
  }
  if (operatorRuntimeVerdict.verdict !== 'pass') {
    requiredActions.push(`stabilize operator runtime evidence (${operatorRuntimeVerdict.reason})`);
  }

  const overall = (
    commandFailures.length === 0
    && docsParity.verdict === 'pass'
    && prefixedParity.verdict === 'pass'
    && fallbackVerdict.verdict === 'pass'
    && continuityVerdict.verdict === 'pass'
    && sanitizationVerdict.verdict === 'pass'
    && operatorRuntimeVerdict.verdict === 'pass'
    && rollbackVerdict.verdict === 'pass'
  ) ? 'go' : 'no-go';

  const markdown = `# Chat SDK Discord Cutover Validation

- generated_at: ${generatedAt}
- run_id: ${runId}
- environment: ${environment}
- adapter_id: ${String(adapterId)}
- adapter_revision: ${adapterRevision}
- shadow_mode: ${String(shadowMode)}
- rollout_percentage: ${String(rolloutPercentage)}
- eligible_surfaces: docs.ask(/뮤엘,/해줘), muel.prefixed(뮤엘 ...)
- overall: ${overall}

## Parity

- docs.ask: ${docsParity.verdict} (${docsParity.reason})
- muel.prefixed: ${prefixedParity.verdict} (${prefixedParity.reason})
- fallback: ${fallbackVerdict.verdict} (${fallbackVerdict.reason})
- continuity_private_thread: ${continuityVerdict.verdict} (${continuityVerdict.reason})
- sanitization: ${sanitizationVerdict.verdict} (${sanitizationVerdict.reason})

## Evidence Mode

- live_docs.ask: ${liveDocsParity.verdict} (${liveDocsParity.reason})
- live_muel.prefixed: ${livePrefixedParity.verdict} (${livePrefixedParity.reason})
- live_owner.docs.ask: ${liveSelectedOwnerBySurface['docs-command'] || 'unobserved'}
- live_owner.muel.prefixed: ${liveSelectedOwnerBySurface['muel-message'] || 'unobserved'}
- live_rehearsal: ${liveExercise ? 'run' : 'not-run'}
- lab_rehearsal: ${labExercise ? (labEvidenceAcceptedForDecision ? 'accepted' : 'observed-only') : 'not-run'}
- lab_rollback: ${labExercise?.rollback.verdict || 'not-run'}${labExercise ? ` (${labExercise.rollback.reason})` : ''}

## Operator Runtime

- ready: ${operatorRuntimeVerdict.ready}
- source: ${operatorRuntimeVerdict.source}${operatorRuntimeVerdict.url ? ` (${operatorRuntimeVerdict.url})` : ''}
- cutover_control_plane: ${applyLivePolicy && remoteClient ? `internal (${remoteClient.baseUrl})` : 'local-process'}
- scheduler_policy: ${operatorRuntimeVerdict.schedulerPolicyOk}
- deadletters: ${operatorRuntimeVerdict.deadletters ?? 'n/a'}${memoryQueueError ? ` (${memoryQueueError})` : ''}
- structured_errors: ${operatorRuntimeVerdict.structuredErrors}
- runtime_verdict: ${operatorRuntimeVerdict.verdict} (${operatorRuntimeVerdict.reason})

## Rollback

- exercised: ${rollbackVerdict.exercised}
- result: ${rollbackVerdict.verdict}
- notes: ${rollbackVerdict.reason}

## Evidence

- snapshot_path: ${path.relative(ROOT, DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH).replace(/\\/g, '/')}
- tests: ${commandChecks.find((item) => item.label === 'discord-tests')?.command || 'not-run'}
- api_checks: internal runtime snapshots via scheduler policy, bot health, memory queue, runtime alerts
- logs: ${commandChecks.length > 0 ? commandChecks.map((item) => `${item.label}=${item.exitCode}`).join(', ') : 'none'}

## Surface Policies

- docs.ask: adapter=${refreshedDocsPolicy.preferredAdapterId || DISCORD_DOCS_INGRESS_ADAPTER} hard_disable=${refreshedDocsPolicy.hardDisable} shadow=${refreshedDocsPolicy.shadowMode} rollout=${refreshedDocsPolicy.rolloutPercentage}
- muel.prefixed: adapter=${refreshedMessagePolicy.preferredAdapterId || DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER} hard_disable=${refreshedMessagePolicy.hardDisable} shadow=${refreshedMessagePolicy.shadowMode} rollout=${refreshedMessagePolicy.rolloutPercentage}

## Required Actions

${requiredActions.length > 0 ? requiredActions.map((item) => `- ${item}`).join('\n') : '- none'}
`;

  const json = {
    generated_at: generatedAt,
    run_id: runId,
    environment,
    adapter_id: adapterId,
    adapter_revision: adapterRevision,
    shadow_mode: shadowMode,
    rollout_percentage: rolloutPercentage,
    eligible_surfaces: ['docs.ask', 'muel.prefixed'],
    policy_by_surface: refreshedSnapshot.policyBySurface,
    parity: {
      live_docs_ask: liveDocsParity,
      live_muel_prefixed: livePrefixedParity,
      live_selected_owner_by_surface: liveSelectedOwnerBySurface,
      docs_ask: docsParity,
      muel_prefixed: prefixedParity,
      fallback: fallbackVerdict,
      continuity_private_thread: continuityVerdict,
      sanitization: sanitizationVerdict,
    },
    live_rehearsal: liveExercise,
    lab_rehearsal: labExercise,
    lab_rehearsal_mode: labExercise ? (labEvidenceAcceptedForDecision ? 'accepted' : 'observed-only') : 'not-run',
    operator_runtime: {
      verdict: operatorRuntimeVerdict.verdict,
      reason: operatorRuntimeVerdict.reason,
      source: operatorRuntimeVerdict.source,
      url: operatorRuntimeVerdict.url,
      cutover_control_plane: applyLivePolicy && remoteClient
        ? { mode: 'internal', base_url: remoteClient.baseUrl }
        : { mode: 'local-process', base_url: null },
      health: effectiveRuntimeHealth,
      bot_ready: effectiveBotReady,
      automation_healthy: effectiveAutomationHealthy,
      scheduler_policy_summary: effectiveSchedulerPolicySummary,
      memory_queue: memoryQueue,
      memory_queue_error: memoryQueueError,
      memory_runner: memoryRunner,
      runtime_alerts: runtimeAlerts,
      structured_errors: refreshedSnapshot.totalsBySource.live?.adapterErrorCount ?? refreshedSnapshot.totals.adapterErrorCount,
    },
    rollback: rollbackVerdict,
    evidence: {
      snapshot_path: path.relative(ROOT, DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH).replace(/\\/g, '/'),
      recent_events: refreshedSnapshot.recentEvents,
      command_checks: commandChecks,
      rollback_rehearsal_payload: rollbackPayload,
    },
    overall,
    required_actions: requiredActions,
  };

  const mdPath = path.join(OUTPUT_DIR, `${generatedAt.slice(0, 10)}_${runId}.md`);
  const jsonPath = mdPath.replace(/\.md$/i, '.json');

  if (!dryRun) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(mdPath, markdown, 'utf8');
    fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    console.log(`[CHAT-SDK-CUTOVER] written: ${path.relative(ROOT, mdPath).replace(/\\/g, '/')}`);
  } else {
    console.log('[CHAT-SDK-CUTOVER] dry-run=true, no files written');
  }

  console.log(JSON.stringify({
    mdPath: path.relative(ROOT, mdPath).replace(/\\/g, '/'),
    jsonPath: path.relative(ROOT, jsonPath).replace(/\\/g, '/'),
    overall,
    requiredActions: requiredActions.length,
  }, null, 2));

  if (overall !== 'go') {
    process.exit(2);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runChatSdkDiscordCutoverValidation().catch((error) => {
    console.error('[CHAT-SDK-CUTOVER] FAIL', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}