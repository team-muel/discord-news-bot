/**
 * Generic circuit breaker utility.
 *
 * Supports two modes via `failureWindowMs`:
 *  - Window-based (>0): count failures within a sliding time window.
 *  - Cumulative (0 or omitted): count all consecutive failures until success or reset.
 *
 * After tripping the circuit stays OPEN for `cooldownMs`, then transitions to
 * half-open — allowing one probe attempt.  On probe success the circuit closes;
 * on probe failure it re-opens.
 */

export type CircuitBreakerConfig = {
  /** Number of failures required to trip the circuit. */
  failureThreshold: number;
  /** Duration (ms) the circuit stays open before entering half-open. */
  cooldownMs: number;
  /** Failure counting window (ms). 0 = cumulative (no window). */
  failureWindowMs?: number;
  /** Callback fired when the circuit trips open. */
  onTrip?: (key: string, failures: number) => void;
  /** Upper bound on tracked keys (oldest evicted first). Default 500. */
  maxEntries?: number;
};

type KeyState = {
  failures: number;
  firstFailure: number;
  trippedAt: number | null;
};

export class CircuitBreaker {
  private readonly state = new Map<string, KeyState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly failureWindowMs: number;
  private readonly maxEntries: number;
  private readonly onTrip?: (key: string, failures: number) => void;

  constructor(config: CircuitBreakerConfig) {
    this.failureThreshold = Math.max(1, config.failureThreshold);
    this.cooldownMs = Math.max(0, config.cooldownMs);
    this.failureWindowMs = Math.max(0, config.failureWindowMs ?? 0);
    this.maxEntries = Math.max(1, config.maxEntries ?? 500);
    this.onTrip = config.onTrip;
  }

  /** True when the circuit is OPEN (calls should be skipped). */
  isOpen(key: string): boolean {
    const s = this.state.get(key);
    if (!s || s.trippedAt === null) return false;
    if (Date.now() - s.trippedAt > this.cooldownMs) {
      // Half-open: allow one probe
      this.state.delete(key);
      return false;
    }
    return true;
  }

  /** Record a successful call — resets the key entirely. */
  recordSuccess(key: string): void {
    this.state.delete(key);
  }

  /** Record a failed call — may trip the circuit. */
  recordFailure(key: string): void {
    const now = Date.now();
    const s = this.state.get(key) ?? { failures: 0, firstFailure: now, trippedAt: null };

    // Window-based: reset counter when outside the window
    if (this.failureWindowMs > 0 && now - s.firstFailure > this.failureWindowMs) {
      s.failures = 0;
      s.firstFailure = now;
    }

    s.failures++;

    if (s.failures >= this.failureThreshold) {
      s.trippedAt = now;
      this.onTrip?.(key, s.failures);
    }

    this.state.set(key, s);

    // Evict oldest entry when over capacity
    if (this.state.size > this.maxEntries) {
      const first = this.state.keys().next().value;
      if (first !== undefined) this.state.delete(first);
    }
  }

  /** Diagnostic snapshot of all tracked keys. */
  getSnapshot(): Record<string, { failures: number; tripped: boolean; trippedAt: number | null }> {
    const result: Record<string, { failures: number; tripped: boolean; trippedAt: number | null }> = {};
    for (const [key, s] of this.state) {
      result[key] = { failures: s.failures, tripped: s.trippedAt !== null, trippedAt: s.trippedAt };
    }
    return result;
  }

  /** Reset one key, or clear all state. */
  reset(key?: string): void {
    if (key) {
      this.state.delete(key);
    } else {
      this.state.clear();
    }
  }
}
