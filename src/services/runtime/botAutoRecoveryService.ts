import { START_BOT } from '../../config';
import logger from '../../logger';
import type { BotRuntimeStatus } from '../../contracts/bot';
import { getErrorMessage } from '../../utils/errorMessage';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';

const BOT_AUTO_RECOVERY_ENABLED = parseBooleanEnv(process.env.BOT_AUTO_RECOVERY_ENABLED, true);
const BOT_AUTO_RECOVERY_SCAN_INTERVAL_MS = Math.max(10_000, parseIntegerEnv(process.env.BOT_AUTO_RECOVERY_SCAN_INTERVAL_MS, 60_000));
const BOT_AUTO_RECOVERY_OFFLINE_THRESHOLD_MS = Math.max(30_000, parseIntegerEnv(process.env.BOT_AUTO_RECOVERY_OFFLINE_THRESHOLD_MS, 3 * 60_000));

type BotModuleLike = {
  getBotRuntimeSnapshot: () => {
    ready: boolean;
    tokenPresent: boolean;
    reconnectQueued: boolean;
    manualReconnectCooldownRemainingSec: number;
    loginRateLimitRemainingSec: number;
    lastReadyAt: string | null;
    lastDisconnectAt: string | null;
    lastInvalidatedAt: string | null;
    lastLoginErrorAt: string | null;
    lastLoginAttemptAt: string | null;
    lastManualReconnectAt: string | null;
  };
  requestManualReconnect: (source: string) => Promise<{ ok: boolean; status?: string; reason?: string; message: string }>;
};

type BotRecoverySnapshot = ReturnType<BotModuleLike['getBotRuntimeSnapshot']>;

type RecoveryDecision = {
  shouldRecover: boolean;
  reason:
    | 'disabled'
    | 'bot_disabled'
    | 'already_ready'
    | 'missing_token'
    | 'reconnect_queued'
    | 'cooldown'
    | 'login_rate_limited'
    | 'within_threshold'
    | 'recover';
  offlineMs: number;
};

const state = {
  started: false,
  timer: null as NodeJS.Timeout | null,
  bootedAtMs: 0,
  lastCheckAt: null as string | null,
  lastAttemptAt: null as string | null,
  lastAttemptReason: null as string | null,
  lastAttemptResult: null as string | null,
};

const resolveReferenceMs = (snapshot: BotRecoverySnapshot, bootedAtMs: number): number => {
  const candidates = [
    snapshot.lastReadyAt,
    snapshot.lastDisconnectAt,
    snapshot.lastInvalidatedAt,
    snapshot.lastLoginErrorAt,
    snapshot.lastLoginAttemptAt,
    snapshot.lastManualReconnectAt,
  ]
    .map((value) => Date.parse(String(value || '')))
    .filter((value) => Number.isFinite(value));

  if (candidates.length > 0) {
    return Math.max(...candidates);
  }
  return bootedAtMs;
};

export const evaluateBotAutoRecovery = (
  snapshot: BotRecoverySnapshot,
  nowMs: number,
  bootedAtMs: number,
  thresholdMs: number,
  options: { enabled?: boolean; startBotEnabled?: boolean } = {},
): RecoveryDecision => {
  const enabled = options.enabled ?? BOT_AUTO_RECOVERY_ENABLED;
  const startBotEnabled = options.startBotEnabled ?? START_BOT;

  if (!enabled) {
    return { shouldRecover: false, reason: 'disabled', offlineMs: 0 };
  }
  if (!startBotEnabled) {
    return { shouldRecover: false, reason: 'bot_disabled', offlineMs: 0 };
  }
  if (snapshot.ready) {
    return { shouldRecover: false, reason: 'already_ready', offlineMs: 0 };
  }
  if (!snapshot.tokenPresent) {
    return { shouldRecover: false, reason: 'missing_token', offlineMs: 0 };
  }
  if (snapshot.reconnectQueued) {
    return { shouldRecover: false, reason: 'reconnect_queued', offlineMs: 0 };
  }
  if (Number(snapshot.manualReconnectCooldownRemainingSec || 0) > 0) {
    return { shouldRecover: false, reason: 'cooldown', offlineMs: 0 };
  }
  if (Number(snapshot.loginRateLimitRemainingSec || 0) > 0) {
    return { shouldRecover: false, reason: 'login_rate_limited', offlineMs: 0 };
  }

  const referenceMs = resolveReferenceMs(snapshot, bootedAtMs);
  const offlineMs = Math.max(0, nowMs - referenceMs);
  if (offlineMs < thresholdMs) {
    return { shouldRecover: false, reason: 'within_threshold', offlineMs };
  }
  return { shouldRecover: true, reason: 'recover', offlineMs };
};

const runScan = async (loadBotModule: () => Promise<BotModuleLike>): Promise<void> => {
  state.lastCheckAt = new Date().toISOString();

  const bot = await loadBotModule();
  const snapshot = bot.getBotRuntimeSnapshot();
  const decision = evaluateBotAutoRecovery(
    snapshot,
    Date.now(),
    state.bootedAtMs,
    BOT_AUTO_RECOVERY_OFFLINE_THRESHOLD_MS,
  );

  if (!decision.shouldRecover) {
    return;
  }

  state.lastAttemptAt = new Date().toISOString();
  state.lastAttemptReason = `offline_ms=${decision.offlineMs}`;

  logger.warn(
    '[BOT-AUTO-RECOVERY] Bot offline beyond threshold; requesting reconnect (offlineMs=%d thresholdMs=%d)',
    decision.offlineMs,
    BOT_AUTO_RECOVERY_OFFLINE_THRESHOLD_MS,
  );

  const result = await bot.requestManualReconnect('auto-recovery:bot-offline');
  state.lastAttemptResult = `${result.ok ? 'ok' : 'rejected'}:${result.reason || 'unknown'}`;
  logger.warn('[BOT-AUTO-RECOVERY] reconnect result ok=%s message=%s', String(result.ok), result.message);
};

export const startBotAutoRecovery = (loadBotModule: () => Promise<BotModuleLike> = () => import('../../bot')): void => {
  if (state.started || !BOT_AUTO_RECOVERY_ENABLED) {
    return;
  }

  state.started = true;
  state.bootedAtMs = Date.now();
  void runScan(loadBotModule).catch((error) => {
    state.lastAttemptResult = `scan_error:${getErrorMessage(error)}`;
    logger.warn('[BOT-AUTO-RECOVERY] initial scan failed: %s', getErrorMessage(error));
  });

  state.timer = setInterval(() => {
    void runScan(loadBotModule).catch((error) => {
      state.lastAttemptResult = `scan_error:${getErrorMessage(error)}`;
      logger.warn('[BOT-AUTO-RECOVERY] scan failed: %s', getErrorMessage(error));
    });
  }, BOT_AUTO_RECOVERY_SCAN_INTERVAL_MS);
  state.timer.unref();

  logger.info(
    '[BOT-AUTO-RECOVERY] started (intervalMs=%d thresholdMs=%d enabled=%s)',
    BOT_AUTO_RECOVERY_SCAN_INTERVAL_MS,
    BOT_AUTO_RECOVERY_OFFLINE_THRESHOLD_MS,
    String(BOT_AUTO_RECOVERY_ENABLED),
  );
};

export const stopBotAutoRecovery = (): void => {
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.timer = null;
  state.started = false;
};

export const getBotAutoRecoveryStats = () => ({
  enabled: BOT_AUTO_RECOVERY_ENABLED,
  started: state.started,
  running: Boolean(state.timer),
  intervalMs: BOT_AUTO_RECOVERY_SCAN_INTERVAL_MS,
  offlineThresholdMs: BOT_AUTO_RECOVERY_OFFLINE_THRESHOLD_MS,
  lastCheckAt: state.lastCheckAt,
  lastAttemptAt: state.lastAttemptAt,
  lastAttemptReason: state.lastAttemptReason,
  lastAttemptResult: state.lastAttemptResult,
});