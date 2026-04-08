/**
 * Harness Gate Channel — applies ToC "identify the constraint" to the
 * bot's own runtime harness.
 *
 * Reads live KPI values directly from in-process service functions
 * (no HTTP calls, no subprocess) and converts threshold breaches into
 * structured observations. This closes the ToC loop across all layers:
 *
 *   Development env  (tsc errors)   ← already: codeHealthChannel
 *   Runtime harness  (KPI breaches) ← THIS FILE
 *   Community health (Discord pulse) ← discordPulseChannel
 *   Perf regression  (latency/cost)  ← perfDriftChannel
 *   Memory health    (gaps/orphans)  ← memoryGapChannel
 *
 * All five channels feed the same observerOrchestrator → signalBus →
 * Sprint/communityVoice pipeline, making the harness self-aware and
 * capable of autonomous improvement.
 *
 * Recommended scan interval: same as OBSERVER_SCAN_INTERVAL_MS.
 */

import type {
  ObservationChannel,
  ObservationChannelResult,
  Observation,
  HarnessGatePayload,
} from './observerTypes';
import { OBSERVER_HARNESS_GATE_ENABLED } from '../../config';
import logger from '../../logger';

// ──── KPI Thresholds (all environment-tunable via config) ─────────────────────

const DEADLETTER_WARN_THRESHOLD = 3;   // agent session deadletters
const DEADLETTER_CRITICAL_THRESHOLD = 10;
const MEM_DEADLETTER_WARN_THRESHOLD = 5;  // memory job deadletters
const SESSION_FAILURE_RATE_WARN_PCT = 30; // % of recent sessions that failed
const SESSION_FAILURE_RATE_CRITICAL_PCT = 60;
const QUEUE_DEPTH_WARN = 8;               // queued agent sessions
const QUEUE_DEPTH_CRITICAL = 20;
const MEM_JOB_FAIL_RATE_WARN_PCT = 20;   // memory runner failCount / runCount

// ──── Safe lazy imports (imported inside scan() to avoid circular deps) ───────

const loadAgentSnapshot = async () => {
  const { getMultiAgentRuntimeSnapshot } = await import('../multiAgentService');
  return getMultiAgentRuntimeSnapshot();
};

const loadMemoryRunnerStats = async () => {
  const { getMemoryJobRunnerStats } = await import('../memory/memoryJobRunner');
  return getMemoryJobRunnerStats();
};

const loadMemoryDeadletterCount = async (guildId: string) => {
  try {
    const { getMemoryJobQueueStats } = await import('../memory/memoryJobRunner');
    const queueStats = await getMemoryJobQueueStats(guildId);
    return (queueStats as { deadlettered?: number }).deadlettered ?? 0;
  } catch {
    return 0;
  }
};

// ──── Channel ─────────────────────────────────────────────────────────────────

const channel: ObservationChannel = {
  kind: 'harness-gate',
  enabled: OBSERVER_HARNESS_GATE_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    try {
      // ── Gate A: Agent session deadletters ──────────────────────────────
      const agentSnapshot = await loadAgentSnapshot();
      const deadletteredSessions = agentSnapshot.deadletteredSessions ?? 0;

      if (deadletteredSessions >= DEADLETTER_WARN_THRESHOLD) {
        const payload: HarnessGatePayload = {
          gate: 'agent-deadletters',
          metric: 'deadletteredSessions',
          current: deadletteredSessions,
          threshold: DEADLETTER_WARN_THRESHOLD,
        };
        observations.push({
          guildId,
          channel: 'harness-gate',
          severity: deadletteredSessions >= DEADLETTER_CRITICAL_THRESHOLD ? 'critical' : 'warning',
          title: `에이전트 데드레터 ${deadletteredSessions}개 — 세션이 반복 실패 후 포기됨`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }

      // ── Gate B: Agent session failure rate ─────────────────────────────
      const totalSessions = agentSnapshot.totalSessions ?? 0;
      const failedSessions = agentSnapshot.failedSessions ?? 0;
      if (totalSessions >= 5) {
        const failRatePct = (failedSessions / totalSessions) * 100;
        if (failRatePct >= SESSION_FAILURE_RATE_WARN_PCT) {
          const payload: HarnessGatePayload = {
            gate: 'session-failure-rate',
            metric: 'failedSessionPct',
            current: Math.round(failRatePct),
            threshold: SESSION_FAILURE_RATE_WARN_PCT,
            details: [
              `총 ${totalSessions}개 세션 중 ${failedSessions}개 실패`,
              `실행 중: ${agentSnapshot.runningSessions}, 대기: ${agentSnapshot.queuedSessions}`,
            ],
          };
          observations.push({
            guildId,
            channel: 'harness-gate',
            severity: failRatePct >= SESSION_FAILURE_RATE_CRITICAL_PCT ? 'critical' : 'warning',
            title: `세션 실패율 ${Math.round(failRatePct)}% — 하네스 안정성 저하`,
            payload,
            detectedAt: new Date().toISOString(),
          });
        }
      }

      // ── Gate C: Queue depth ────────────────────────────────────────────
      const queueDepth = agentSnapshot.queuedSessions ?? 0;
      if (queueDepth >= QUEUE_DEPTH_WARN) {
        const payload: HarnessGatePayload = {
          gate: 'queue-depth',
          metric: 'queuedSessions',
          current: queueDepth,
          threshold: QUEUE_DEPTH_WARN,
        };
        observations.push({
          guildId,
          channel: 'harness-gate',
          severity: queueDepth >= QUEUE_DEPTH_CRITICAL ? 'critical' : 'warning',
          title: `에이전트 대기열 깊이 ${queueDepth} — 처리 지연 발생 중`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }

      // ── Gate D: Memory job runner health ───────────────────────────────
      const memRunner = await loadMemoryRunnerStats();
      const memRunCount: number = (memRunner as Record<string, unknown>).runCount as number ?? 0;
      const memFailCount: number = (memRunner as Record<string, unknown>).failCount as number ?? 0;

      if (memRunCount >= 5 && memFailCount > 0) {
        const memFailRatePct = (memFailCount / memRunCount) * 100;
        if (memFailRatePct >= MEM_JOB_FAIL_RATE_WARN_PCT) {
          const payload: HarnessGatePayload = {
            gate: 'memory-job-runner',
            metric: 'memJobFailRatePct',
            current: Math.round(memFailRatePct),
            threshold: MEM_JOB_FAIL_RATE_WARN_PCT,
            details: [`실행 ${memRunCount}회 중 ${memFailCount}회 실패`],
          };
          observations.push({
            guildId,
            channel: 'harness-gate',
            severity: memFailRatePct >= 50 ? 'critical' : 'warning',
            title: `메모리 잡 실패율 ${Math.round(memFailRatePct)}% — 메모리 파이프라인 제약`,
            payload,
            detectedAt: new Date().toISOString(),
          });
        }
      }

      // ── Gate E: Memory job deadletters ─────────────────────────────────
      const memDeadletterCount = await loadMemoryDeadletterCount(guildId);
      if (memDeadletterCount >= MEM_DEADLETTER_WARN_THRESHOLD) {
        const payload: HarnessGatePayload = {
          gate: 'memory-deadletters',
          metric: 'memDeadletterCount',
          current: memDeadletterCount,
          threshold: MEM_DEADLETTER_WARN_THRESHOLD,
        };
        observations.push({
          guildId,
          channel: 'harness-gate',
          severity: memDeadletterCount >= 20 ? 'critical' : 'warning',
          title: `메모리 데드레터 ${memDeadletterCount}개 — 메모리 인제스트 파이프라인 막힘`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug('[HARNESS-GATE] scan error: %s', msg);
      return { observations, channelKind: 'harness-gate', scanDurationMs: Date.now() - start, error: msg };
    }

    return { observations, channelKind: 'harness-gate', scanDurationMs: Date.now() - start };
  },
};

export default channel;
