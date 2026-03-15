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
  getMaxConcurrent: () => number;
  getSession: (sessionId: string) => TSession | undefined;
  executeSession: (sessionId: string) => Promise<string>;
  markCancelled: (session: TSession) => void;
  requeueForRetry: (session: TSession) => void;
};

export class MultiAgentRuntimeQueue<TSession extends QueueSessionLike> {
  private pendingSessionQueue: string[] = [];

  private runningSessionIds = new Set<string>();

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

  getRunningCount(): number {
    return this.runningSessionIds.size;
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
      const maxConcurrent = Math.max(1, options.getMaxConcurrent());

      while (this.runningSessionIds.size < maxConcurrent && this.pendingSessionQueue.length > 0) {
        const sessionId = this.pendingSessionQueue.shift() as string;
        const session = options.getSession(sessionId);
        if (!session) {
          continue;
        }

        if (session.cancelRequested || session.status === 'cancelled') {
          options.markCancelled(session);
          continue;
        }

        this.runningSessionIds.add(sessionId);
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
            this.runningSessionIds.delete(sessionId);
            this.scheduleDrain(options);
          });
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
    this.sessionAttempts.clear();
    this.deadletters.length = 0;
  }
}
