import logger from '../../logger';

export type OutcomeSignal = 'success' | 'degraded' | 'failure';

type SignalScope = 'action' | 'discord-event' | 'adapter';

type SignalTagParams = {
  scope: SignalScope;
  component: string;
  outcome: OutcomeSignal;
  path?: string;
  detail?: string;
  guildId?: string;
  extra?: Record<string, string>;
};

const safe = (value: unknown): string => String(value || '').trim();

export const buildOutcomeSignalTags = (params: SignalTagParams): string[] => {
  const tags: string[] = [
    `signal/scope=${params.scope}`,
    `signal/component=${safe(params.component) || 'unknown'}`,
    `signal/outcome=${params.outcome}`,
  ];

  const path = safe(params.path);
  if (path) {
    tags.push(`signal/path=${path}`);
  }

  const guildId = safe(params.guildId);
  if (guildId) {
    tags.push(`signal/guild=${guildId}`);
  }

  const detail = safe(params.detail);
  if (detail) {
    tags.push(`signal/detail=${detail}`);
  }

  for (const [key, rawValue] of Object.entries(params.extra || {})) {
    const normalizedKey = safe(key);
    const normalizedValue = safe(rawValue);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    tags.push(`signal/${normalizedKey}=${normalizedValue}`);
  }

  return tags;
};

export const appendOutcomeSignalVerification = (
  verification: string[] | undefined,
  params: SignalTagParams,
): string[] => {
  const merged = [...(verification || [])];
  const tags = buildOutcomeSignalTags(params);
  for (const tag of tags) {
    if (!merged.includes(tag)) {
      merged.push(tag);
    }
  }
  return merged;
};

export const logOutcomeSignal = (params: SignalTagParams): void => {
  const tags = buildOutcomeSignalTags(params).join(' ');
  logger.debug('[OUTCOME-SIGNAL] %s', tags);
};
