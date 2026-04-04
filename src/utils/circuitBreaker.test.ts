import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuitBreaker';

describe('CircuitBreaker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts closed (isOpen = false)', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.isOpen('x')).toBe(false);
  });

  it('trips after reaching failureThreshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5000 });
    cb.recordFailure('x');
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(false);
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(true);
  });

  it('half-opens after cooldown expiry', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 3000 });
    cb.recordFailure('x');
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(true);

    vi.advanceTimersByTime(3001);
    expect(cb.isOpen('x')).toBe(false); // half-open probe allowed
  });

  it('re-opens if probe fails after half-open', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(cb.isOpen('x')).toBe(false); // half-open
    cb.recordFailure('x'); // probe fails
    expect(cb.isOpen('x')).toBe(true); // re-tripped
  });

  it('closes on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 5000 });
    cb.recordFailure('x');
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(true);

    // Advance past cooldown so half-open allows probe
    vi.advanceTimersByTime(5001);
    cb.recordSuccess('x');
    expect(cb.isOpen('x')).toBe(false);
    // Verify state is fully cleared
    expect(cb.getSnapshot()).toEqual({});
  });

  it('resets failure counter on success before tripping', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure('x');
    cb.recordFailure('x');
    cb.recordSuccess('x');
    cb.recordFailure('x');
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(false); // only 2 consecutive
  });

  // Window-based mode (sprintOrchestrator style)
  it('resets failure counter when outside failureWindowMs', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5000, failureWindowMs: 2000 });
    cb.recordFailure('x');
    cb.recordFailure('x');
    vi.advanceTimersByTime(2001); // outside window
    cb.recordFailure('x'); // resets to 1
    expect(cb.isOpen('x')).toBe(false);
    cb.recordFailure('x'); // 2
    expect(cb.isOpen('x')).toBe(false);
    cb.recordFailure('x'); // 3 → trip
    expect(cb.isOpen('x')).toBe(true);
  });

  // Cumulative mode (actionRunner style)
  it('counts all failures without window when failureWindowMs=0', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, failureWindowMs: 0 });
    cb.recordFailure('x');
    vi.advanceTimersByTime(999_999);
    cb.recordFailure('x');
    vi.advanceTimersByTime(999_999);
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(true);
  });

  it('calls onTrip when circuit opens', () => {
    const onTrip = vi.fn();
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, onTrip });
    cb.recordFailure('myKey');
    cb.recordFailure('myKey');
    expect(onTrip).toHaveBeenCalledWith('myKey', 2);
  });

  it('evicts oldest entry when maxEntries exceeded', () => {
    const cb = new CircuitBreaker({ failureThreshold: 10, cooldownMs: 1000, maxEntries: 2 });
    cb.recordFailure('a');
    cb.recordFailure('b');
    cb.recordFailure('c'); // 'a' evicted
    const snap = cb.getSnapshot();
    expect(snap).not.toHaveProperty('a');
    expect(snap).toHaveProperty('b');
    expect(snap).toHaveProperty('c');
  });

  it('tracks independent keys', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    cb.recordFailure('a');
    cb.recordFailure('a');
    cb.recordFailure('b');
    expect(cb.isOpen('a')).toBe(true);
    expect(cb.isOpen('b')).toBe(false);
  });

  it('reset(key) clears single key', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    cb.recordFailure('a');
    cb.recordFailure('b');
    cb.reset('a');
    expect(cb.isOpen('a')).toBe(false);
    expect(cb.isOpen('b')).toBe(true);
  });

  it('reset() clears all keys', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    cb.recordFailure('a');
    cb.recordFailure('b');
    cb.reset();
    expect(cb.getSnapshot()).toEqual({});
  });

  it('getSnapshot returns correct shape', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    cb.recordFailure('x');
    const snap = cb.getSnapshot();
    expect(snap.x).toEqual({ failures: 1, tripped: false, trippedAt: null });
  });
});
