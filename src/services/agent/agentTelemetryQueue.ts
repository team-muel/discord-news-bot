import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseMinIntEnv, parseStringEnv } from '../../utils/env';
import { logStructuredError } from '../structuredErrorLogService';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getErrorMessage } from '../../utils/errorMessage';

type TelemetryTask = {
  id: string;
  persistedId?: number;
  createdAt: number;
  name: string;
  guildId?: string;
  taskType: string;
  payload: Record<string, unknown>;
  attempt: number;
};

type TelemetryTaskHandler = (payload: Record<string, unknown>) => Promise<void>;

type TelemetryQueueStats = {
  queued: number;
  inflight: number;
  processed: number;
  failed: number;
  dropped: number;
  avgTaskMs: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  durableEnabled: boolean;
  durableHealthy: boolean;
};

const QUEUE_MAX_SIZE = parseMinIntEnv(process.env.AGENT_TELEMETRY_QUEUE_MAX_SIZE, 1000, 50);
const QUEUE_CONCURRENCY = Math.max(1, Math.min(8, parseIntegerEnv(process.env.AGENT_TELEMETRY_QUEUE_CONCURRENCY, 2)));
const ERROR_LOG_THROTTLE_MS = parseMinIntEnv(process.env.AGENT_TELEMETRY_QUEUE_ERROR_LOG_THROTTLE_MS, 60_000, 10_000);
const SATURATION_MODE = parseStringEnv(process.env.AGENT_TELEMETRY_QUEUE_SATURATION_MODE, 'drop').toLowerCase();
const DURABLE_QUEUE_ENABLED = parseBooleanEnv(process.env.AGENT_TELEMETRY_DURABLE_QUEUE_ENABLED, true);
const DURABLE_TABLE = parseStringEnv(process.env.AGENT_TELEMETRY_DURABLE_TABLE, 'agent_telemetry_queue_tasks');
const DURABLE_MAX_ATTEMPTS = Math.max(1, Math.min(10, parseIntegerEnv(process.env.AGENT_TELEMETRY_DURABLE_MAX_ATTEMPTS, 5)));
const DURABLE_RETRY_BASE_MS = parseMinIntEnv(process.env.AGENT_TELEMETRY_DURABLE_RETRY_BASE_MS, 5000, 1000);
const DURABLE_RETRY_MAX_MS = Math.max(DURABLE_RETRY_BASE_MS, parseIntegerEnv(process.env.AGENT_TELEMETRY_DURABLE_RETRY_MAX_MS, 300_000));
const DURABLE_RECOVERY_BATCH = Math.max(10, Math.min(1000, parseIntegerEnv(process.env.AGENT_TELEMETRY_DURABLE_RECOVERY_BATCH, 200)));
const DURABLE_STALE_RUNNING_MS = parseMinIntEnv(process.env.AGENT_TELEMETRY_DURABLE_STALE_RUNNING_MS, 300_000, 30_000);

const queue: TelemetryTask[] = [];
const handlers = new Map<string, TelemetryTaskHandler>();
let inflight = 0;
let processed = 0;
let failed = 0;
let dropped = 0;
let totalTaskMs = 0;
let sequence = 0;
let lastErrorAt: string | null = null;
let lastErrorMessage: string | null = null;
let lastErrorLogAtMs = 0;
let drainScheduled = false;
let durableHealthy = true;
let recoveryStarted = false;

const nowIso = () => new Date().toISOString();

const isDurableEnabled = (): boolean => DURABLE_QUEUE_ENABLED && isSupabaseConfigured() && durableHealthy;

const nextRetryDelayMs = (attempt: number): number => {
  const multiplier = Math.max(0, attempt - 1);
  const delay = DURABLE_RETRY_BASE_MS * (2 ** multiplier);
  return Math.min(DURABLE_RETRY_MAX_MS, delay);
};

const toPayloadRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const markDurableUnavailable = (error: unknown) => {
  durableHealthy = false;
  const message = getErrorMessage(error);
  logger.error('[AGENT-TELEMETRY-QUEUE] durable queue disabled due to persistent error: %s', message);
};

const registerTelemetryTaskHandler = (taskType: string, handler: TelemetryTaskHandler) => {
  const key = String(taskType || '').trim();
  if (!key) {
    throw new Error('TELEMETRY_TASK_TYPE_REQUIRED');
  }
  handlers.set(key, handler);
};

const persistQueuedTask = async (task: TelemetryTask): Promise<number | null> => {
  if (!isDurableEnabled()) {
    return null;
  }
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(DURABLE_TABLE)
      .insert({
        task_type: task.taskType,
        task_name: task.name,
        guild_id: task.guildId || null,
        payload: task.payload,
        status: 'queued',
        attempts: task.attempt,
        available_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .select('id')
      .single();
    if (error || !data) {
      throw error || new Error('TELEMETRY_DURABLE_INSERT_FAILED');
    }
    return Number((data as { id?: number }).id || 0) || null;
  } catch (error) {
    markDurableUnavailable(error);
    return null;
  }
};

const markRunning = async (task: TelemetryTask): Promise<void> => {
  if (!task.persistedId || !isDurableEnabled()) {
    return;
  }
  try {
    const client = getSupabaseClient();
    const attempt = Math.max(1, task.attempt);
    const { error } = await client
      .from(DURABLE_TABLE)
      .update({
        status: 'running',
        attempts: attempt,
        started_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq('id', task.persistedId);
    if (error) {
      throw error;
    }
  } catch (error) {
    markDurableUnavailable(error);
  }
};

const markSucceeded = async (task: TelemetryTask): Promise<void> => {
  if (!task.persistedId || !isDurableEnabled()) {
    return;
  }
  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from(DURABLE_TABLE)
      .delete()
      .eq('id', task.persistedId);
    if (error) {
      throw error;
    }
  } catch (error) {
    markDurableUnavailable(error);
  }
};

const markFailedOrRetry = async (task: TelemetryTask, message: string): Promise<void> => {
  if (!task.persistedId || !isDurableEnabled()) {
    return;
  }
  const attempt = Math.max(1, task.attempt);
  try {
    const client = getSupabaseClient();
    if (attempt >= DURABLE_MAX_ATTEMPTS) {
      const { error } = await client
        .from(DURABLE_TABLE)
        .update({
          status: 'failed',
          attempts: attempt,
          last_error: message.slice(0, 500),
          ended_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq('id', task.persistedId);
      if (error) {
        throw error;
      }
      return;
    }

    const delayMs = nextRetryDelayMs(attempt);
    const availableAt = new Date(Date.now() + delayMs).toISOString();
    const { error } = await client
      .from(DURABLE_TABLE)
      .update({
        status: 'queued',
        attempts: attempt,
        last_error: message.slice(0, 500),
        available_at: availableAt,
        updated_at: nowIso(),
      })
      .eq('id', task.persistedId);
    if (error) {
      throw error;
    }

    setTimeout(() => {
      queue.push({
        ...task,
        attempt: attempt + 1,
      });
      scheduleDrain();
    }, delayMs);
  } catch (error) {
    markDurableUnavailable(error);
  }
};

const maybeLogError = (message: string) => {
  const now = Date.now();
  if (now - lastErrorLogAtMs < ERROR_LOG_THROTTLE_MS) {
    return;
  }
  lastErrorLogAtMs = now;
  logger.warn('[AGENT-TELEMETRY-QUEUE] task failed (throttled): %s', message);
};

const persistQueueError = async (params: {
  code: 'TELEMETRY_QUEUE_DROPPED' | 'TELEMETRY_TASK_FAILED';
  message: string;
  name: string;
  guildId?: string;
}): Promise<void> => {
  await logStructuredError({
    code: 'UNKNOWN_ERROR',
    source: 'agentTelemetryQueue',
    message: `${params.code}: ${params.message}`.slice(0, 500),
    guildId: params.guildId,
    severity: 'warn',
    meta: {
      telemetryCode: params.code,
      taskName: params.name,
      queued: queue.length,
      inflight,
      dropped,
      failed,
      processed,
      saturationMode: SATURATION_MODE,
      durableEnabled: DURABLE_QUEUE_ENABLED,
      durableHealthy,
    },
  });
};

const recoverDurableQueue = async (): Promise<void> => {
  if (!DURABLE_QUEUE_ENABLED || !isSupabaseConfigured() || recoveryStarted) {
    return;
  }
  recoveryStarted = true;

  try {
    const client = getSupabaseClient();
    const staleIso = new Date(Date.now() - DURABLE_STALE_RUNNING_MS).toISOString();
    await client
      .from(DURABLE_TABLE)
      .update({ status: 'queued', updated_at: nowIso() })
      .eq('status', 'running')
      .lt('updated_at', staleIso);

    const { data, error } = await client
      .from(DURABLE_TABLE)
      .select('id,task_type,task_name,guild_id,payload,attempts,available_at,created_at')
      .eq('status', 'queued')
      .lte('available_at', nowIso())
      .order('id', { ascending: true })
      .limit(DURABLE_RECOVERY_BATCH);

    if (error) {
      throw error;
    }

    for (const row of data || []) {
      queue.push({
        id: `tq-recover-${Number((row as { id?: number }).id || 0)}`,
        persistedId: Number((row as { id?: number }).id || 0) || undefined,
        createdAt: Date.parse(String((row as { created_at?: string }).created_at || nowIso())) || Date.now(),
        name: String((row as { task_name?: string }).task_name || 'recovered').slice(0, 120),
        guildId: String((row as { guild_id?: string }).guild_id || '').trim() || undefined,
        taskType: String((row as { task_type?: string }).task_type || '').trim(),
        payload: toPayloadRecord((row as { payload?: unknown }).payload),
        attempt: Math.max(1, Number((row as { attempts?: number }).attempts || 1)),
      });
    }

    if ((data || []).length > 0) {
      logger.info('[AGENT-TELEMETRY-QUEUE] recovered %d queued durable tasks', (data || []).length);
      scheduleDrain();
    }

    // If we fetched a full batch, schedule another recovery pass after a short delay
    if ((data || []).length >= DURABLE_RECOVERY_BATCH) {
      recoveryStarted = false;
      setTimeout(() => { void recoverDurableQueue(); }, 5_000);
    }
  } catch (error) {
    markDurableUnavailable(error);
  }
};

const scheduleDrain = () => {
  if (drainScheduled) {
    return;
  }
  drainScheduled = true;
  setTimeout(() => {
    drainScheduled = false;
    while (inflight < QUEUE_CONCURRENCY && queue.length > 0) {
      const task = queue.shift() as TelemetryTask;
      inflight += 1;
      const startedAt = Date.now();
      const handler = handlers.get(task.taskType);
      void Promise.resolve()
        .then(async () => {
          if (!handler) {
            throw new Error(`TELEMETRY_HANDLER_NOT_FOUND:${task.taskType}`);
          }
          await markRunning(task);
          await handler(task.payload);
          await markSucceeded(task);
        })
        .catch((error) => {
          failed += 1;
          lastErrorAt = nowIso();
          lastErrorMessage = getErrorMessage(error);
          maybeLogError(`${task.name}: ${lastErrorMessage}`);
          void markFailedOrRetry(task, lastErrorMessage);
          void persistQueueError({
            code: 'TELEMETRY_TASK_FAILED',
            message: lastErrorMessage,
            name: task.name,
            guildId: task.guildId,
          });
        })
        .finally(() => {
          inflight = Math.max(0, inflight - 1);
          processed += 1;
          totalTaskMs += Math.max(0, Date.now() - startedAt);
          scheduleDrain();
        });
    }
  }, 0);
};

export const enqueueTelemetryTask = (params: {
  name: string;
  taskType: string;
  payload?: Record<string, unknown>;
  guildId?: string;
}): boolean => {
  const taskType = String(params.taskType || '').trim();
  if (!taskType) {
    throw new Error('TELEMETRY_TASK_TYPE_REQUIRED');
  }
  if (queue.length >= QUEUE_MAX_SIZE) {
    if (SATURATION_MODE === 'inline') {
      const taskName = String(params.name || 'unknown').slice(0, 120);
      const handler = handlers.get(taskType);
      void Promise.resolve()
        .then(async () => {
          if (!handler) {
            throw new Error(`TELEMETRY_HANDLER_NOT_FOUND:${taskType}`);
          }
          await handler(toPayloadRecord(params.payload));
        })
        .catch((error) => {
          failed += 1;
          lastErrorAt = nowIso();
          lastErrorMessage = getErrorMessage(error);
          maybeLogError(`${taskName}: ${lastErrorMessage}`);
          void persistQueueError({
            code: 'TELEMETRY_TASK_FAILED',
            message: lastErrorMessage,
            name: taskName,
            guildId: params.guildId,
          });
        })
        .finally(() => {
          processed += 1;
        });
      return true;
    }

    dropped += 1;
    const dropMessage = `queue saturated max=${QUEUE_MAX_SIZE}`;
    maybeLogError(`${String(params.name || 'unknown')}: ${dropMessage}`);
    void persistQueueError({
      code: 'TELEMETRY_QUEUE_DROPPED',
      message: dropMessage,
      name: String(params.name || 'unknown').slice(0, 120),
      guildId: params.guildId,
    });
    return false;
  }

  sequence += 1;
  const task: TelemetryTask = {
    id: `tq-${sequence}`,
    createdAt: Date.now(),
    name: String(params.name || 'unknown').slice(0, 120),
    guildId: params.guildId,
    taskType,
    payload: toPayloadRecord(params.payload),
    attempt: 1,
  };
  void persistQueuedTask(task).then((persistedId) => {
    if (persistedId) {
      task.persistedId = persistedId;
    }
  });
  queue.push(task);
  scheduleDrain();
  return true;
};

export const getAgentTelemetryQueueSnapshot = (): TelemetryQueueStats => {
  return {
    queued: queue.length,
    inflight,
    processed,
    failed,
    dropped,
    avgTaskMs: processed > 0 ? Math.round(totalTaskMs / processed) : 0,
    lastErrorAt,
    lastErrorMessage,
    durableEnabled: DURABLE_QUEUE_ENABLED,
    durableHealthy,
  };
};

void recoverDurableQueue();

export { registerTelemetryTaskHandler };
