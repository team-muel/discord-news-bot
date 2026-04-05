/**
 * Signal Bus Wiring — connects signal bus producers and consumers.
 *
 * Producers (emit signals): rewardSignalLoop, evalAutoPromoteLoop, goNoGoService,
 *   selfImprovementLoop (convergence), memoryQualityMetrics, sprintOrchestrator.
 *
 * Consumers (react to signals):
 *   - sprintTriggers: degrading/no-go → bugfix sprint
 *   - runtimeAlertService: critical signals → Discord/webhook alerts
 *   - trafficRoutingService: no-go → route adjustment
 *
 * Called once at startup from runtimeBootstrap.ts.
 */

import logger from '../../logger';
import { onSignal, type Signal } from './signalBus';
import { parseBooleanEnv } from '../../utils/env';

const WIRING_ENABLED = parseBooleanEnv(process.env.SIGNAL_BUS_WIRING_ENABLED, true);

let wired = false;

// Lazy-cached module loaders — avoid repeated `await import()` across handlers.
const lazySprintTriggers = () => import('../sprint/sprintTriggers');
const lazyEntityNervous = () => import('../entityNervousSystem');
const lazySelfImprovement = () => import('../sprint/selfImprovementLoop');
const lazySprintOrchestrator = () => import('../sprint/sprintOrchestrator');
const lazyTrafficRouting = () => import('../workflow/trafficRoutingService');
const lazyErrorLog = () => import('../structuredErrorLogService');

/**
 * Wire all signal bus consumers. Idempotent — safe to call multiple times.
 */
export const wireSignalBusConsumers = (): void => {
  if (wired || !WIRING_ENABLED) return;
  wired = true;

  // ── Consumer 1: Degrading signals → sprint triggers ─────────────────────
  onSignal('reward.degrading', async (signal: Signal) => {
    try {
      const { recordRuntimeError } = await lazySprintTriggers();
      recordRuntimeError({
        message: `Reward signal degrading for guild=${signal.guildId} (delta=${(signal.payload as { delta?: number }).delta ?? 'unknown'})`,
        code: 'REWARD_DEGRADING',
      });
    } catch (err) {
      logger.debug('[SIGNAL-WIRING] reward.degrading → sprintTrigger skipped: %s', err instanceof Error ? err.message : String(err));
    }
  });

  onSignal('convergence.degrading', async (signal: Signal) => {
    try {
      const { recordRuntimeError } = await lazySprintTriggers();
      recordRuntimeError({
        message: `System convergence degrading: ${JSON.stringify(signal.payload).slice(0, 200)}`,
        code: 'CONVERGENCE_DEGRADING',
      });
    } catch (err) {
      logger.debug('[SIGNAL-WIRING] convergence.degrading → sprintTrigger skipped: %s', err instanceof Error ? err.message : String(err));
    }
  });

  onSignal('memory.quality.below', async (signal: Signal) => {
    try {
      const { recordRuntimeError } = await lazySprintTriggers();
      const p = signal.payload as { metricId?: string; actual?: number; threshold?: number };
      recordRuntimeError({
        message: `Memory quality below threshold: ${p.metricId} actual=${p.actual} threshold=${p.threshold}`,
        code: 'MEMORY_QUALITY_BELOW',
      });
    } catch (err) {
      logger.debug('[SIGNAL-WIRING] memory.quality.below → sprintTrigger skipped: %s', err instanceof Error ? err.message : String(err));
    }
  });

  onSignal('workflow.phase.looping', async (signal: Signal) => {
    try {
      const { recordRuntimeError } = await lazySprintTriggers();
      const p = signal.payload as { sprintId?: string; loopCount?: number; fromPhase?: string; toPhase?: string };
      recordRuntimeError({
        message: `Sprint phase looping detected: sprint=${p.sprintId} ${p.fromPhase}→${p.toPhase} (${p.loopCount} times)`,
        code: 'SPRINT_PHASE_LOOPING',
      });
    } catch (err) {
      logger.debug('[SIGNAL-WIRING] workflow.phase.looping → sprintTrigger skipped: %s', err instanceof Error ? err.message : String(err));
    }
  });

  // ── Consumer 2: Go/No-Go → traffic routing ──────────────────────────────
  onSignal('gonogo.no-go', async (signal: Signal) => {
    try {
      const { persistTrafficRoutingDecision } = await lazyTrafficRouting();
      await persistTrafficRoutingDecision({
        sessionId: `signal-gonogo-${Date.now()}`,
        guildId: signal.guildId,
        decision: {
          route: 'main',
          reason: `go/no-go verdict: no-go (failed: ${(signal.payload as { failedChecks?: string[] }).failedChecks?.join(', ')})`,
          gotCutoverAllowed: false,
          rolloutPercentage: 0,
          stableBucket: 100,
          shadowDivergenceRate: null,
          shadowQualityDelta: null,
          readinessRecommended: false,
          policySnapshot: { trigger: 'signal_bus', signal: signal.name },
        },
      });
    } catch (err) {
      logger.debug('[SIGNAL-WIRING] gonogo.no-go → trafficRouting skipped: %s', err instanceof Error ? err.message : String(err));
    }
  });

  // ── Consumer 3: Critical signals → runtime alerts ───────────────────────
  const alertableSignals: Set<string> = new Set([
    'reward.degrading',
    'convergence.degrading',
    'gonogo.no-go',
    'memory.quality.below',
    'workflow.phase.looping',
    'workflow.sprint.failed',
  ]);

  onSignal('*', async (signal: Signal) => {
    if (!alertableSignals.has(signal.name)) return;
    try {
      const { logStructuredError } = await lazyErrorLog();
      await logStructuredError({
        code: 'UNKNOWN_ERROR',
        source: `signalBus.${signal.source}`,
        message: `Signal: ${signal.name} guild=${signal.guildId}`,
        guildId: signal.guildId,
        meta: { ...(signal.payload as Record<string, unknown> ?? {}), signalName: signal.name },
        severity: 'warn',
      });
    } catch {
      // Best-effort alert logging
    }
  });

  // ── Consumer 4: Eval promotion → self-improvement awareness ─────────────
  onSignal('eval.promotion.failed', async (signal: Signal) => {
    try {
      const { persistSelfNote } = await lazyEntityNervous();
      const p = signal.payload as { evalName?: string; verdict?: string };
      await persistSelfNote({
        guildId: signal.guildId,
        source: 'eval-promotion',
        note: `[자동 감지] A/B 평가 "${p.evalName}" 거부됨 (verdict=${p.verdict}). 전략 재검토 필요.`,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort
    }
  });

  onSignal('eval.promotion.succeeded', async (signal: Signal) => {
    try {
      const { persistSelfNote } = await lazyEntityNervous();
      const p = signal.payload as { evalName?: string; verdict?: string };
      await persistSelfNote({
        guildId: signal.guildId,
        source: 'eval-promotion',
        note: `[자동 감지] A/B 평가 "${p.evalName}" 승격됨 (verdict=${p.verdict}). 새 전략 활성화.`,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort
    }
  });

  // ── Consumer 6: Reward improving → positive feedback to self-notes ──────
  onSignal('reward.improving', async (signal: Signal) => {
    try {
      const { persistSelfNote } = await lazyEntityNervous();
      const p = signal.payload as { delta?: number; snapshotScore?: number };
      await persistSelfNote({
        guildId: signal.guildId,
        source: 'reward-signal',
        note: `[자동 감지] 보상 시그널 개선 중: delta=${p.delta ?? 'unknown'} score=${p.snapshotScore ?? 'unknown'}. 현재 전략 유지.`,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort
    }
  });

  // ── Consumer 5: Weekly report ready → self-improvement check ────────────
  onSignal('weekly.report.ready', async (signal: Signal) => {
    try {
      const { runSelfImprovementChecks } = await lazySelfImprovement();
      await runSelfImprovementChecks();
    } catch (err) {
      logger.debug('[SIGNAL-WIRING] weekly.report.ready → selfImprovement skipped: %s', err instanceof Error ? err.message : String(err));
    }
  });

  // ── Consumer 7: Critical observation → auto-sprint trigger ──────────────
  onSignal('observation.critical', async (signal: Signal) => {
    try {
      const payload = signal.payload as { description?: string; source?: string } | undefined;
      const objective = payload?.description ?? 'Critical observation auto-sprint';
      const { createSprintPipeline, runFullSprintPipeline } = await lazySprintOrchestrator();
      const pipeline = createSprintPipeline({
        triggerId: `obs-${Date.now()}`,
        triggerType: 'observation',
        guildId: signal.guildId ?? 'default',
        objective: `[자동] ${objective}`,
      });
      void runFullSprintPipeline(pipeline.sprintId).catch((err: unknown) => {
        logger.debug('[SIGNAL-WIRING] observation.critical sprint failed: %s', err instanceof Error ? err.message : String(err));
      });
    } catch (err) {
      logger.debug('[SIGNAL-WIRING] observation.critical → sprint skipped: %s', err instanceof Error ? err.message : String(err));
    }
  });

  logger.info('[SIGNAL-WIRING] all consumers wired');
};

/** Reset for testing. */
export const __resetSignalWiringForTests = (): void => {
  wired = false;
};
