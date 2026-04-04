import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger', () => ({ default: { debug: vi.fn() } }));

import {
  buildOutcomeSignalTags,
  appendOutcomeSignalVerification,
  logOutcomeSignal,
} from './outcomeSignal';

describe('buildOutcomeSignalTags', () => {
  it('returns scope, component, and outcome tags', () => {
    const tags = buildOutcomeSignalTags({
      scope: 'action',
      component: 'test-component',
      outcome: 'success',
    });
    expect(tags).toContain('signal/scope=action');
    expect(tags).toContain('signal/component=test-component');
    expect(tags).toContain('signal/outcome=success');
  });

  it('includes path when provided', () => {
    const tags = buildOutcomeSignalTags({
      scope: 'action', component: 'x', outcome: 'success', path: '/test',
    });
    expect(tags).toContain('signal/path=/test');
  });

  it('includes guildId when provided', () => {
    const tags = buildOutcomeSignalTags({
      scope: 'discord-event', component: 'x', outcome: 'success', guildId: 'g123',
    });
    expect(tags).toContain('signal/guild=g123');
  });

  it('includes detail when provided', () => {
    const tags = buildOutcomeSignalTags({
      scope: 'action', component: 'x', outcome: 'failure', detail: 'timeout',
    });
    expect(tags).toContain('signal/detail=timeout');
  });

  it('includes extra key-value pairs', () => {
    const tags = buildOutcomeSignalTags({
      scope: 'adapter', component: 'x', outcome: 'degraded',
      extra: { latency: '200ms' },
    });
    expect(tags).toContain('signal/latency=200ms');
  });

  it('skips empty extra keys and values', () => {
    const tags = buildOutcomeSignalTags({
      scope: 'action', component: 'x', outcome: 'success',
      extra: { '': 'val', key: '' },
    });
    expect(tags.length).toBe(3); // only scope, component, outcome
  });

  it('defaults component to unknown when empty', () => {
    const tags = buildOutcomeSignalTags({
      scope: 'action', component: '', outcome: 'success',
    });
    expect(tags).toContain('signal/component=unknown');
  });
});

describe('appendOutcomeSignalVerification', () => {
  it('appends signal tags to existing verification array', () => {
    const result = appendOutcomeSignalVerification(
      ['existing-tag'],
      { scope: 'action', component: 'x', outcome: 'success' },
    );
    expect(result).toContain('existing-tag');
    expect(result).toContain('signal/scope=action');
  });

  it('does not duplicate existing tags', () => {
    const result = appendOutcomeSignalVerification(
      ['signal/scope=action'],
      { scope: 'action', component: 'x', outcome: 'success' },
    );
    expect(result.filter((t) => t === 'signal/scope=action')).toHaveLength(1);
  });

  it('handles undefined verification array', () => {
    const result = appendOutcomeSignalVerification(
      undefined,
      { scope: 'action', component: 'x', outcome: 'success' },
    );
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

describe('logOutcomeSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs without throwing', () => {
    expect(() =>
      logOutcomeSignal({ scope: 'action', component: 'test', outcome: 'success' }),
    ).not.toThrow();
  });

  it('calls logger.debug', async () => {
    const { default: logger } = await import('../../logger');
    logOutcomeSignal({ scope: 'action', component: 'test', outcome: 'failure' });
    expect(logger.debug).toHaveBeenCalled();
  });
});
