import { TtlCache } from '../utils/ttlCache';
import type { AgentRuntimeSnapshot, AgentSession, SessionOutcomeEntry } from './multiAgentTypes';
import {
  MULTI_AGENT_SESSION_OUTCOME_CACHE_SIZE,
  MULTI_AGENT_SESSION_OUTCOME_MAX_PER_GUILD,
  MULTI_AGENT_SESSION_OUTCOME_TTL_MS,
} from './multiAgentConfig';

type RuntimeQueueSnapshotReader = {
  getRunningCount: () => number;
  getQueuedCount: () => number;
  getDeadletterCount: () => number;
};

export const buildMultiAgentRuntimeSnapshot = (params: {
  sessions: Iterable<AgentSession>;
  queueRuntime: RuntimeQueueSnapshotReader;
}): AgentRuntimeSnapshot => {
  const all = [...params.sessions];
  const latest = all.reduce<string | null>((currentLatest, session) => {
    if (!currentLatest) {
      return session.updatedAt;
    }
    return Date.parse(session.updatedAt) > Date.parse(currentLatest)
      ? session.updatedAt
      : currentLatest;
  }, null);

  return {
    totalSessions: all.length,
    runningSessions: params.queueRuntime.getRunningCount(),
    queuedSessions: params.queueRuntime.getQueuedCount(),
    completedSessions: all.filter((session) => session.status === 'completed').length,
    failedSessions: all.filter((session) => session.status === 'failed').length,
    cancelledSessions: all.filter((session) => session.status === 'cancelled').length,
    deadletteredSessions: params.queueRuntime.getDeadletterCount(),
    latestSessionAt: latest,
  };
};

export const createRecentSessionOutcomeStore = (params?: {
  cacheSize?: number;
  ttlMs?: number;
  maxPerGuild?: number;
}) => {
  const cacheSize = Math.max(
    1,
    Math.trunc(params?.cacheSize ?? MULTI_AGENT_SESSION_OUTCOME_CACHE_SIZE),
  );
  const ttlMs = Math.max(
    1,
    Math.trunc(params?.ttlMs ?? MULTI_AGENT_SESSION_OUTCOME_TTL_MS),
  );
  const maxPerGuild = Math.max(
    1,
    Math.trunc(params?.maxPerGuild ?? MULTI_AGENT_SESSION_OUTCOME_MAX_PER_GUILD),
  );
  let store = new TtlCache<SessionOutcomeEntry[]>(cacheSize);

  return {
    recordSessionOutcome(session: AgentSession, status: string): void {
      const key = session.guildId;
      if (!key) {
        return;
      }

      const existing = store.get(key) || [];
      existing.unshift({
        status,
        error: session.error,
        goalSnippet: String(session.goal || '').slice(0, 80),
        stepCount: session.steps.length,
      });
      store.set(key, existing.slice(0, maxPerGuild), ttlMs);
    },
    getRecentSessionOutcomes(guildId: string): SessionOutcomeEntry[] {
      return store.get(guildId) || [];
    },
    reset(): void {
      store = new TtlCache<SessionOutcomeEntry[]>(cacheSize);
    },
  };
};