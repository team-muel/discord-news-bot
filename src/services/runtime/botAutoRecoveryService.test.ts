import { describe, expect, it } from 'vitest';
import { evaluateBotAutoRecovery } from './botAutoRecoveryService';
import type { BotRuntimeStatus } from '../../contracts/bot';

const buildSnapshot = (overrides: Partial<BotRuntimeStatus> = {}): BotRuntimeStatus => ({
  started: true,
  ready: false,
  wsStatus: -1,
  tokenPresent: true,
  reconnectQueued: false,
  reconnectAttempts: 0,
  lastReadyAt: null,
  lastLoginAttemptAt: '2026-03-21T00:00:00.000Z',
  lastLoginErrorAt: null,
  lastLoginError: null,
  lastDisconnectAt: null,
  lastDisconnectCode: null,
  lastDisconnectReason: null,
  lastInvalidatedAt: null,
  lastAlertAt: null,
  lastAlertReason: null,
  lastRecoveryAt: null,
  lastManualReconnectAt: null,
  manualReconnectCooldownRemainingSec: 0,
  loginRateLimitUntil: null,
  loginRateLimitRemainingSec: 0,
  loginRateLimitReason: null,
  dynamicWorkerRestore: {
    enabled: true,
    attemptedAt: null,
    approvedCount: 0,
    restoredCount: 0,
    failedCount: 0,
    lastError: null,
  },
  ...overrides,
});

describe('evaluateBotAutoRecovery', () => {
  const bootedAtMs = Date.parse('2026-03-20T23:55:00.000Z');
  const nowMs = Date.parse('2026-03-21T00:05:00.000Z');
  const thresholdMs = 3 * 60_000;

  it('requests recovery when bot stays offline beyond threshold', () => {
    const decision = evaluateBotAutoRecovery(buildSnapshot(), nowMs, bootedAtMs, thresholdMs, { enabled: true, startBotEnabled: true });
    expect(decision.shouldRecover).toBe(true);
    expect(decision.reason).toBe('recover');
  });

  it('does not recover when the bot is already ready', () => {
    const decision = evaluateBotAutoRecovery(buildSnapshot({ ready: true }), nowMs, bootedAtMs, thresholdMs, { enabled: true, startBotEnabled: true });
    expect(decision.shouldRecover).toBe(false);
    expect(decision.reason).toBe('already_ready');
  });

  it('does not recover while cooldown is active', () => {
    const decision = evaluateBotAutoRecovery(buildSnapshot({ manualReconnectCooldownRemainingSec: 20 }), nowMs, bootedAtMs, thresholdMs, { enabled: true, startBotEnabled: true });
    expect(decision.shouldRecover).toBe(false);
    expect(decision.reason).toBe('cooldown');
  });

  it('does not recover while Discord login is rate-limited', () => {
    const decision = evaluateBotAutoRecovery(buildSnapshot({ loginRateLimitRemainingSec: 120 }), nowMs, bootedAtMs, thresholdMs, { enabled: true, startBotEnabled: true });
    expect(decision.shouldRecover).toBe(false);
    expect(decision.reason).toBe('login_rate_limited');
  });

  it('waits until the offline threshold is exceeded', () => {
    const recentAttemptMs = Date.parse('2026-03-21T00:04:00.000Z');
    const decision = evaluateBotAutoRecovery(
      buildSnapshot({ lastLoginAttemptAt: new Date(recentAttemptMs).toISOString() }),
      nowMs,
      bootedAtMs,
      thresholdMs,
      { enabled: true, startBotEnabled: true },
    );
    expect(decision.shouldRecover).toBe(false);
    expect(decision.reason).toBe('within_threshold');
  });
});