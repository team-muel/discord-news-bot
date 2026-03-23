import logger from '../../logger';
import {
  SPRINT_ENABLED,
  SPRINT_TRIGGER_ERROR_THRESHOLD,
  SPRINT_TRIGGER_CS_CHANNEL_IDS,
  SPRINT_TRIGGER_CRON_SECURITY_AUDIT,
  SPRINT_TRIGGER_CRON_IMPROVEMENT,
  SPRINT_AUTONOMY_LEVEL,
} from '../../config';
import {
  createSprintPipeline,
  runFullSprintPipeline,
  type SprintTriggerType,
  type AutonomyLevel,
} from './sprintOrchestrator';
import { generateText, isAnyLlmConfigured } from '../llmClient';

// ──── Error Detection Trigger ─────────────────────────────────────────────────

type ErrorAccumulator = {
  recentErrors: Array<{ message: string; at: string; code?: string }>;
  lastTriggeredAt: number;
};

const errorAccumulator: ErrorAccumulator = {
  recentErrors: [],
  lastTriggeredAt: 0,
};

const ERROR_WINDOW_MS = 10 * 60_000; // 10 minutes
const ERROR_COOLDOWN_MS = 30 * 60_000; // 30 minutes between auto-triggered sprints

export const recordRuntimeError = (error: { message: string; code?: string }): void => {
  if (!SPRINT_ENABLED) return;

  const now = Date.now();
  errorAccumulator.recentErrors.push({ ...error, at: new Date().toISOString() });

  // Prune old errors
  const cutoff = new Date(now - ERROR_WINDOW_MS).toISOString();
  errorAccumulator.recentErrors = errorAccumulator.recentErrors.filter((e) => e.at > cutoff);

  // Check threshold
  if (
    errorAccumulator.recentErrors.length >= SPRINT_TRIGGER_ERROR_THRESHOLD &&
    (now - errorAccumulator.lastTriggeredAt) > ERROR_COOLDOWN_MS
  ) {
    errorAccumulator.lastTriggeredAt = now;
    const errorSummary = errorAccumulator.recentErrors
      .map((e) => `[${e.code || 'UNKNOWN'}] ${e.message.slice(0, 100)}`)
      .join('\n');

    triggerSprint({
      triggerId: `error-${now}`,
      triggerType: 'error-detection',
      guildId: 'system',
      objective: `Auto-triggered bugfix: ${errorAccumulator.recentErrors.length} errors detected in last 10 minutes.\n\nError patterns:\n${errorSummary}`,
      autonomyLevel: 'approve-impl',
    }).catch((err) => logger.error('[SPRINT-TRIGGER] error-detection trigger failed: %s', err));
  }
};

// ──── CS Ticket Trigger ───────────────────────────────────────────────────────

const CS_CHANNEL_IDS = new Set(
  SPRINT_TRIGGER_CS_CHANNEL_IDS.split(',').map((s) => s.trim()).filter(Boolean),
);

export type CsClassification = 'bug-report' | 'feature-request' | 'question' | 'noise';

export const classifyCsMessage = async (message: string): Promise<CsClassification> => {
  if (!isAnyLlmConfigured()) {
    // Keyword-based fallback
    if (/bug|error|broken|crash|fails|깨짐|오류|에러|안됨|문제/i.test(message)) return 'bug-report';
    if (/feature|add|want|need|추가|기능|원|해줘/i.test(message)) return 'feature-request';
    if (/\?|how|what|질문|어떻게|뭐/i.test(message)) return 'question';
    return 'noise';
  }

  try {
    const result = await generateText({
      system: 'Classify the user message as exactly one of: bug-report, feature-request, question, noise. Output only the classification label.',
      user: message.slice(0, 500),
      actionName: 'sprint.cs.classify',
      temperature: 0,
      maxTokens: 20,
    });
    const normalized = result.trim().toLowerCase();
    if (['bug-report', 'feature-request', 'question', 'noise'].includes(normalized)) {
      return normalized as CsClassification;
    }
    return 'noise';
  } catch {
    return 'noise';
  }
};

export const handleCsChannelMessage = async (channelId: string, message: string, userId: string): Promise<void> => {
  if (!SPRINT_ENABLED || CS_CHANNEL_IDS.size === 0 || !CS_CHANNEL_IDS.has(channelId)) return;

  const classification = await classifyCsMessage(message);
  if (classification !== 'bug-report' && classification !== 'feature-request') return;

  const triggerType: SprintTriggerType = classification === 'bug-report' ? 'cs-ticket' : 'feature-request';

  logger.info('[SPRINT-TRIGGER] CS message classified as %s from user=%s', classification, userId);

  await triggerSprint({
    triggerId: `cs-${channelId}-${Date.now()}`,
    triggerType,
    guildId: 'system',
    objective: `[${classification}] from Discord CS channel:\n\n${message.slice(0, 1000)}`,
    autonomyLevel: classification === 'bug-report' ? 'approve-impl' : 'approve-ship',
  });
};

// ──── Scheduled Triggers ──────────────────────────────────────────────────────

export const triggerScheduledSecurityAudit = async (guildId: string): Promise<void> => {
  if (!SPRINT_ENABLED || !SPRINT_TRIGGER_CRON_SECURITY_AUDIT) return;

  await triggerSprint({
    triggerId: `cron-security-${Date.now()}`,
    triggerType: 'scheduled',
    guildId,
    objective: 'Scheduled security audit: OWASP Top 10 + STRIDE threat model scan across critical auth, API, and data boundaries.',
    autonomyLevel: 'approve-impl',
    includeSecurityAudit: true,
  });
};

export const triggerScheduledImprovement = async (guildId: string): Promise<void> => {
  if (!SPRINT_ENABLED || !SPRINT_TRIGGER_CRON_IMPROVEMENT) return;

  await triggerSprint({
    triggerId: `cron-improve-${Date.now()}`,
    triggerType: 'self-improvement',
    guildId,
    objective: 'Scheduled self-improvement: analyze recent sprint retros for recurring patterns and propose targeted fixes.',
    autonomyLevel: 'approve-impl',
  });
};

// ──── Manual Trigger ──────────────────────────────────────────────────────────

export const triggerManualSprint = async (params: {
  guildId: string;
  objective: string;
  requestedBy: string;
  autonomyLevel?: AutonomyLevel;
}): Promise<{ sprintId: string }> => {
  const pipeline = await triggerSprint({
    triggerId: `manual-${params.requestedBy}-${Date.now()}`,
    triggerType: 'manual',
    guildId: params.guildId,
    objective: params.objective,
    autonomyLevel: params.autonomyLevel || SPRINT_AUTONOMY_LEVEL,
  });

  return { sprintId: pipeline.sprintId };
};

// ──── Core trigger function ───────────────────────────────────────────────────

const triggerSprint = async (params: {
  triggerId: string;
  triggerType: SprintTriggerType;
  guildId: string;
  objective: string;
  autonomyLevel?: AutonomyLevel;
  includeSecurityAudit?: boolean;
}) => {
  const pipeline = createSprintPipeline({
    triggerId: params.triggerId,
    triggerType: params.triggerType,
    guildId: params.guildId,
    objective: params.objective,
    autonomyLevel: params.autonomyLevel,
    includeSecurityAudit: params.includeSecurityAudit,
  });

  logger.info(
    '[SPRINT-TRIGGER] type=%s sprint=%s objective=%.80s',
    params.triggerType,
    pipeline.sprintId,
    params.objective,
  );

  // Run pipeline asynchronously (don't block the trigger)
  runFullSprintPipeline(pipeline.sprintId).catch((error) => {
    logger.error('[SPRINT-TRIGGER] pipeline run failed sprint=%s error=%s', pipeline.sprintId, error);
  });

  return pipeline;
};

// ──── Scheduled loop ──────────────────────────────────────────────────────────

const parseCronIntervalMs = (raw: string): number => {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  // Support plain ms numbers or shorthand like "24h", "12h", "7d"
  const match = trimmed.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const multipliers: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Math.max(0, value * (multipliers[unit] || 1));
};

let securityAuditTimer: ReturnType<typeof setInterval> | null = null;
let improvementTimer: ReturnType<typeof setInterval> | null = null;

export const startSprintScheduledTriggers = (): void => {
  if (!SPRINT_ENABLED) return;

  const securityIntervalMs = parseCronIntervalMs(SPRINT_TRIGGER_CRON_SECURITY_AUDIT);
  if (securityIntervalMs > 0 && !securityAuditTimer) {
    securityAuditTimer = setInterval(() => {
      triggerScheduledSecurityAudit('system').catch((e) =>
        logger.error('[SPRINT-TRIGGER] scheduled security audit failed: %s', e),
      );
    }, securityIntervalMs);
    logger.info('[SPRINT-TRIGGER] scheduled security audit every %dms', securityIntervalMs);
  }

  const improvementIntervalMs = parseCronIntervalMs(SPRINT_TRIGGER_CRON_IMPROVEMENT);
  if (improvementIntervalMs > 0 && !improvementTimer) {
    improvementTimer = setInterval(() => {
      triggerScheduledImprovement('system').catch((e) =>
        logger.error('[SPRINT-TRIGGER] scheduled improvement failed: %s', e),
      );
    }, improvementIntervalMs);
    logger.info('[SPRINT-TRIGGER] scheduled improvement every %dms', improvementIntervalMs);
  }
};

export const stopSprintScheduledTriggers = (): void => {
  if (securityAuditTimer) { clearInterval(securityAuditTimer); securityAuditTimer = null; }
  if (improvementTimer) { clearInterval(improvementTimer); improvementTimer = null; }
};
