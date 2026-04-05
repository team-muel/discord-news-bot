import logger from '../logger';
import { getErrorMessage } from './errorMessage';

export type BackgroundLoopOptions = {
  /** Short label for log messages, e.g. '[EVAL-PROMOTE-LOOP]'. */
  name: string;
  /** Interval in milliseconds between ticks. */
  intervalMs: number;
  /** If true, execute one tick immediately on start (default: false). */
  runOnStart?: boolean;
  /** Log level for unhandled tick errors (default: 'warn'). */
  errorLevel?: 'error' | 'warn' | 'debug';
};

export type BackgroundLoopStats = {
  name: string;
  started: boolean;
  running: boolean;
  intervalMs: number;
  runCount: number;
  lastRunAt: string | null;
  lastSummary: string | null;
  lastErrorAt: string | null;
};

/**
 * Reusable setInterval-based background loop with:
 * - start/stop idempotency
 * - reentrancy guard (overlapping ticks are skipped)
 * - automatic error logging
 * - timer.unref() so the process can exit cleanly
 * - stats tracking (runCount, lastRunAt, lastSummary)
 */
export class BackgroundLoop {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private running = false;
  private runCount = 0;
  private lastRunAt: string | null = null;
  private lastSummary: string | null = null;
  private lastErrorAt: string | null = null;

  private readonly name: string;
  private readonly intervalMs: number;
  private readonly runOnStart: boolean;
  private readonly errorLevel: 'error' | 'warn' | 'debug';
  private readonly tick: () => Promise<string | void>;

  /**
   * @param tick — async function to run each interval.
   *   If it returns a string, it is stored as `lastSummary`.
   */
  constructor(tick: () => Promise<string | void>, opts: BackgroundLoopOptions) {
    this.tick = tick;
    this.name = opts.name;
    this.intervalMs = opts.intervalMs;
    this.runOnStart = opts.runOnStart ?? false;
    this.errorLevel = opts.errorLevel ?? 'warn';
  }

  start(): void {
    if (this.started || this.timer) return;
    this.started = true;

    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    this.timer.unref();

    if (this.runOnStart) {
      void this.runOnce();
    }

    logger.info('%s started (intervalMs=%d, runOnStart=%s)', this.name, this.intervalMs, String(this.runOnStart));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  getStats(): BackgroundLoopStats {
    return {
      name: this.name,
      started: this.started,
      running: this.running,
      intervalMs: this.intervalMs,
      runCount: this.runCount,
      lastRunAt: this.lastRunAt,
      lastSummary: this.lastSummary,
      lastErrorAt: this.lastErrorAt,
    };
  }

  get isStarted(): boolean { return this.started; }
  get isRunning(): boolean { return this.running; }

  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastRunAt = new Date().toISOString();

    try {
      const summary = await this.tick();
      if (typeof summary === 'string') {
        this.lastSummary = summary;
      }
      this.runCount += 1;
    } catch (err) {
      this.lastErrorAt = new Date().toISOString();
      const msg = getErrorMessage(err);
      logger[this.errorLevel]('%s tick failed: %s', this.name, msg);
    } finally {
      this.running = false;
    }
  }
}
