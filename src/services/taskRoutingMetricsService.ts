import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import logger from '../logger';
import type { TaskRoute } from './taskRoutingService';
import { getErrorMessage } from '../utils/errorMessage';

type TaskRoutingMetricEvent = {
  guildId: string;
  requestedBy: string;
  goal: string;
  channel: 'docs' | 'vibe';
  route: TaskRoute;
  confidence: number;
  reasons: string[];
  overrideUsed?: boolean;
  durationMs?: number;
  status?: 'success' | 'failed';
  extra?: Record<string, unknown>;
};

type TaskRoutingFeedbackEvent = {
  guildId: string;
  requestedBy: string;
  route: TaskRoute;
  channel: 'docs' | 'vibe';
  outcomeScore: number;
  reason?: string;
  relatedGoal?: string;
  extra?: Record<string, unknown>;
};

const sanitizeGuildId = (value: unknown): string => {
  const text = String(value || '').trim();
  return /^\d{6,30}$/.test(text) ? text : '';
};

const normalizeStatus = (value: unknown): 'success' | 'failed' => {
  return String(value || '').trim().toLowerCase() === 'failed' ? 'failed' : 'success';
};

const clamp01 = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric));
};

export const recordTaskRoutingMetric = async (event: TaskRoutingMetricEvent): Promise<void> => {
  if (!isSupabaseConfigured()) {
    return;
  }

  const guildId = sanitizeGuildId(event.guildId);
  if (!guildId) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const durationMs = Number.isFinite(event.durationMs) ? Math.max(0, Math.trunc(Number(event.durationMs))) : 0;
    const confidence = clamp01(event.confidence);
    const summary = [
      `route=${event.route}`,
      `confidence=${confidence.toFixed(3)}`,
      `channel=${event.channel}`,
      `override=${event.overrideUsed ? '1' : '0'}`,
      event.reasons.length > 0 ? `reasons=${event.reasons.join('|')}` : '',
    ].filter(Boolean).join(' ');

    await client.from('agent_action_logs').insert({
      guild_id: guildId,
      requested_by: String(event.requestedBy || 'system').trim() || 'system',
      goal: String(event.goal || '').slice(0, 1200),
      action_name: `task_routing_${event.channel}`,
      status: normalizeStatus(event.status),
      summary,
      artifacts: [
        {
          route: event.route,
          confidence,
          reasons: event.reasons,
          overrideUsed: Boolean(event.overrideUsed),
          ...(event.extra || {}),
        },
      ],
      verification: [],
      duration_ms: durationMs,
      retry_count: 0,
      circuit_open: false,
    });
  } catch (error) {
    logger.debug('[TASK-ROUTING-METRIC] skipped: %s', getErrorMessage(error));
  }
};

export const recordTaskRoutingFeedbackMetric = async (event: TaskRoutingFeedbackEvent): Promise<void> => {
  if (!isSupabaseConfigured()) {
    return;
  }

  const guildId = sanitizeGuildId(event.guildId);
  if (!guildId) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const outcomeScore = clamp01(event.outcomeScore);
    const summary = [
      `route=${event.route}`,
      `channel=${event.channel}`,
      `outcome_score=${outcomeScore.toFixed(3)}`,
      event.reason ? `reason=${String(event.reason).slice(0, 180)}` : '',
    ].filter(Boolean).join(' ');

    await client.from('agent_action_logs').insert({
      guild_id: guildId,
      requested_by: String(event.requestedBy || 'system').trim() || 'system',
      goal: String(event.relatedGoal || `routing-feedback:${event.channel}:${event.route}`).slice(0, 1200),
      action_name: 'task_routing_feedback',
      status: outcomeScore >= 0.6 ? 'success' : 'failed',
      summary,
      artifacts: [
        {
          route: event.route,
          channel: event.channel,
          outcomeScore,
          reason: String(event.reason || '').slice(0, 240),
          ...(event.extra || {}),
        },
      ],
      verification: [],
      duration_ms: 0,
      retry_count: 0,
      circuit_open: false,
    });
  } catch (error) {
    logger.debug('[TASK-ROUTING-FEEDBACK] skipped: %s', getErrorMessage(error));
  }
};
