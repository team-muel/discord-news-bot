export type QueueSessionLike = {
  id: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  status: string;
  cancelRequested: boolean;
  error: string | null;
};

export type AgentDeadletter = {
  sessionId: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  reason: string;
  failedAt: string;
};

type QueueDrainOptions<TSession extends QueueSessionLike> = {
  pollMs: number;
  maxAttempts: number;
  maxDeadletters: number;
  nowIso: () => string;
  getMaxConcurrent: (session: TSession) => number | null;
  getSession: (sessionId: string) => TSession | undefined;
  executeSession: (sessionId: string) => Promise<string>;
  markCancelled: (session: TSession) => void;
  requeueForRetry: (session: TSession) => void;
};

export class MultiAgentRuntimeQueue<TSession extends QueueSessionLike> {
  private pendingSessionQueue: string[] = [];

  private runningSessionIds = new Set<string>();

  private runningSessionGuilds = new Map<string, string>();

  private runningSessionGuildCounts = new Map<string, number>();

  private sessionAttempts = new Map<string, number>();

  private deadletters: AgentDeadletter[] = [];

  private queueDrainTimer: NodeJS.Timeout | null = null;

  enqueueSession(sessionId: string): void {
    if (!this.pendingSessionQueue.includes(sessionId)) {
      this.pendingSessionQueue.push(sessionId);
    }
  }

  removeFromQueue(sessionId: string): void {
    const index = this.pendingSessionQueue.indexOf(sessionId);
    if (index >= 0) {
      this.pendingSessionQueue.splice(index, 1);
    }
  }

  getQueuedCount(): number {
    return this.pendingSessionQueue.length;
  }

  getRunningCount(guildId?: string): number {
    const key = String(guildId || '').trim();
    if (key) {
      return this.runningSessionGuildCounts.get(key) || 0;
    }
    return this.runningSessionIds.size;
  }

  private markSessionRunning(session: TSession): void {
    this.runningSessionIds.add(session.id);
    this.runningSessionGuilds.set(session.id, session.guildId);
    this.runningSessionGuildCounts.set(session.guildId, (this.runningSessionGuildCounts.get(session.guildId) || 0) + 1);
  }

  private clearRunningSession(sessionId: string): void {
    this.runningSessionIds.delete(sessionId);
    const guildId = this.runningSessionGuilds.get(sessionId);
    if (!guildId) {
      return;
    }

    this.runningSessionGuilds.delete(sessionId);
    const nextCount = (this.runningSessionGuildCounts.get(guildId) || 0) - 1;
    if (nextCount > 0) {
      this.runningSessionGuildCounts.set(guildId, nextCount);
      return;
    }

    this.runningSessionGuildCounts.delete(guildId);
  }

  listDeadletters(params?: { guildId?: string; limit?: number }): AgentDeadletter[] {
    const limit = Math.max(1, Math.min(200, Math.trunc(params?.limit ?? 30)));
    const guildId = String(params?.guildId || '').trim();
    return this.deadletters
      .filter((row) => (!guildId || row.guildId === guildId))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  getDeadletterCount(): number {
    return this.deadletters.length;
  }

  scheduleDrain(options: QueueDrainOptions<TSession>): void {
    if (this.queueDrainTimer) {
      return;
    }

    this.queueDrainTimer = setTimeout(() => {
      this.queueDrainTimer = null;

      while (this.pendingSessionQueue.length > 0) {
        let nextSession: TSession | null = null;
        for (let index = 0; index < this.pendingSessionQueue.length; index += 1) {
          const sessionId = this.pendingSessionQueue[index] as string;
          const session = options.getSession(sessionId);
          if (!session) {
            this.pendingSessionQueue.splice(index, 1);
            index -= 1;
            continue;
          }

          if (session.cancelRequested || session.status === 'cancelled') {
            this.pendingSessionQueue.splice(index, 1);
            options.markCancelled(session);
            index -= 1;
            continue;
          }

          const maxConcurrent = options.getMaxConcurrent(session);
          if (maxConcurrent === null) {
            continue;
          }

          if (this.getRunningCount(session.guildId) >= Math.max(1, maxConcurrent)) {
            continue;
          }

          this.pendingSessionQueue.splice(index, 1);
          nextSession = session;
          break;
        }

        if (!nextSession) {
          break;
        }

        const sessionId = nextSession.id;
        this.markSessionRunning(nextSession);
        const attempts = (this.sessionAttempts.get(sessionId) || 0) + 1;
        this.sessionAttempts.set(sessionId, attempts);

        void options.executeSession(sessionId)
          .then((status) => {
            const latest = options.getSession(sessionId);
            if (!latest) {
              return;
            }

            if (status === 'failed') {
              if (attempts < options.maxAttempts) {
                options.requeueForRetry(latest);
                return;
              }

              this.deadletters.unshift({
                sessionId: latest.id,
                guildId: latest.guildId,
                requestedBy: latest.requestedBy,
                goal: latest.goal,
                reason: latest.error || 'FAILED',
                failedAt: options.nowIso(),
              });
              if (this.deadletters.length > options.maxDeadletters) {
                this.deadletters.length = options.maxDeadletters;
              }
            }
          })
          .finally(() => {
            this.clearRunningSession(sessionId);
            this.scheduleDrain(options);
          });
      }

      if (this.pendingSessionQueue.length > 0) {
        this.scheduleDrain(options);
      }
    }, options.pollMs);
  }

  reset(): void {
    if (this.queueDrainTimer) {
      clearTimeout(this.queueDrainTimer);
      this.queueDrainTimer = null;
    }
    this.pendingSessionQueue.length = 0;
    this.runningSessionIds.clear();
    this.runningSessionGuilds.clear();
    this.runningSessionGuildCounts.clear();
    this.sessionAttempts.clear();
    this.deadletters.length = 0;
  }
}
